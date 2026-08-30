import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { commissionAmountCents, AffiliateCommissionRateBps } from "@/lib/affiliate-commission";

export type PlatformReferralCommissionEntryType =
  | "accrual"
  | "refund"
  | "reversal"
  | "dispute_opened"
  | "dispute_released"
  | "dispute_lost";

export type PlatformReferralCommissionDb = Pick<
  Prisma.TransactionClient,
  "platformReferralAttribution" | "platformReferralCommission" | "platformReferralCommissionLedgerEntry"
>;

type CommissionIdentity = {
  ownerUserId: string;
  vendorId: string;
  subscriptionId: string;
  paymentTransactionId: string;
  codeSnapshot: string;
  commissionRateBpsSnapshot: number;
  grossAmountCents: number;
  commissionAmountCents: number;
  currency: string;
  monthKey: string;
};

function requiredText(value: string, field: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new Error(`${field} 不可為空白。`);
  return normalized;
}

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function ledgerDeduplicationKey(input: {
  commissionId: string;
  entryType: PlatformReferralCommissionEntryType;
  providerName: string;
  eventIdentity: string;
  disputeCaseId: string | null;
}) {
  const canonical = [
    "platform-referral-ledger:v1",
    requiredText(input.commissionId, "commissionId"),
    input.entryType,
    requiredText(input.providerName, "providerName").toLocaleLowerCase("en-US"),
    requiredText(input.eventIdentity, "eventIdentity"),
    ...(input.disputeCaseId ? [requiredText(input.disputeCaseId, "disputeCaseId")] : []),
  ].join("|");
  return `platform-referral-ledger:v1|sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

async function ledgerBalance(db: PlatformReferralCommissionDb, commissionId: string) {
  const aggregate = await db.platformReferralCommissionLedgerEntry.aggregate({
    where: { platformReferralCommissionId: commissionId },
    _sum: { amountCents: true },
  });
  return aggregate._sum.amountCents ?? 0;
}

export async function appendPlatformReferralCommissionLedgerEntry(
  db: PlatformReferralCommissionDb,
  input: {
    commissionId: string;
    entryType: PlatformReferralCommissionEntryType;
    amountCents: number;
    providerName: string;
    eventIdentity: string;
    disputeCaseId?: string | null;
    occurredAt: Date;
  },
) {
  const isDisputeEntry = input.entryType.startsWith("dispute_");
  const disputeCaseId = input.disputeCaseId == null ? null : requiredText(input.disputeCaseId, "disputeCaseId");
  if (isDisputeEntry && !disputeCaseId) throw new Error("平台推薦 dispute entry 必須有穩定 case identity。 ");
  if (!Number.isSafeInteger(input.amountCents)) throw new Error("平台推薦 ledger 金額必須是安全整數。 ");
  if (input.entryType === "accrual" && input.amountCents <= 0) throw new Error("平台推薦 accrual 必須為正數。 ");
  if (["refund", "reversal", "dispute_lost"].includes(input.entryType) && input.amountCents >= 0) {
    throw new Error("平台推薦 reversal／dispute lost 必須為負數。 ");
  }
  if (["dispute_opened", "dispute_released"].includes(input.entryType) && input.amountCents !== 0) {
    throw new Error("平台推薦 dispute opened／released 不可改變 payable balance。 ");
  }

  const providerName = requiredText(input.providerName, "providerName");
  const eventIdentity = requiredText(input.eventIdentity, "eventIdentity");
  const deduplicationKey = ledgerDeduplicationKey({
    commissionId: input.commissionId,
    entryType: input.entryType,
    providerName,
    eventIdentity,
    disputeCaseId,
  });
  const existing = await db.platformReferralCommissionLedgerEntry.findUnique({
    where: {
      platformReferralCommissionId_deduplicationKey: {
        platformReferralCommissionId: input.commissionId,
        deduplicationKey,
      },
    },
  });
  if (existing) {
    if (
      existing.entryType !== input.entryType
      || existing.amountCents !== input.amountCents
      || existing.providerName !== providerName
      || existing.eventIdentity !== eventIdentity
      || (existing.disputeCaseId ?? null) !== disputeCaseId
    ) throw new Error("相同平台推薦 ledger identity 不可改寫。 ");
    return existing;
  }

  const currentBalance = await ledgerBalance(db, input.commissionId);
  if (currentBalance + input.amountCents < 0) throw new Error("平台推薦 ledger 淨額不可低於零。 ");
  return db.platformReferralCommissionLedgerEntry.create({
    data: {
      platformReferralCommissionId: input.commissionId,
      entryType: input.entryType,
      amountCents: input.amountCents,
      providerName,
      eventIdentity,
      disputeCaseId,
      deduplicationKey,
      occurredAt: input.occurredAt,
    },
  });
}

export async function appendPlatformReferralDisputeLedgerEntry(
  db: PlatformReferralCommissionDb,
  input: {
    commissionId: string;
    entryType: "dispute_opened" | "dispute_released" | "dispute_lost";
    providerName: string;
    eventIdentity: string;
    disputeCaseId: string;
    occurredAt: Date;
  },
) {
  const disputeCaseId = requiredText(input.disputeCaseId, "disputeCaseId");
  const entries = await db.platformReferralCommissionLedgerEntry.findMany({
    where: { platformReferralCommissionId: input.commissionId, disputeCaseId },
    orderBy: { createdAt: "asc" },
  });
  const opened = entries.find((entry) => entry.entryType === "dispute_opened");
  const terminal = entries.find((entry) => entry.entryType === "dispute_released" || entry.entryType === "dispute_lost");
  if (input.entryType === "dispute_opened" && opened) return opened;
  if (input.entryType !== "dispute_opened" && !opened) {
    throw new Error("平台推薦 dispute outcome 必須先有 opened entry。 ");
  }
  if (terminal) {
    if (terminal.entryType === input.entryType) return terminal;
    throw new Error("同一平台推薦 dispute case 不可同時有 released 與 lost。 ");
  }

  const currentBalance = await ledgerBalance(db, input.commissionId);
  const amountCents = input.entryType === "dispute_lost" ? -currentBalance : 0;
  if (input.entryType === "dispute_lost" && amountCents === 0) {
    throw new Error("平台推薦 dispute lost 沒有可沖銷的分潤餘額。 ");
  }
  return appendPlatformReferralCommissionLedgerEntry(db, {
    ...input,
    disputeCaseId,
    amountCents,
  });
}

function assertCommissionIdentity(existing: CommissionIdentity, expected: CommissionIdentity) {
  for (const [field, value] of Object.entries(expected)) {
    if (existing[field as keyof CommissionIdentity] !== value) {
      throw new Error(`平台推薦佣金不可變 identity 不一致：${field}`);
    }
  }
}

export async function accruePlatformReferralCommission(
  db: PlatformReferralCommissionDb,
  input: {
    vendorId: string;
    subscriptionId: string;
    paymentTransactionId: string;
    providerName: string;
    eventIdentity: string;
    grossAmountCents: number;
    currency: string;
    occurredAt: Date;
    hasRefundedOrder: boolean;
  },
) {
  if (input.hasRefundedOrder || input.grossAmountCents <= 0) return null;

  const attribution = await db.platformReferralAttribution.findUnique({
    where: { subscriptionId: input.subscriptionId },
    select: {
      ownerUserId: true,
      codeSnapshot: true,
      commissionRateBpsSnapshot: true,
      subscription: { select: { vendorId: true } },
    },
  });
  if (!attribution || attribution.subscription.vendorId !== input.vendorId) return null;

  const commissionRateBpsSnapshot = AffiliateCommissionRateBps.parse(attribution.commissionRateBpsSnapshot);
  const expected: CommissionIdentity = {
    ownerUserId: attribution.ownerUserId,
    vendorId: input.vendorId,
    subscriptionId: input.subscriptionId,
    paymentTransactionId: input.paymentTransactionId,
    codeSnapshot: requiredText(attribution.codeSnapshot, "codeSnapshot"),
    commissionRateBpsSnapshot,
    grossAmountCents: input.grossAmountCents,
    commissionAmountCents: commissionAmountCents(input.grossAmountCents, commissionRateBpsSnapshot),
    currency: requiredText(input.currency, "currency").toUpperCase(),
    monthKey: monthKey(input.occurredAt),
  };
  if (expected.commissionAmountCents === 0) return null;

  const existing = await db.platformReferralCommission.findUnique({
    where: { paymentTransactionId: input.paymentTransactionId },
  });
  if (existing) {
    assertCommissionIdentity(existing, expected);
    return existing;
  }

  // Product rule: one platform referral commission per new subscription. A
  // recurring payment on the same subscription is a renewal, not a second
  // referral sale. The unique database constraint is the race-safe backstop;
  // this read keeps the normal webhook path explicit and auditable.
  const priorSubscriptionCommission = await db.platformReferralCommission.findUnique({
    where: { subscriptionId: input.subscriptionId },
    select: { id: true },
  });
  if (priorSubscriptionCommission) return null;

  const commission = await db.platformReferralCommission.create({ data: { ...expected, status: "pending" } });
  await appendPlatformReferralCommissionLedgerEntry(db, {
    commissionId: commission.id,
    entryType: "accrual",
    amountCents: commission.commissionAmountCents,
    providerName: input.providerName,
    eventIdentity: `paid:${input.eventIdentity}`,
    occurredAt: input.occurredAt,
  });
  return commission;
}

export async function applyPlatformReferralRefund(
  db: PlatformReferralCommissionDb,
  input: {
    paymentTransactionId: string;
    providerName: string;
    eventIdentity: string;
    refundAmountCents: number;
    isFullRefund: boolean;
    occurredAt: Date;
  },
) {
  if (input.refundAmountCents <= 0) return null;
  const commission = await db.platformReferralCommission.findUnique({
    where: { paymentTransactionId: input.paymentTransactionId },
  });
  if (!commission) return null;

  const currentBalance = await ledgerBalance(db, commission.id);
  const refundAmount = input.isFullRefund
    ? currentBalance
    : Math.min(
        currentBalance,
        Math.round((commission.commissionAmountCents * input.refundAmountCents) / commission.grossAmountCents),
      );
  if (refundAmount > 0) {
    await appendPlatformReferralCommissionLedgerEntry(db, {
      commissionId: commission.id,
      entryType: "refund",
      amountCents: -refundAmount,
      providerName: input.providerName,
      eventIdentity: `refund:${input.eventIdentity}`,
      occurredAt: input.occurredAt,
    });
  }

  return db.platformReferralCommission.update({
    where: { id: commission.id },
    data: { status: input.isFullRefund ? "void" : commission.status },
  });
}

export async function applyPlatformReferralDispute(
  db: PlatformReferralCommissionDb,
  input: {
    paymentTransactionId: string;
    entryType: "dispute_opened" | "dispute_released" | "dispute_lost";
    providerName: string;
    eventIdentity: string;
    disputeCaseId: string;
    occurredAt: Date;
  },
) {
  const commission = await db.platformReferralCommission.findUnique({
    where: { paymentTransactionId: input.paymentTransactionId },
  });
  if (!commission) return null;

  await appendPlatformReferralDisputeLedgerEntry(db, {
    commissionId: commission.id,
    entryType: input.entryType,
    providerName: input.providerName,
    eventIdentity: input.eventIdentity,
    disputeCaseId: input.disputeCaseId,
    occurredAt: input.occurredAt,
  });
  return db.platformReferralCommission.update({
    where: { id: commission.id },
    data: { status: input.entryType === "dispute_lost" ? "void" : commission.status },
  });
}
