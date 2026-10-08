import { createHash } from "node:crypto";
import { Prisma, type AffiliateCommissionLedgerEntryType } from "@prisma/client";
import { z } from "zod";

export const AffiliateCommissionLedgerEntryTypes = [
  "opening_balance", "accrual", "refund", "reversal",
  "dispute_opened", "dispute_released", "dispute_lost",
] as const satisfies readonly AffiliateCommissionLedgerEntryType[];

export const AffiliateCommissionLedgerEntryTypeSchema = z.enum(AffiliateCommissionLedgerEntryTypes);
export type CommissionLedgerEntryType = z.infer<typeof AffiliateCommissionLedgerEntryTypeSchema>;

function requiredText(value: string, field: string) {
  const canonical = value.normalize("NFKC").trim();
  if (!canonical) throw new Error(`${field} 不可為空白。`);
  return canonical;
}

/** The key deliberately excludes amount, reason and time so retries read back the same entry. */
export function buildCommissionLedgerDeduplicationKey(input: {
  entryType: CommissionLedgerEntryType;
  providerName: string;
  eventIdentity: string;
  disputeCaseId?: string | null;
}) {
  const entryType = AffiliateCommissionLedgerEntryTypeSchema.parse(input.entryType);
  const providerName = requiredText(input.providerName, "providerName").toLocaleLowerCase("en-US");
  const eventIdentity = requiredText(input.eventIdentity, "eventIdentity");
  const disputeCaseId = input.disputeCaseId == null ? "" : requiredText(input.disputeCaseId, "disputeCaseId");
  const canonical = ["commission-ledger:v1", entryType, providerName, eventIdentity, disputeCaseId].join("|");
  return `commission-ledger:v1|sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** v2 scopes one provider event to one beneficiary. Existing v1 entries remain
 * immutable and are read only when they belong to this same commission. */
export function buildCommissionLedgerDeduplicationKeyV2(input: Parameters<typeof buildCommissionLedgerDeduplicationKey>[0] & { affiliateCommissionId: string }) {
  const commissionId = z.string().trim().min(1).max(191).parse(input.affiliateCommissionId);
  const canonical = ["commission-ledger:v2", commissionId, buildCommissionLedgerDeduplicationKey(input)].join("|");
  return `commission-ledger:v2|sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function assertCommissionLedgerAmount(entryType: CommissionLedgerEntryType, amountCents: number) {
  const amount = z.number().int().parse(amountCents);
  const valid = entryType === "opening_balance"
    || (entryType === "accrual" && amount > 0)
    || (["refund", "reversal"] as const).includes(entryType as "refund") && amount < 0
    || (entryType === "dispute_lost" && amount <= 0)
    || (["dispute_opened", "dispute_released"] as const).includes(entryType as "dispute_opened") && amount === 0;
  if (!valid) throw new Error("ledger entry 金額方向不符合 entry type。 ");
}

export type CommissionLedgerAppendInput = {
  vendorId: string;
  affiliateCommissionId: string;
  entryType: CommissionLedgerEntryType;
  providerName: string;
  eventIdentity: string;
  disputeCaseId?: string | null;
  amountCents: number;
  occurredAt: Date;
};

type LedgerClient = Pick<Prisma.TransactionClient, "affiliateCommissionLedgerEntry">;

function immutableIdentity(entry: { vendorId: string; affiliateCommissionId: string; entryType: CommissionLedgerEntryType; providerName: string; eventIdentity: string; disputeCaseId: string | null; amountCents: number }, input: CommissionLedgerAppendInput) {
  return entry.vendorId === input.vendorId
    && entry.affiliateCommissionId === input.affiliateCommissionId
    && entry.entryType === input.entryType
    && entry.providerName === requiredText(input.providerName, "providerName")
    && entry.eventIdentity === requiredText(input.eventIdentity, "eventIdentity")
    && entry.disputeCaseId === (input.disputeCaseId == null ? null : requiredText(input.disputeCaseId, "disputeCaseId"))
    && entry.amountCents === input.amountCents;
}

export async function commissionLedgerBalance(
  db: LedgerClient,
  vendorId: string,
  affiliateCommissionId: string,
) {
  const aggregate = await db.affiliateCommissionLedgerEntry.aggregate({
    where: { vendorId, affiliateCommissionId },
    _sum: { amountCents: true },
  });
  return aggregate._sum.amountCents ?? 0;
}

export async function appendCommissionLedgerEntry(db: LedgerClient, input: CommissionLedgerAppendInput) {
  const entryType = AffiliateCommissionLedgerEntryTypeSchema.parse(input.entryType);
  const providerName = requiredText(input.providerName, "providerName");
  const eventIdentity = requiredText(input.eventIdentity, "eventIdentity");
  const disputeCaseId = input.disputeCaseId == null ? null : requiredText(input.disputeCaseId, "disputeCaseId");
  if (entryType.startsWith("dispute_") && !disputeCaseId) throw new Error("dispute entry 必須有穩定 case identity。");
  assertCommissionLedgerAmount(entryType, input.amountCents);
  const deduplicationKey = buildCommissionLedgerDeduplicationKeyV2({ affiliateCommissionId: input.affiliateCommissionId, entryType, providerName, eventIdentity, disputeCaseId });
  const existing = await db.affiliateCommissionLedgerEntry.findUnique({
    where: { vendorId_deduplicationKey: { vendorId: input.vendorId, deduplicationKey } },
  });
  if (existing) {
    if (!immutableIdentity(existing, { ...input, entryType, providerName, eventIdentity, disputeCaseId })) {
      throw new Error("相同 ledger 去重鍵的不可變身分不一致。");
    }
    return existing;
  }

  // A mixed-version rollout must not append a second accrual/refund for a
  // historical v1 event. A different beneficiary's v1 key never grants access
  // to that row and must not block this beneficiary's independent v2 entry.
  const legacy = await db.affiliateCommissionLedgerEntry.findUnique({
    where: { vendorId_deduplicationKey: { vendorId: input.vendorId, deduplicationKey: buildCommissionLedgerDeduplicationKey({ entryType, providerName, eventIdentity, disputeCaseId }) } },
  });
  if (legacy?.affiliateCommissionId === input.affiliateCommissionId) {
    if (!immutableIdentity(legacy, { ...input, entryType, providerName, eventIdentity, disputeCaseId })) {
      throw new Error("相同歷史 ledger 去重鍵的不可變身分不一致。");
    }
    return legacy;
  }

  const currentBalance = await commissionLedgerBalance(db, input.vendorId, input.affiliateCommissionId);
  if (currentBalance + input.amountCents < 0) throw new Error("ledger 淨額不可低於零。");
  return db.affiliateCommissionLedgerEntry.create({
    data: {
      vendorId: input.vendorId,
      affiliateCommissionId: input.affiliateCommissionId,
      entryType,
      deduplicationKey,
      providerName,
      eventIdentity,
      disputeCaseId,
      amountCents: input.amountCents,
      occurredAt: input.occurredAt,
    },
  });
}

export async function appendDisputeLedgerEntry(
  db: LedgerClient,
  input: Omit<CommissionLedgerAppendInput, "amountCents"> & { entryType: "dispute_opened" | "dispute_released" | "dispute_lost" },
) {
  const disputeCaseId = requiredText(input.disputeCaseId ?? "", "disputeCaseId");
  const entries = await db.affiliateCommissionLedgerEntry.findMany({
    where: { vendorId: input.vendorId, affiliateCommissionId: input.affiliateCommissionId, disputeCaseId, providerName: requiredText(input.providerName, "providerName") },
  });
  const opened = entries.find((entry) => entry.entryType === "dispute_opened");
  const terminal = entries.find((entry) => entry.entryType === "dispute_released" || entry.entryType === "dispute_lost");
  if (input.entryType === "dispute_opened" && opened) {
    return opened;
  }
  if (input.entryType !== "dispute_opened" && !opened) throw new Error("dispute outcome 必須先有 opened entry。");
  if (input.entryType !== "dispute_opened" && terminal) {
    if (terminal.entryType !== input.entryType) throw new Error("同一 dispute case 不可同時有 released 與 lost。");
    return terminal;
  }
  const amountCents = input.entryType === "dispute_lost"
    ? -await commissionLedgerBalance(db, input.vendorId, input.affiliateCommissionId)
    : 0;
  return appendCommissionLedgerEntry(db, { ...input, disputeCaseId, amountCents });
}

/** Accounting balance remains refundable; an unresolved case independently
 * holds the full remaining amount until its terminal outcome is recorded. */
export async function commissionLedgerPayableState(db: LedgerClient, vendorId: string, affiliateCommissionId: string) {
  const balanceCents = await commissionLedgerBalance(db, vendorId, affiliateCommissionId);
  const entries = await db.affiliateCommissionLedgerEntry.findMany({ where: { vendorId, affiliateCommissionId, entryType: { in: ["dispute_opened", "dispute_released", "dispute_lost"] } }, select: { entryType: true, providerName: true, disputeCaseId: true } });
  const key = (entry: typeof entries[number]) => JSON.stringify([entry.providerName, entry.disputeCaseId]);
  const terminal = new Set(entries.filter(entry => entry.entryType !== "dispute_opened").map(key));
  const hasOpenDispute = entries.some(entry => entry.entryType === "dispute_opened" && !terminal.has(key(entry)));
  return { balanceCents, hasOpenDispute, heldCents: hasOpenDispute ? balanceCents : 0, payableCents: hasOpenDispute ? 0 : balanceCents };
}
