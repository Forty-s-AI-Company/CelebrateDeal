import { describe, expect, it } from "vitest";
import {
  appendCommissionLedgerEntry,
  appendDisputeLedgerEntry,
  assertCommissionLedgerAmount,
  buildCommissionLedgerDeduplicationKey,
} from "@/lib/affiliate-commission-accounting";

type Entry = {
  id: string;
  vendorId: string;
  affiliateCommissionId: string;
  entryType: "opening_balance" | "accrual" | "refund" | "reversal" | "dispute_opened" | "dispute_released" | "dispute_lost";
  deduplicationKey: string;
  providerName: string;
  eventIdentity: string;
  disputeCaseId: string | null;
  amountCents: number;
  occurredAt: Date;
  createdAt: Date;
};

function ledgerFixture() {
  const entries: Entry[] = [];
  const client = {
    affiliateCommissionLedgerEntry: {
      findUnique: async ({ where }: { where: { vendorId_deduplicationKey: { vendorId: string; deduplicationKey: string } } }) =>
        entries.find((entry) => entry.vendorId === where.vendorId_deduplicationKey.vendorId
          && entry.deduplicationKey === where.vendorId_deduplicationKey.deduplicationKey) ?? null,
      aggregate: async ({ where }: { where: { vendorId: string; affiliateCommissionId: string } }) => ({
        _sum: {
          amountCents: entries
            .filter((entry) => entry.vendorId === where.vendorId && entry.affiliateCommissionId === where.affiliateCommissionId)
            .reduce((sum, entry) => sum + entry.amountCents, 0),
        },
      }),
      create: async ({ data }: { data: Omit<Entry, "id" | "createdAt"> }) => {
        const entry: Entry = { ...data, id: `entry-${entries.length + 1}`, createdAt: new Date() };
        entries.push(entry);
        return entry;
      },
      findMany: async ({ where }: { where: { vendorId: string; affiliateCommissionId: string; disputeCaseId: string } }) =>
        entries.filter((entry) => entry.vendorId === where.vendorId
          && entry.affiliateCommissionId === where.affiliateCommissionId
          && entry.disputeCaseId === where.disputeCaseId),
    },
  } as unknown as Parameters<typeof appendCommissionLedgerEntry>[0];
  return { client, entries };
}

const base = {
  vendorId: "vendor-a",
  affiliateCommissionId: "commission-a",
  providerName: "synthetic",
  occurredAt: new Date("2026-07-28T00:00:00.000Z"),
};

describe("affiliate commission accounting ledger", () => {
  it("uses an amount-independent, versioned immutable identity", () => {
    const first = buildCommissionLedgerDeduplicationKey({
      entryType: "refund", providerName: "Demo", eventIdentity: "event-1",
    });
    const retry = buildCommissionLedgerDeduplicationKey({
      entryType: "refund", providerName: "demo", eventIdentity: "event-1",
    });
    expect(first).toBe(retry);
    expect(first).toMatch(/^commission-ledger:v1\|sha256:/);
  });

  it("rejects invalid direction before any write", () => {
    expect(() => assertCommissionLedgerAmount("accrual", 0)).toThrow("金額方向");
    expect(() => assertCommissionLedgerAmount("refund", 1)).toThrow("金額方向");
    expect(() => assertCommissionLedgerAmount("dispute_opened", 1)).toThrow("金額方向");
  });

  it("creates or reads one entry and rejects an over-reversal", async () => {
    const { client, entries } = ledgerFixture();
    await appendCommissionLedgerEntry(client, { ...base, entryType: "accrual", eventIdentity: "paid-1", amountCents: 500 });
    const refund = { ...base, entryType: "refund" as const, eventIdentity: "refund-1", amountCents: -200 };
    await appendCommissionLedgerEntry(client, refund);
    await appendCommissionLedgerEntry(client, refund);
    expect(entries).toHaveLength(2);
    await expect(appendCommissionLedgerEntry(client, {
      ...base, entryType: "reversal", eventIdentity: "reverse-1", amountCents: -301,
    })).rejects.toThrow("淨額不可低於零");
  });

  it("enforces synthetic dispute ordering and loses only the remaining balance", async () => {
    const { client, entries } = ledgerFixture();
    await appendCommissionLedgerEntry(client, { ...base, entryType: "accrual", eventIdentity: "paid-2", amountCents: 500 });
    await expect(appendDisputeLedgerEntry(client, {
      ...base, entryType: "dispute_lost", eventIdentity: "lost-before-open", disputeCaseId: "case-1",
    })).rejects.toThrow("先有 opened");
    await appendDisputeLedgerEntry(client, {
      ...base, entryType: "dispute_opened", eventIdentity: "opened-1", disputeCaseId: "case-1",
    });
    await appendDisputeLedgerEntry(client, {
      ...base, entryType: "dispute_lost", eventIdentity: "lost-1", disputeCaseId: "case-1",
    });
    expect(entries.at(-1)?.amountCents).toBe(-500);
    await expect(appendDisputeLedgerEntry(client, {
      ...base, entryType: "dispute_released", eventIdentity: "released-after-lost", disputeCaseId: "case-1",
    })).rejects.toThrow("不可同時");
  });
});
