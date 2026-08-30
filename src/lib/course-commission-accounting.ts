import { createHash } from "node:crypto";
import { Prisma, type CourseCommissionLedgerEntryType } from "@prisma/client";
import { z } from "zod";

export const CourseCommissionLedgerEntryTypes = [
  "opening_balance", "accrual", "refund", "reversal",
  "dispute_opened", "dispute_released", "dispute_lost",
] as const satisfies readonly CourseCommissionLedgerEntryType[];

export const CourseCommissionLedgerEntryTypeSchema = z.enum(CourseCommissionLedgerEntryTypes);
export type CourseCommissionLedgerEntryTypeValue = z.infer<typeof CourseCommissionLedgerEntryTypeSchema>;

function requiredText(value: string, field: string) {
  const canonical = value.normalize("NFKC").trim();
  if (!canonical) throw new Error(`${field} 不可為空白。`);
  return canonical;
}

export function buildCourseCommissionLedgerDeduplicationKey(input: {
  allocationId: string;
  entryType: CourseCommissionLedgerEntryTypeValue;
  providerName: string;
  eventIdentity: string;
  disputeCaseId?: string | null;
}) {
  const allocationId = requiredText(input.allocationId, "allocationId");
  const entryType = CourseCommissionLedgerEntryTypeSchema.parse(input.entryType);
  const providerName = requiredText(input.providerName, "providerName").toLocaleLowerCase("en-US");
  const eventIdentity = requiredText(input.eventIdentity, "eventIdentity");
  const disputeCaseId = input.disputeCaseId == null ? "" : requiredText(input.disputeCaseId, "disputeCaseId");
  const canonical = ["course-commission-ledger:v1", allocationId, entryType, providerName, eventIdentity, disputeCaseId].join("|");
  return `course-commission-ledger:v1|sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function assertCourseCommissionLedgerAmount(entryType: CourseCommissionLedgerEntryTypeValue, amountCents: number) {
  const amount = z.number().int().parse(amountCents);
  const valid = entryType === "opening_balance"
    || (entryType === "accrual" && amount > 0)
    || (["refund", "reversal", "dispute_lost"] as const).includes(entryType as "refund") && amount < 0
    || (["dispute_opened", "dispute_released"] as const).includes(entryType as "dispute_opened") && amount === 0;
  if (!valid) throw new Error("課程分潤 ledger entry 金額方向不符合 entry type。 ");
}

export type CourseCommissionLedgerAppendInput = {
  vendorId: string;
  courseCommissionAllocationId: string;
  entryType: CourseCommissionLedgerEntryTypeValue;
  providerName: string;
  eventIdentity: string;
  disputeCaseId?: string | null;
  amountCents: number;
  occurredAt: Date;
};

type LedgerClient = Pick<Prisma.TransactionClient, "courseCommissionLedgerEntry">;

function immutableIdentity(
  entry: { entryType: CourseCommissionLedgerEntryTypeValue; providerName: string; eventIdentity: string; disputeCaseId: string | null; amountCents: number },
  input: CourseCommissionLedgerAppendInput,
) {
  return entry.entryType === input.entryType
    && entry.providerName === requiredText(input.providerName, "providerName")
    && entry.eventIdentity === requiredText(input.eventIdentity, "eventIdentity")
    && entry.disputeCaseId === (input.disputeCaseId == null ? null : requiredText(input.disputeCaseId, "disputeCaseId"))
    && entry.amountCents === input.amountCents;
}

export async function courseCommissionLedgerBalance(
  db: LedgerClient,
  vendorId: string,
  courseCommissionAllocationId: string,
) {
  const aggregate = await db.courseCommissionLedgerEntry.aggregate({
    where: { vendorId, courseCommissionAllocationId },
    _sum: { amountCents: true },
  });
  return aggregate._sum.amountCents ?? 0;
}

export async function appendCourseCommissionLedgerEntry(db: LedgerClient, input: CourseCommissionLedgerAppendInput) {
  const entryType = CourseCommissionLedgerEntryTypeSchema.parse(input.entryType);
  const providerName = requiredText(input.providerName, "providerName");
  const eventIdentity = requiredText(input.eventIdentity, "eventIdentity");
  const disputeCaseId = input.disputeCaseId == null ? null : requiredText(input.disputeCaseId, "disputeCaseId");
  if (entryType.startsWith("dispute_") && !disputeCaseId) throw new Error("課程 dispute entry 必須有穩定 case identity。 ");
  assertCourseCommissionLedgerAmount(entryType, input.amountCents);
  const deduplicationKey = buildCourseCommissionLedgerDeduplicationKey({
    allocationId: input.courseCommissionAllocationId,
    entryType,
    providerName,
    eventIdentity,
    disputeCaseId,
  });
  const existing = await db.courseCommissionLedgerEntry.findUnique({
    where: { vendorId_deduplicationKey: { vendorId: input.vendorId, deduplicationKey } },
  });
  if (existing) {
    if (!immutableIdentity(existing, { ...input, entryType, providerName, eventIdentity, disputeCaseId })) {
      throw new Error("相同課程 ledger 去重鍵的不可變身分不一致。 ");
    }
    return existing;
  }

  const currentBalance = await courseCommissionLedgerBalance(db, input.vendorId, input.courseCommissionAllocationId);
  if (currentBalance + input.amountCents < 0) throw new Error("課程分潤 ledger 淨額不可低於零。 ");
  return db.courseCommissionLedgerEntry.create({
    data: {
      vendorId: input.vendorId,
      courseCommissionAllocationId: input.courseCommissionAllocationId,
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

export async function appendCourseDisputeLedgerEntry(
  db: LedgerClient,
  input: Omit<CourseCommissionLedgerAppendInput, "amountCents"> & { entryType: "dispute_opened" | "dispute_released" | "dispute_lost" },
) {
  const disputeCaseId = requiredText(input.disputeCaseId ?? "", "disputeCaseId");
  const entries = await db.courseCommissionLedgerEntry.findMany({
    where: { vendorId: input.vendorId, courseCommissionAllocationId: input.courseCommissionAllocationId, disputeCaseId },
  });
  const opened = entries.some((entry) => entry.entryType === "dispute_opened");
  const terminal = entries.find((entry) => entry.entryType === "dispute_released" || entry.entryType === "dispute_lost");
  if (input.entryType === "dispute_opened" && opened) {
    return appendCourseCommissionLedgerEntry(db, { ...input, disputeCaseId, amountCents: 0 });
  }
  if (input.entryType !== "dispute_opened" && !opened) throw new Error("課程 dispute outcome 必須先有 opened entry。 ");
  if (input.entryType !== "dispute_opened" && terminal) {
    if (terminal.entryType !== input.entryType) throw new Error("同一課程 dispute case 不可同時有 released 與 lost。 ");
    return appendCourseCommissionLedgerEntry(db, { ...input, disputeCaseId, amountCents: terminal.amountCents });
  }
  const amountCents = input.entryType === "dispute_lost"
    ? -await courseCommissionLedgerBalance(db, input.vendorId, input.courseCommissionAllocationId)
    : 0;
  if (input.entryType === "dispute_lost" && amountCents === 0) throw new Error("課程 dispute lost 沒有可沖銷的分潤餘額。 ");
  return appendCourseCommissionLedgerEntry(db, { ...input, disputeCaseId, amountCents });
}
