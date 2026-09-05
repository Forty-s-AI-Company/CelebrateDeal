import { z } from "zod";

export const COMMISSION_BPS_TOTAL = 10_000;
export const MAX_COMMISSION_UPLINE_LEVELS = 8;

const MoneyCents = z.number().int().nonnegative();
const RateBps = z.number().int().min(0).max(COMMISSION_BPS_TOTAL);

export type CommissionRateTierInput = {
  minMonthlySalesCents: number;
  rateBps: number;
};

export type CommissionUplineLevelInput = {
  level: number;
  bonusRateBps: number;
};

export type CommissionRuleInput = {
  maxTotalRateBps: number;
  tiers: readonly CommissionRateTierInput[];
  uplineLevels: readonly CommissionUplineLevelInput[];
};

export type CommissionBeneficiary = {
  affiliateId: string;
  membershipId?: string | null;
  recipientRole: "promoter" | "upline_leader";
  uplineLevel: number | null;
  rateBps: number;
  amountCents: number;
};

export class CommissionCapExceededError extends Error {
  constructor(public readonly totalRateBps: number, public readonly maxTotalRateBps: number) {
    super(`分潤總費率 ${totalRateBps} BPS 超過上限 ${maxTotalRateBps} BPS。`);
  }
}

/**
 * Normalizes a merchant-authored rule before it can be persisted or evaluated.
 * The strict ordering constraints keep tier selection deterministic.
 */
export function parseCommissionRule(input: CommissionRuleInput) {
  const maxTotalRateBps = RateBps.min(1).parse(input.maxTotalRateBps);
  const tiers = z.array(z.object({
    minMonthlySalesCents: MoneyCents,
    rateBps: RateBps,
  })).min(1).parse(input.tiers);
  const uplineLevels = z.array(z.object({
    level: z.number().int().min(1).max(MAX_COMMISSION_UPLINE_LEVELS),
    bonusRateBps: RateBps.min(1),
  })).max(MAX_COMMISSION_UPLINE_LEVELS).parse(input.uplineLevels);

  if (tiers[0]?.minMonthlySalesCents !== 0) {
    throw new Error("第一個分潤階梯門檻必須為 0。 ");
  }
  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index]!.minMonthlySalesCents <= tiers[index - 1]!.minMonthlySalesCents) {
      throw new Error("分潤階梯門檻必須嚴格遞增。 ");
    }
    if (tiers[index]!.rateBps < tiers[index - 1]!.rateBps) {
      throw new Error("較高業績階梯的佣金率不可降低。 ");
    }
  }
  for (let index = 0; index < uplineLevels.length; index += 1) {
    if (uplineLevels[index]!.level !== index + 1) {
      throw new Error("團隊長獎金層級必須從 1 開始且連續。 ");
    }
  }

  const maximumConfiguredRateBps = tiers[tiers.length - 1]!.rateBps
    + uplineLevels.reduce((sum, level) => sum + level.bonusRateBps, 0);
  if (maximumConfiguredRateBps > maxTotalRateBps) {
    throw new CommissionCapExceededError(maximumConfiguredRateBps, maxTotalRateBps);
  }

  return { maxTotalRateBps, tiers, uplineLevels };
}

export function allocateCommissionAmounts(grossAmountCents: number, rates: readonly number[]) {
  const safeGrossAmountCents = MoneyCents.parse(grossAmountCents);
  const safeRates = z.array(RateBps).parse(rates);
  const exact = safeRates.map((rateBps, index) => ({
    index,
    floor: Math.floor((safeGrossAmountCents * rateBps) / COMMISSION_BPS_TOTAL),
    remainder: (safeGrossAmountCents * rateBps) % COMMISSION_BPS_TOTAL,
  }));
  const target = Math.round(
    (safeGrossAmountCents * safeRates.reduce((sum, rate) => sum + rate, 0)) / COMMISSION_BPS_TOTAL,
  );
  const remaining = target - exact.reduce((sum, item) => sum + item.floor, 0);
  const priority = [...exact].sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) priority[index]!.floor += 1;
  return exact.sort((left, right) => left.index - right.index).map((item) => item.floor);
}

/**
 * Evaluates one paid order. The current order is included in monthly sales, so
 * crossing a threshold upgrades that order immediately and snapshots the tier.
 */
export function calculateCommissionPlan(input: {
  grossAmountCents: number;
  monthlySalesBeforeCents: number;
  promoterAffiliateId: string;
  promoterMembershipId?: string | null;
  uplines: readonly { affiliateId: string; membershipId: string; level: number }[];
  rule: CommissionRuleInput;
}) {
  const grossAmountCents = MoneyCents.min(1).parse(input.grossAmountCents);
  const monthlySalesBeforeCents = MoneyCents.parse(input.monthlySalesBeforeCents);
  const rule = parseCommissionRule(input.rule);
  const monthlySalesAfterCents = monthlySalesBeforeCents + grossAmountCents;
  const tier = [...rule.tiers]
    .reverse()
    .find((candidate) => monthlySalesAfterCents >= candidate.minMonthlySalesCents)!;
  const levelRates = new Map(rule.uplineLevels.map((level) => [level.level, level.bonusRateBps]));
  const eligibleUplines = input.uplines
    .filter((upline) => levelRates.has(upline.level))
    .sort((left, right) => left.level - right.level);
  if (new Set(eligibleUplines.map((item) => item.affiliateId)).size !== eligibleUplines.length) {
    throw new Error("同一推廣訂單不可重複分配給相同上線受益人。 ");
  }
  if (eligibleUplines.some((item) => item.affiliateId === input.promoterAffiliateId)) {
    throw new Error("推廣者不可同時成為自己的上線獎金受益人。 ");
  }

  const rates = [tier.rateBps, ...eligibleUplines.map((upline) => levelRates.get(upline.level)!)];
  const totalRateBps = rates.reduce((sum, rate) => sum + rate, 0);
  if (totalRateBps > rule.maxTotalRateBps) {
    throw new CommissionCapExceededError(totalRateBps, rule.maxTotalRateBps);
  }
  const amounts = allocateCommissionAmounts(grossAmountCents, rates);
  const beneficiaries: CommissionBeneficiary[] = [{
    affiliateId: input.promoterAffiliateId,
    membershipId: input.promoterMembershipId ?? null,
    recipientRole: "promoter",
    uplineLevel: null,
    rateBps: tier.rateBps,
    amountCents: amounts[0]!,
  }, ...eligibleUplines.map((upline, index) => ({
    affiliateId: upline.affiliateId,
    membershipId: upline.membershipId,
    recipientRole: "upline_leader" as const,
    uplineLevel: upline.level,
    rateBps: rates[index + 1]!,
    amountCents: amounts[index + 1]!,
  }))];

  return {
    grossAmountCents,
    monthlySalesBeforeCents,
    monthlySalesAfterCents,
    selectedTier: tier,
    totalRateBps,
    totalAmountCents: amounts.reduce((sum, amount) => sum + amount, 0),
    beneficiaries,
  };
}
