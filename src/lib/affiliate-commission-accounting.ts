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
  affiliateCommissionId?: string;
  entryType: CommissionLedgerEntryType;
  providerName: string;
  eventIdentity: string;
  disputeCaseId?: string | null;
}) {
  const entryType = AffiliateCommissionLedgerEntryTypeSchema.parse(input.entryType);
  const providerName = requiredText(input.providerName, "providerName").toLocaleLowerCase("en-US");
  const eventIdentity = requiredText(input.eventIdentity, "eventIdentity");
  const disputeCaseId = input.disputeCaseId == null ? "" : requiredText(input.disputeCaseId, "disputeCaseId");
  const version = input.affiliateCommissionId ? "commission-ledger:v2" : "commission-ledger:v1";
  const canonical = [version, input.affiliateCommissionId ?? "legacy", entryType, providerName, eventIdentity, disputeCaseId].join("|");
  return `${version}|sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function assertCommissionLedgerAmount(entryType: CommissionLedgerEntryType, amountCents: number) {
  const amount = z.number().int().parse(amountCents);
  const valid = entryType === "opening_balance"
    || (entryType === "accrual" && amount > 0)
    || (["refund", "reversal", "dispute_lost"] as const).includes(entryType as "refund") && amount < 0
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

function immutableIdentity(entry: { entryType: CommissionLedgerEntryType; providerName: string; eventIdentity: string; disputeCaseId: string | null; amountCents: number }, input: CommissionLedgerAppendInput) {
  return entry.entryType === input.entryType
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
  // v2 includes the allocation identity so one provider event can fund the
  // promoter and multiple upline leaders without colliding at vendor scope.
  const deduplicationKey = buildCommissionLedgerDeduplicationKey({
    affiliateCommissionId: input.affiliateCommissionId,
    entryType,
    providerName,
    eventIdentity,
    disputeCaseId,
  });
  const matchingEntries = await db.affiliateCommissionLedgerEntry.findMany({
    where: {
      vendorId: input.vendorId,
      affiliateCommissionId: input.affiliateCommissionId,
      entryType,
      providerName,
      eventIdentity,
      disputeCaseId,
    },
  });
  // This identity lookup also preserves idempotency for v1 rows created before
  // multi-beneficiary ledger keys were introduced.
  const matchingEntry = matchingEntries.find((entry) => immutableIdentity(
    entry,
    { ...input, entryType, providerName, eventIdentity, disputeCaseId },
  ));
  if (matchingEntry) {
    if (!immutableIdentity(matchingEntry, { ...input, entryType, providerName, eventIdentity, disputeCaseId })) {
      throw new Error("相同 ledger 事件的不可變身分不一致。 ");
    }
    return matchingEntry;
  }
  const existing = await db.affiliateCommissionLedgerEntry.findUnique({
    where: { vendorId_deduplicationKey: { vendorId: input.vendorId, deduplicationKey } },
  });
  if (existing) {
    if (!immutableIdentity(existing, { ...input, entryType, providerName, eventIdentity, disputeCaseId })) {
      throw new Error("相同 ledger 去重鍵的不可變身分不一致。");
    }
    return existing;
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
    where: { vendorId: input.vendorId, affiliateCommissionId: input.affiliateCommissionId, disputeCaseId },
  });
  const opened = entries.some((entry) => entry.entryType === "dispute_opened");
  const terminal = entries.find((entry) => entry.entryType === "dispute_released" || entry.entryType === "dispute_lost");
  if (input.entryType === "dispute_opened" && opened) {
    return appendCommissionLedgerEntry(db, { ...input, disputeCaseId, amountCents: 0 });
  }
  if (input.entryType !== "dispute_opened" && !opened) throw new Error("dispute outcome 必須先有 opened entry。");
  if (input.entryType !== "dispute_opened" && terminal) {
    if (terminal.entryType !== input.entryType) throw new Error("同一 dispute case 不可同時有 released 與 lost。");
    return appendCommissionLedgerEntry(db, { ...input, disputeCaseId, amountCents: terminal.amountCents });
  }
  const amountCents = input.entryType === "dispute_lost"
    ? -await commissionLedgerBalance(db, input.vendorId, input.affiliateCommissionId)
    : 0;
  if (input.entryType === "dispute_lost" && amountCents === 0) throw new Error("dispute lost 沒有可沖銷的佣金餘額。");
  return appendCommissionLedgerEntry(db, { ...input, disputeCaseId, amountCents });
}
