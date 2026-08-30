import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  reconcileCoursePayoutForAllocation,
  summarizeCoursePayoutReferences,
  syncCoursePayoutsForSettlement,
} from "@/lib/course-payout-accounting";

const db = {
  courseCommissionAllocation: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  courseCommissionLedgerEntry: {
    aggregate: vi.fn(),
  },
  coursePayout: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
};

const period = {
  vendorId: "vendor-1",
  monthKey: "2026-07",
  start: new Date("2026-07-01T00:00:00.000Z"),
  end: new Date("2026-08-01T00:00:00.000Z"),
};

function allocationReference(id: string, transactionId: string, grossAmountCents: number, netAmountCents: number) {
  return {
    id,
    grossAmountCents,
    paymentTransaction: {
      id: transactionId,
      netAmountCents,
      refundedAmountCents: 0,
      refunds: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.coursePayout.findUnique.mockResolvedValue(null);
  db.coursePayout.findUniqueOrThrow.mockResolvedValue({ id: "course-payout-1" });
  db.coursePayout.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "created", ...data }));
  db.coursePayout.updateMany.mockResolvedValue({ count: 1 });
});

describe("syncCoursePayoutsForSettlement", () => {
  it("groups immutable allocation ledger balances by recipient and creates pending read models", async () => {
    db.courseCommissionAllocation.findMany
      .mockResolvedValueOnce([{ recipientMembershipId: "membership-f" }, { recipientMembershipId: "membership-g" }])
      .mockResolvedValueOnce([allocationReference("allocation-f", "transaction-f", 10_000, 9_500)])
      .mockResolvedValueOnce([allocationReference("allocation-g", "transaction-g", 10_000, 9_500)]);
    db.courseCommissionLedgerEntry.aggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 8_000 } })
      .mockResolvedValueOnce({ _sum: { amountCents: 2_000 } });

    const result = await syncCoursePayoutsForSettlement(db as never, period);

    expect(result).toHaveLength(2);
    expect(db.coursePayout.create).toHaveBeenCalledTimes(2);
    expect(db.coursePayout.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        vendorId: "vendor-1",
        recipientMembershipId: "membership-f",
        monthKey: "2026-07",
        commissionAmountCents: 8_000,
        finalAmountCents: 8_000,
        grossSalesAmountCents: 10_000,
        netReferenceAmountCents: 9_500,
        status: "pending",
      }),
    });
  });

  it("fails closed when an existing paid payout would change amount", async () => {
    db.courseCommissionAllocation.findMany
      .mockResolvedValueOnce([{ recipientMembershipId: "membership-f" }])
      .mockResolvedValueOnce([allocationReference("allocation-f", "transaction-f", 10_000, 9_500)]);
    db.courseCommissionLedgerEntry.aggregate.mockResolvedValue({ _sum: { amountCents: 9_000 } });
    db.coursePayout.findUnique.mockResolvedValue({ status: "paid", finalAmountCents: 8_000 });

    await expect(syncCoursePayoutsForSettlement(db as never, period)).rejects.toThrow("不可被重算");
    expect(db.coursePayout.updateMany).not.toHaveBeenCalled();
  });
});

describe("reconcileCoursePayoutForAllocation", () => {
  it("updates only an existing pending payout after a refund ledger change", async () => {
    db.courseCommissionAllocation.findUnique.mockResolvedValue({ recipientMembershipId: "membership-f" });
    db.coursePayout.findUnique.mockResolvedValue({ id: "course-payout-1", status: "pending" });
    db.courseCommissionAllocation.findMany.mockResolvedValue([allocationReference("allocation-f", "transaction-f", 10_000, 9_500)]);
    db.courseCommissionLedgerEntry.aggregate.mockResolvedValue({ _sum: { amountCents: 6_000 } });
    db.coursePayout.findUniqueOrThrow.mockResolvedValue({ id: "course-payout-1", finalAmountCents: 6_000 });

    await reconcileCoursePayoutForAllocation(db as never, {
      vendorId: "vendor-1",
      allocationId: "allocation-f",
      monthKey: "2026-07",
      start: period.start,
      end: period.end,
    });

    expect(db.coursePayout.updateMany).toHaveBeenCalledWith({
      where: { id: "course-payout-1", vendorId: "vendor-1", status: "pending" },
      data: {
        commissionAmountCents: 6_000,
        adjustmentAmountCents: 0,
        finalAmountCents: 6_000,
        grossSalesAmountCents: 10_000,
        netReferenceAmountCents: 9_500,
      },
    });
  });
});

describe("summarizeCoursePayoutReferences", () => {
  it("deduplicates F/G rows and reflects processed refund fee returns", () => {
    expect(summarizeCoursePayoutReferences([
      {
        ...allocationReference("allocation-f", "transaction-1", 100_000, 95_000),
        paymentTransaction: {
          ...allocationReference("allocation-f", "transaction-1", 100_000, 95_000).paymentTransaction,
          refundedAmountCents: 10_000,
          refunds: [{ gatewayFeeRefundCents: 500, platformFeeRefundCents: 100 }],
        },
      },
      allocationReference("allocation-g", "transaction-1", 100_000, 95_000),
    ])).toEqual({
      grossSalesAmountCents: 100_000,
      netReferenceAmountCents: 85_600,
      transactionCount: 1,
    });
  });
});
