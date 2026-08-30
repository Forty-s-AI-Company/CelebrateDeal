import { describe, expect, it } from "vitest";
import {
  appendCourseCommissionLedgerEntry,
  appendCourseDisputeLedgerEntry,
  buildCourseCommissionLedgerDeduplicationKey,
  courseCommissionLedgerBalance,
} from "@/lib/course-commission-accounting";

function ledgerClient() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    courseCommissionLedgerEntry: {
      aggregate: async ({ where }: { where: { vendorId: string; courseCommissionAllocationId: string } }) => ({
        _sum: {
          amountCents: rows
            .filter((row) => row.vendorId === where.vendorId && row.courseCommissionAllocationId === where.courseCommissionAllocationId)
            .reduce((sum, row) => sum + Number(row.amountCents), 0),
        },
      }),
      findUnique: async ({ where }: { where: { vendorId_deduplicationKey: { vendorId: string; deduplicationKey: string } } }) => rows.find(
        (row) => row.vendorId === where.vendorId_deduplicationKey.vendorId && row.deduplicationKey === where.vendorId_deduplicationKey.deduplicationKey,
      ) ?? null,
      findMany: async ({ where }: { where: { vendorId: string; courseCommissionAllocationId: string; disputeCaseId: string } }) => rows.filter(
        (row) => row.vendorId === where.vendorId
          && row.courseCommissionAllocationId === where.courseCommissionAllocationId
          && row.disputeCaseId === where.disputeCaseId,
      ),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `ledger-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      },
    },
  };
}

describe("course commission accounting ledger", () => {
  it("uses an allocation-scoped, hashed idempotency key", () => {
    expect(buildCourseCommissionLedgerDeduplicationKey({
      allocationId: "allocation-a",
      entryType: "accrual",
      providerName: "DEMO",
      eventIdentity: "event-a",
    })).toMatch(/^course-commission-ledger:v1\|sha256:[a-f0-9]{64}$/);
  });

  it("deduplicates an accrual and rejects an inconsistent retry", async () => {
    const client = ledgerClient();
    const input = {
      vendorId: "vendor-a",
      courseCommissionAllocationId: "allocation-a",
      entryType: "accrual" as const,
      providerName: "demo",
      eventIdentity: "event-paid-a",
      amountCents: 8_000,
      occurredAt: new Date("2026-08-07T00:00:00.000Z"),
    };
    const first = await appendCourseCommissionLedgerEntry(client as never, input);
    const retry = await appendCourseCommissionLedgerEntry(client as never, input);
    expect(retry).toEqual(first);
    await expect(appendCourseCommissionLedgerEntry(client as never, { ...input, amountCents: 7_000 })).rejects.toThrow(/不可變身分/);
    await expect(courseCommissionLedgerBalance(client as never, "vendor-a", "allocation-a")).resolves.toBe(8_000);
  });

  it("requires an opened dispute before a loss can reverse the balance", async () => {
    const client = ledgerClient();
    await appendCourseCommissionLedgerEntry(client as never, {
      vendorId: "vendor-a",
      courseCommissionAllocationId: "allocation-a",
      entryType: "accrual",
      providerName: "demo",
      eventIdentity: "event-paid-a",
      amountCents: 8_000,
      occurredAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    await expect(appendCourseDisputeLedgerEntry(client as never, {
      vendorId: "vendor-a",
      courseCommissionAllocationId: "allocation-a",
      entryType: "dispute_lost",
      providerName: "demo",
      eventIdentity: "event-dispute-lost-a",
      disputeCaseId: "case-a",
      occurredAt: new Date("2026-08-07T00:00:00.000Z"),
    })).rejects.toThrow(/opened/);
    await appendCourseDisputeLedgerEntry(client as never, {
      vendorId: "vendor-a",
      courseCommissionAllocationId: "allocation-a",
      entryType: "dispute_opened",
      providerName: "demo",
      eventIdentity: "event-dispute-opened-a",
      disputeCaseId: "case-a",
      occurredAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    await appendCourseDisputeLedgerEntry(client as never, {
      vendorId: "vendor-a",
      courseCommissionAllocationId: "allocation-a",
      entryType: "dispute_lost",
      providerName: "demo",
      eventIdentity: "event-dispute-lost-a",
      disputeCaseId: "case-a",
      occurredAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    await expect(courseCommissionLedgerBalance(client as never, "vendor-a", "allocation-a")).resolves.toBe(0);
  });
});
