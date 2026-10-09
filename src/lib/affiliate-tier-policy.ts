import { z } from "zod";

const Bps = z.number().int().min(0).max(10_000);
const Quantity = z.number().int().min(1).max(2_147_483_647);
const Cents = z.number().int().min(0).max(2_147_483_647);
const Id = z.string().trim().min(1).max(191);
const Terms = z.object({
  schemaVersion: z.literal(1),
  currency: z.literal("TWD"),
  maxTotalBps: Bps,
  tiers: z.array(z.object({ minQuantity: Quantity, maxQuantity: Quantity.nullable(), rateBps: Bps }).strict()).min(1).max(32),
  uplines: z.array(z.object({ level: z.number().int().min(1).max(8), rateBps: Bps }).strict()).max(8),
  productOverrides: z.array(z.object({ productId: Id, rateBps: Bps }).strict()).max(200),
}).strict();
export class MerchantAffiliateTermsValidationError extends Error {}
export type MerchantAffiliateTerms = z.infer<typeof Terms>;

/** Policies apply prospectively. Tier quantity means lifetime qualified paid
 * units under new policies; refunds never rewrite a historical tier or count. */
export function parseMerchantAffiliateTerms(value: unknown): MerchantAffiliateTerms {
  const terms = Terms.parse(value);
  if (terms.tiers[0]?.minQuantity !== 1) throw new MerchantAffiliateTermsValidationError("第一個階梯必須從第 1 件開始。");
  for (let index = 0; index < terms.tiers.length; index += 1) {
    const tier = terms.tiers[index]!;
    const next = terms.tiers[index + 1];
    if (tier.maxQuantity !== null && tier.maxQuantity < tier.minQuantity) throw new MerchantAffiliateTermsValidationError("階梯上限不可低於下限。");
    if (next && (tier.maxQuantity === null || next.minQuantity !== tier.maxQuantity + 1)) throw new MerchantAffiliateTermsValidationError("階梯必須連續且不可重疊。");
    if (!next && tier.maxQuantity !== null) throw new MerchantAffiliateTermsValidationError("最後階梯不可設定上限。");
  }
  if (terms.uplines.some((level, index) => level.level !== index + 1)) throw new MerchantAffiliateTermsValidationError("上線層級必須連續且不可重複。");
  if (new Set(terms.productOverrides.map(item => item.productId)).size !== terms.productOverrides.length) throw new MerchantAffiliateTermsValidationError("同一商品只能有一個覆蓋率。");
  const maximumDirect = Math.max(...terms.tiers.map(tier => tier.rateBps), ...terms.productOverrides.map(item => item.rateBps));
  if (maximumDirect + terms.uplines.reduce((sum, level) => sum + level.rateBps, 0) > terms.maxTotalBps) throw new MerchantAffiliateTermsValidationError("直推與上線費率總和超過政策上限。");
  return terms;
}

export type FrozenAffiliateRecipient = { affiliateId: string; level: number };
export type AffiliateCommissionLine = { productId: string; quantity: number; amountCents: number };

function qualifiedCount(value: bigint | number | string) {
  const parsed = typeof value === "bigint" ? value : typeof value === "number"
    ? BigInt(z.number().int().safe().nonnegative().parse(value))
    : BigInt(z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/u).parse(value));
  if (parsed < BigInt("0") || parsed > BigInt("9223372036854775807")) throw new Error("成交件數超出有效範圍。");
  return parsed;
}

/** Round a whole plan once and distribute spare cents by largest remainder.
 * All intermediate arithmetic uses BigInt, including one-cent allocations. */
function distributeNumerators(numerators: readonly bigint[], denominator: bigint, target: bigint) {
  const amounts = numerators.map(value => value / denominator);
  const remainders = numerators.map((value, index) => ({ index, remainder: value % denominator }));
  remainders.sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  let spare = target - amounts.reduce((sum, value) => sum + value, BigInt("0"));
  if (spare < BigInt("0") || spare > BigInt(amounts.length)) throw new Error("佣金分配不一致。");
  for (const item of remainders) { if (spare === BigInt("0")) break; amounts[item.index] = amounts[item.index]! + BigInt("1"); spare -= BigInt("1"); }
  if (spare !== BigInt("0")) throw new Error("佣金分配未完成。");
  return amounts;
}

export function calculateMerchantAffiliatePlan(input: {
  terms: unknown; recipients: readonly FrozenAffiliateRecipient[]; lines: readonly AffiliateCommissionLine[];
  qualifiedQuantityBefore: bigint | number | string; netReferenceAmountCents: number;
}) {
  const terms = parseMerchantAffiliateTerms(input.terms);
  const before = qualifiedCount(input.qualifiedQuantityBefore);
  const recipients = z.array(z.object({ affiliateId: Id, level: z.number().int().min(0).max(8) }).strict()).min(1).max(9).parse(input.recipients).sort((a, b) => a.level - b.level);
  if (recipients[0]?.level !== 0 || new Set(recipients.map(item => item.level)).size !== recipients.length || new Set(recipients.map(item => item.affiliateId)).size !== recipients.length) throw new Error("佣金受益人鏈不一致。");
  const lines = z.array(z.object({ productId: Id, quantity: Quantity.max(1000), amountCents: Cents }).strict()).min(1).max(20).parse(input.lines);
  if (lines.reduce((sum, line) => sum + line.quantity, 0) > 1000) throw new Error("單筆計算件數超過上限。");
  const netReferenceAmountCents = Cents.parse(input.netReferenceAmountCents);
  const numerators = recipients.map(() => BigInt("0"));
  let count = before, gross = BigInt("0");
  const selectedTiers: Array<{ productId: string; ordinal: number; qualifiedQuantity: string; rateBps: number; baseCents: number }> = [];
  for (const line of lines) {
    gross += BigInt(line.amountCents);
    const unitBase = Math.floor(line.amountCents / line.quantity), spare = line.amountCents % line.quantity;
    const override = terms.productOverrides.find(item => item.productId === line.productId);
    for (let ordinal = 0; ordinal < line.quantity; ordinal += 1) {
      count = qualifiedCount(count + BigInt("1"));
      const tier = terms.tiers.find(item => count >= BigInt(item.minQuantity) && (item.maxQuantity === null || count <= BigInt(item.maxQuantity)));
      if (!tier) throw new Error("找不到成交件數對應階梯。");
      const rateBps = override?.rateBps ?? tier.rateBps, baseCents = unitBase + (ordinal < spare ? 1 : 0);
      selectedTiers.push({ productId: line.productId, ordinal, qualifiedQuantity: count.toString(), rateBps, baseCents });
      recipients.forEach((recipient, index) => {
        const rate = recipient.level === 0 ? rateBps : terms.uplines.find(level => level.level === recipient.level)?.rateBps ?? 0;
        numerators[index] = numerators[index]! + BigInt(baseCents) * BigInt(rate);
      });
    }
  }
  if (gross > BigInt("2147483647")) throw new Error("單筆佣金基礎金額超出有效範圍。");
  const target = (numerators.reduce((sum, value) => sum + value, BigInt("0")) + BigInt("5000")) / BigInt("10000");
  // Gross remains the contractual commission base; provider net is display-only.
  if (target > gross) throw new Error("佣金超過本筆付款 Gross 金額。");
  const amounts = distributeNumerators(numerators, BigInt("10000"), target);
  return { schemaVersion: 1 as const, currency: terms.currency, qualifiedQuantityBefore: before.toString(), qualifiedQuantityAfter: count.toString(), grossAmountCents: Number(gross), netReferenceAmountCents, commissionAmountCents: Number(target), selectedTiers,
    recipients: recipients.map((recipient, index) => ({ ...recipient, amountCents: Number(amounts[index]!), effectiveRateBps: gross === BigInt("0") ? 0 : Number((numerators[index]! + gross / BigInt("2")) / gross) })) };
}

/** Refunds target the original plan cumulatively, never mutable tiers/rates.
 * The caller subtracts already-posted reversals to obtain this event's delta. */
export function calculateMerchantAffiliateRefundTargets(input: {
  grossAmountCents: number; originalAmountsCents: readonly number[]; cumulativeRefundCents: number;
}) {
  const gross = Cents.min(1).parse(input.grossAmountCents), refunded = Cents.parse(input.cumulativeRefundCents);
  if (refunded > gross) throw new Error("累積退款不可超過原始付款。");
  const amounts = z.array(Cents).min(1).max(9).parse(input.originalAmountsCents);
  const total = amounts.reduce((sum, amount) => sum + BigInt(amount), BigInt("0"));
  if (total > BigInt(gross)) throw new Error("原始佣金超過付款金額。");
  const target = (total * BigInt(refunded) + BigInt(gross) / BigInt("2")) / BigInt(gross);
  if (total === BigInt("0")) return amounts.map(() => 0);
  // Largest remainder is suitable for a one-off accrual, but can decrease an
  // individual allocation when the cumulative total grows (Alabama paradox).
  // Cumulative refunds use highest averages instead: each recipient's target
  // is monotone, bounded by its original accrual, and the total remains exact.
  const weights = amounts.map(BigInt);
  const seats = weights.map(weight => weight * target / total);
  let spare = target - seats.reduce((sum, value) => sum + value, BigInt("0"));
  while (spare > BigInt("0")) {
    let best = 0;
    for (let index = 1; index < weights.length; index += 1) {
      if (weights[index]! * (seats[best]! + BigInt("1")) > weights[best]! * (seats[index]! + BigInt("1"))) best = index;
    }
    seats[best] = seats[best]! + BigInt("1"); spare -= BigInt("1");
  }
  return seats.map(Number);
}
