import { z } from "zod";

export const COMMISSION_RATE_SCALE = 10_000;

const Cents = z.number().int().nonnegative();
const PositiveQuantity = z.number().int().positive();
const RateBps = z.number().int().min(0).max(COMMISSION_RATE_SCALE);

export type TieredCommissionTier = {
  minQuantity: number;
  maxQuantity?: number | null;
  rateBps: number;
};

export type ProductCommissionOverride = {
  productId: string;
  rateBps: number;
};

export type TieredCommissionPolicy = {
  version: number;
  tiers: readonly TieredCommissionTier[];
  productOverrides?: readonly ProductCommissionOverride[];
};

export type MatchedCommissionTier = {
  minQuantity: number;
  maxQuantity: number | null;
  rateBps: number;
  source: "tier" | "product_override";
};

/** 驗證並正規化件數型階梯，避免規則之間出現空洞或重疊。 */
export function parseTieredCommissionPolicy(policy: TieredCommissionPolicy) {
  const version = z.number().int().positive().parse(policy.version);
  const tiers = z.array(z.object({
    minQuantity: PositiveQuantity,
    maxQuantity: PositiveQuantity.nullish(),
    rateBps: RateBps,
  })).min(1).parse(policy.tiers).map((tier) => ({ ...tier, maxQuantity: tier.maxQuantity ?? null }));
  const productOverrides = z.array(z.object({
    productId: z.string().trim().min(1).max(191),
    rateBps: RateBps,
  })).default([]).parse(policy.productOverrides ?? []);

  if (tiers[0]?.minQuantity !== 1) throw new Error("第一個分潤階梯必須從第 1 件開始。");
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index]!;
    const next = tiers[index + 1];
    if (tier.maxQuantity !== null && tier.maxQuantity < tier.minQuantity) {
      throw new Error("分潤階梯上限不得小於下限。");
    }
    if (next && (tier.maxQuantity === null || next.minQuantity !== tier.maxQuantity + 1)) {
      throw new Error("分潤階梯必須連續且不得重疊。");
    }
    if (!next && tier.maxQuantity !== null) throw new Error("最後一個分潤階梯必須沒有上限。");
  }
  if (new Set(productOverrides.map((item) => item.productId)).size !== productOverrides.length) {
    throw new Error("同一商品不可設定多個分潤覆蓋率。");
  }
  return { version, tiers, productOverrides };
}

/**
 * 計算一筆訂單的分潤快照。當筆數量會先加入累積銷量，再匹配階梯；
 * 商品覆蓋率永遠優先於全域階梯。
 */
export function calculateTieredCommission(input: {
  unitPriceCents: number;
  quantity: number;
  cumulativeSalesBeforeCount: number;
  productId?: string | null;
  policy: TieredCommissionPolicy;
}) {
  const unitPriceCents = Cents.parse(input.unitPriceCents);
  const quantity = PositiveQuantity.parse(input.quantity);
  const cumulativeSalesBeforeCount = z.number().int().nonnegative().parse(input.cumulativeSalesBeforeCount);
  const policy = parseTieredCommissionPolicy(input.policy);
  const cumulativeSalesAfterCount = cumulativeSalesBeforeCount + quantity;
  const override = input.productId
    ? policy.productOverrides.find((item) => item.productId === input.productId)
    : undefined;
  const tier = [...policy.tiers].reverse().find((candidate) => cumulativeSalesAfterCount >= candidate.minQuantity);
  if (!tier) throw new Error("找不到符合累積銷量的分潤階梯。");
  const appliedRateBps = override?.rateBps ?? tier.rateBps;
  const grossSalesAmount = unitPriceCents * quantity;
  const commissionAmountCents = Math.round((grossSalesAmount * appliedRateBps) / COMMISSION_RATE_SCALE);
  const matchedTier: MatchedCommissionTier = override
    ? { minQuantity: tier.minQuantity, maxQuantity: tier.maxQuantity, rateBps: appliedRateBps, source: "product_override" }
    : { ...tier, source: "tier" };

  return {
    grossSalesAmount,
    commissionRate: appliedRateBps / COMMISSION_RATE_SCALE,
    appliedRateBps,
    commissionAmountCents,
    vendorNetAmountCents: grossSalesAmount - commissionAmountCents,
    cumulativeSalesBeforeCount,
    cumulativeSalesAfterCount,
    policyVersion: policy.version,
    matchedTier,
  };
}

/** 模擬多件成交時逐件跨階梯，避免把最終高費率錯套到前面的低階成交。 */
export function simulateTieredCommission(input: {
  unitPriceCents: number;
  quantity: number;
  cumulativeSalesBeforeCount?: number;
  productId?: string | null;
  policy: TieredCommissionPolicy;
}) {
  const quantity = PositiveQuantity.parse(input.quantity);
  let totalCommissionAmountCents = 0;
  for (let offset = 0; offset < quantity; offset += 1) {
    totalCommissionAmountCents += calculateTieredCommission({
      ...input,
      quantity: 1,
      cumulativeSalesBeforeCount: (input.cumulativeSalesBeforeCount ?? 0) + offset,
    }).commissionAmountCents;
  }
  const grossSalesAmount = Cents.parse(input.unitPriceCents) * quantity;
  return {
    grossSalesAmount,
    totalCommissionAmountCents,
    vendorNetAmountCents: grossSalesAmount - totalCommissionAmountCents,
  };
}
