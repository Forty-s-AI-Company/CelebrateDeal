import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commissionFindMany: vi.fn(),
  commissionLedgerAggregate: vi.fn(),
  commissionLedgerFindUnique: vi.fn(),
  commissionLedgerCreate: vi.fn(),
  payoutFindMany: vi.fn(),
  payoutFindUnique: vi.fn(),
  payoutCreate: vi.fn(),
  payoutUpdateMany: vi.fn(),
  payoutFindUniqueOrThrow: vi.fn(),
  batchFindUnique: vi.fn(),
  batchCreate: vi.fn(),
  batchFindUniqueOrThrow: vi.fn(),
}));

const db = {
  platformReferralCommission: { findMany: mocks.commissionFindMany },
  platformReferralCommissionLedgerEntry: {
    aggregate: mocks.commissionLedgerAggregate,
    findUnique: mocks.commissionLedgerFindUnique,
    create: mocks.commissionLedgerCreate,
  },
  platformReferralPayout: {
    findMany: mocks.payoutFindMany,
    findUnique: mocks.payoutFindUnique,
    create: mocks.payoutCreate,
    updateMany: mocks.payoutUpdateMany,
    findUniqueOrThrow: mocks.payoutFindUniqueOrThrow,
  },
  platformReferralPayoutBatch: {
    findUnique: mocks.batchFindUnique,
    create: mocks.batchCreate,
    findUniqueOrThrow: mocks.batchFindUniqueOrThrow,
  },
};

import {
  createPlatformReferralPayoutBatch,
  platformReferralPayoutBalance,
  syncPlatformReferralPayoutsForMonth,
  voidPlatformReferralPayout,
  type PlatformReferralPayoutDb,
} from "@/lib/platform-referral-payout";

const typedDb = db as unknown as PlatformReferralPayoutDb;
const basePayout = {
  id: "payout-1",
  ownerUserId: "user-1",
  monthKey: "2026-07",
  commissionAmountCents: 1_000,
  adjustmentAmountCents: 0,
  finalAmountCents: 1_000,
  status: "pending",
  payoutBatchId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commissionFindMany.mockResolvedValue([{ ownerUserId: "user-1" }]);
  mocks.commissionLedgerAggregate.mockResolvedValue({ _sum: { amountCents: 1_000 } });
  mocks.commissionLedgerFindUnique.mockResolvedValue(null);
  mocks.commissionLedgerCreate.mockResolvedValue({ id: "ledger-reversal-1", amountCents: -1_000 });
  mocks.payoutFindUnique.mockResolvedValue(null);
  mocks.payoutCreate.mockResolvedValue(basePayout);
  mocks.payoutUpdateMany.mockResolvedValue({ count: 1 });
  mocks.payoutFindUniqueOrThrow.mockResolvedValue(basePayout);
  mocks.batchFindUnique.mockResolvedValue(null);
  mocks.batchCreate.mockResolvedValue({ id: "batch-1", batchNumber: "PRP-202607-001", monthKey: "2026-07" });
  mocks.batchFindUniqueOrThrow.mockResolvedValue({ id: "batch-1", batchNumber: "PRP-202607-001", monthKey: "2026-07" });
});

describe("platform referral payout read model", () => {
  it("aggregates immutable commission ledger balance by owner and month", async () => {
    await expect(platformReferralPayoutBalance(typedDb, {
      ownerUserId: "user-1",
      monthKey: "2026-07",
    })).resolves.toBe(1_000);

    expect(mocks.commissionLedgerAggregate).toHaveBeenCalledWith({
      where: { commission: { ownerUserId: "user-1", monthKey: "2026-07" } },
      _sum: { amountCents: true },
    });
  });

  it("creates an owner/month payable row and is idempotent for a pending refresh", async () => {
    await expect(syncPlatformReferralPayoutsForMonth(typedDb, { monthKey: "2026-07" }))
      .resolves.toEqual([basePayout]);
    expect(mocks.payoutCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerUserId: "user-1",
        monthKey: "2026-07",
        commissionAmountCents: 1_000,
        finalAmountCents: 1_000,
        status: "pending",
      }),
    });

    mocks.payoutFindUnique.mockResolvedValueOnce({ ...basePayout, finalAmountCents: 500, commissionAmountCents: 500 });
    mocks.commissionLedgerAggregate.mockResolvedValueOnce({ _sum: { amountCents: 500 } });
    mocks.payoutFindUniqueOrThrow.mockResolvedValueOnce({ ...basePayout, finalAmountCents: 500, commissionAmountCents: 500 });
    await expect(syncPlatformReferralPayoutsForMonth(typedDb, { monthKey: "2026-07" }))
      .resolves.toMatchObject([{ finalAmountCents: 500 }]);
    expect(mocks.payoutUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "payout-1", status: "pending", finalAmountCents: 500 },
      data: expect.objectContaining({ finalAmountCents: 500 }),
    }));
  });

  it("creates a local batch, claims each pending row, and performs no transfer", async () => {
    mocks.payoutFindMany.mockResolvedValue([
      { ...basePayout, id: "payout-1", finalAmountCents: 1_000, createdAt: new Date("2026-07-20") },
      { ...basePayout, id: "payout-2", ownerUserId: "user-2", finalAmountCents: 2_000, createdAt: new Date("2026-07-21") },
    ]);
    await expect(createPlatformReferralPayoutBatch(typedDb, {
      monthKey: "2026-07",
      batchNumber: "PRP-202607-001",
      batchDate: new Date("2026-08-01"),
    })).resolves.toMatchObject({ id: "batch-1", monthKey: "2026-07" });

    expect(mocks.batchCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalAmountCents: 3_000, totalCount: 2, status: "draft" }),
    });
    expect(mocks.payoutUpdateMany).toHaveBeenCalledTimes(2);
    expect(mocks.payoutUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { payoutBatchId: "batch-1", status: "batched" },
    }));
  });

  it("voids a local batch only after matching the immutable ledger and appends reversal entries", async () => {
    const batched = { ...basePayout, status: "batched", payoutBatchId: "batch-1" };
    mocks.payoutFindUnique.mockResolvedValueOnce(batched);
    mocks.commissionFindMany.mockResolvedValueOnce([{ id: "commission-1" }]);
    mocks.commissionLedgerAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 1_000 } })
      .mockResolvedValueOnce({ _sum: { amountCents: 1_000 } });
    mocks.payoutFindUniqueOrThrow.mockResolvedValueOnce({ ...batched, status: "void", outcomeReason: "owner review" });

    await expect(voidPlatformReferralPayout(typedDb, {
      payoutId: "payout-1",
      reason: "owner review",
      occurredAt: new Date("2026-08-02"),
    })).resolves.toMatchObject({ status: "void" });
    expect(mocks.commissionLedgerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entryType: "reversal",
        amountCents: -1_000,
        eventIdentity: "platform-payout:void:payout-1:commission-1",
      }),
    }));
    expect(mocks.payoutUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "void", outcomeReason: "owner review", paidAt: null },
    }));
  });

  it("fails closed when a completed payout no longer matches the ledger", async () => {
    mocks.payoutFindUnique.mockResolvedValueOnce({ ...basePayout, status: "paid", finalAmountCents: 1_000 });
    mocks.commissionLedgerAggregate.mockResolvedValueOnce({ _sum: { amountCents: 500 } });
    await expect(syncPlatformReferralPayoutsForMonth(typedDb, { monthKey: "2026-07" }))
      .rejects.toThrow("不可被重算");
    expect(mocks.payoutUpdateMany).not.toHaveBeenCalled();
  });
});
