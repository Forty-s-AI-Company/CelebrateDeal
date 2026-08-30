import { createHash } from "node:crypto";
import { z } from "zod";

export const MAX_COMMISSION_RATE_BPS = 10_000;

export const AffiliateCommissionRateBps = z.number()
  .int()
  .min(0)
  .max(MAX_COMMISSION_RATE_BPS);

export function commissionAmountCents(amountCents: number, rateBps: number) {
  const safeAmount = z.number().int().nonnegative().parse(amountCents);
  const safeRate = AffiliateCommissionRateBps.parse(rateBps);
  return Math.round((safeAmount * safeRate) / 10_000);
}

export const AffiliateCommissionStatuses = [
  "pending",
  "approved",
  "locked",
  "paid",
  "void",
] as const;

export const AffiliateCommissionStatus = z.enum(AffiliateCommissionStatuses);
export type AffiliateCommissionStatusValue = z.infer<typeof AffiliateCommissionStatus>;

const statusTransitions: Readonly<Record<AffiliateCommissionStatusValue, readonly AffiliateCommissionStatusValue[]>> = {
  pending: ["approved", "locked", "void"],
  approved: ["locked", "void"],
  locked: ["paid", "void"],
  paid: [],
  void: [],
};

export function canTransitionAffiliateCommission(
  from: AffiliateCommissionStatusValue,
  to: AffiliateCommissionStatusValue,
) {
  return statusTransitions[from].includes(to);
}

export function assertAffiliateCommissionTransition(
  from: AffiliateCommissionStatusValue,
  to: AffiliateCommissionStatusValue,
) {
  if (!canTransitionAffiliateCommission(from, to)) {
    throw new Error(`非法佣金狀態轉換：${from} -> ${to}`);
  }
}

function canonicalText(value: string, field: string) {
  const canonical = value.normalize("NFKC").trim();
  if (!canonical) throw new Error(`${field} 不可為空白。`);
  return canonical;
}

function canonicalSourceType(value: string) {
  return canonicalText(value, "sourceType")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, "_");
}

/**
 * External idempotency tokens are intentionally case/format insensitive. The
 * stored key contains only a SHA-256 digest, never the external token itself.
 */
export function canonicalizeCommissionIdempotencyToken(value: string) {
  return canonicalText(value, "idempotency token")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/g, "-");
}

export type CommissionDeduplicationIdentity = {
  affiliateId: string | null | undefined;
  sourceType: string;
  sourceId?: string | null;
  idempotencyToken?: string | null;
};

/**
 * Produces a versioned, non-secret, deterministic key. vendorId is the outer
 * database unique scope; beneficiary is deliberately inside this identity so
 * two affiliates cannot be accidentally merged for the same provider event.
 */
export function buildCommissionDeduplicationKey(identity: CommissionDeduplicationIdentity) {
  const beneficiaryScope = identity.affiliateId
    ? `affiliate:${canonicalText(identity.affiliateId, "affiliateId")}`
    : "unassigned";
  const sourceType = canonicalSourceType(identity.sourceType);
  const sourceId = identity.sourceId == null ? null : canonicalText(identity.sourceId, "sourceId");
  const idempotencyToken = identity.idempotencyToken == null
    ? null
    : canonicalizeCommissionIdempotencyToken(identity.idempotencyToken);

  if (!sourceId && !idempotencyToken) {
    throw new Error("sourceId 為 NULL 時必須提供穩定 idempotency token。");
  }
  if (sourceId && idempotencyToken) {
    throw new Error("佣金 identity 不可同時使用 sourceId 與 idempotency token。");
  }

  const canonicalIdentity = [
    "commission:v1",
    `beneficiary:${beneficiaryScope}`,
    `type:${sourceType}`,
    sourceId ? `source:${sourceId}` : `idempotency:${idempotencyToken}`,
  ].join("|");
  const digest = createHash("sha256").update(canonicalIdentity, "utf8").digest("hex");
  return `commission:v1|sha256:${digest}`;
}

export function assertAffiliateCommissionAmounts(input: {
  sourceType: string;
  orderAmountCents: number;
  commissionAmountCents: number;
}) {
  const sourceType = canonicalSourceType(input.sourceType);
  const orderAmountCents = z.number().int().parse(input.orderAmountCents);
  const commissionAmountCents = z.number().int().parse(input.commissionAmountCents);
  const valid = sourceType === "refund_adjustment"
    ? orderAmountCents <= commissionAmountCents && commissionAmountCents <= 0
    : orderAmountCents >= 0 && commissionAmountCents >= 0 && commissionAmountCents <= orderAmountCents;
  if (!valid) throw new Error("佣金金額不符合來源類型約束。");
}
