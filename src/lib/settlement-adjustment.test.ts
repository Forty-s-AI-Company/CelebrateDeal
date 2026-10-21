import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { requiresSecondApproval, submitSettlementAdjustment } from "@/lib/settlement-adjustment";

const updatedAt = new Date("2026-08-05T08:00:00.000Z");
const settlement = {
  id: "settlement-1", vendorId: "vendor-1", monthKey: "2026-07", lockedAt: null, updatedAt,
  payoutableAmountCents: 10_000, adjustmentAmountCents: 0,
};
const actor = { id: "admin-a", label: "platform_admin" };

function fakeDb(overrides: { updateCount?: number; transactionError?: unknown } = {}) {
  const tx = {
    settlement: {
      findUnique: vi.fn(async () => settlement),
      updateMany: vi.fn(async () => ({ count: overrides.updateCount ?? 1 })),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    settlementAdjustmentLedgerEntry: { findUnique: vi.fn(async () => null), create: vi.fn(), update: vi.fn() },
    settlementAdjustmentRequest: { updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const db = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => {
      if (overrides.transactionError) throw overrides.transactionError;
      return callback(tx);
    }),
  };
  return { db, tx };
}

describe("settlement adjustment write guards (F-049, review m-5)", () => {
  it("rejects a negative payable before any write", async () => {
    const { db, tx } = fakeDb();
    await expect(submitSettlementAdjustment(db as never, { settlementId: settlement.id, amountCents: -10_100, reason: "r", actor, thresholdCents: 5_000_000 }))
      .rejects.toMatchObject({ code: "negative_payout" });
    expect(tx.settlement.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("fails with conflict when the settlement version changed concurrently and writes no audit", async () => {
    const { db, tx } = fakeDb({ updateCount: 0 });
    await expect(submitSettlementAdjustment(db as never, { settlementId: settlement.id, amountCents: 500, reason: "synthetic", actor, thresholdCents: 5_000_000 }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(tx.settlement.updateMany).toHaveBeenCalledWith({
      where: { id: settlement.id, vendorId: settlement.vendorId, lockedAt: null, updatedAt },
      data: { adjustmentAmountCents: 500, adjustmentReason: "synthetic", reviewedBy: actor.id, finalPayoutAmountCents: 10_500, carriedOutCents: 0 },
    });
    // No carry exists and none is needed, so the carry ledger is untouched.
    expect(tx.settlementAdjustmentLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(["P2034", "P2002"])("maps a %s transaction failure to conflict", async (code) => {
    const { db } = fakeDb({ transactionError: new Prisma.PrismaClientKnownRequestError("conflict", { code, clientVersion: "test" }) });
    await expect(submitSettlementAdjustment(db as never, { settlementId: settlement.id, amountCents: 1, reason: "r", actor, thresholdCents: 5_000_000 }))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("needs a second approver when either the new value or the change exceeds the threshold (review n-2)", () => {
    expect(requiresSecondApproval(5_000_000, 5_000_000, 0)).toBe(false);
    expect(requiresSecondApproval(5_000_001, 5_000_000, 0)).toBe(true);
    expect(requiresSecondApproval(4_000_000, 5_000_000, -4_000_000)).toBe(true);
    expect(requiresSecondApproval(-1_000_000, 5_000_000, 3_000_000)).toBe(false);
  });
});
