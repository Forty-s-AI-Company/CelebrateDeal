import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attributionFindUnique: vi.fn(),
  commissionFindUnique: vi.fn(),
  commissionCreate: vi.fn(),
  commissionUpdate: vi.fn(),
  ledgerFindUnique: vi.fn(),
  ledgerFindMany: vi.fn(),
  ledgerAggregate: vi.fn(),
  ledgerCreate: vi.fn(),
}));

const db = {
  platformReferralAttribution: { findUnique: mocks.attributionFindUnique },
  platformReferralCommission: {
    findUnique: mocks.commissionFindUnique,
    create: mocks.commissionCreate,
    update: mocks.commissionUpdate,
  },
  platformReferralCommissionLedgerEntry: {
    findUnique: mocks.ledgerFindUnique,
    findMany: mocks.ledgerFindMany,
    aggregate: mocks.ledgerAggregate,
    create: mocks.ledgerCreate,
  },
};

import {
  accruePlatformReferralCommission,
  appendPlatformReferralCommissionLedgerEntry,
  appendPlatformReferralDisputeLedgerEntry,
  applyPlatformReferralDispute,
  applyPlatformReferralRefund,
  type PlatformReferralCommissionDb,
} from "@/lib/platform-referral-commission";

const occurredAt = new Date("2026-07-15T12:00:00.000Z");
const commission = {
  id: "platform-commission-1",
  ownerUserId: "user-1",
  vendorId: "vendor-1",
  subscriptionId: "subscription-1",
  paymentTransactionId: "transaction-1",
  codeSnapshot: "EDEN10",
  commissionRateBpsSnapshot: 1000,
  grossAmountCents: 10_000,
  commissionAmountCents: 1_000,
  currency: "TWD",
  monthKey: "2026-07",
  status: "pending",
};
const typedDb = db as unknown as PlatformReferralCommissionDb;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.attributionFindUnique.mockResolvedValue({
    ownerUserId: "user-1",
    codeSnapshot: "EDEN10",
    commissionRateBpsSnapshot: 1000,
    subscription: { vendorId: "vendor-1" },
  });
  mocks.commissionFindUnique.mockResolvedValue(null);
  mocks.commissionCreate.mockResolvedValue(commission);
  mocks.commissionUpdate.mockResolvedValue({ ...commission, status: "pending" });
  mocks.ledgerFindUnique.mockResolvedValue(null);
  mocks.ledgerFindMany.mockResolvedValue([]);
  mocks.ledgerAggregate.mockResolvedValue({ _sum: { amountCents: 1000 } });
  mocks.ledgerCreate.mockResolvedValue({ id: "ledger-1", amountCents: 1000 });
});

describe("platform referral commission domain", () => {
  it("accrues only from immutable subscription attribution after a paid callback", async () => {
    await expect(accruePlatformReferralCommission(typedDb, {
      vendorId: "vendor-1",
      subscriptionId: "subscription-1",
      paymentTransactionId: "transaction-1",
      providerName: "payuni",
      eventIdentity: "provider-paid-1",
      grossAmountCents: 10_000,
      currency: "twd",
      occurredAt,
      hasRefundedOrder: false,
    })).resolves.toEqual(commission);

    expect(mocks.attributionFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { subscriptionId: "subscription-1" },
    }));
    expect(mocks.commissionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerUserId: "user-1",
        vendorId: "vendor-1",
        subscriptionId: "subscription-1",
        paymentTransactionId: "transaction-1",
        codeSnapshot: "EDEN10",
        commissionRateBpsSnapshot: 1000,
        grossAmountCents: 10_000,
        commissionAmountCents: 1_000,
        currency: "TWD",
        monthKey: "2026-07",
        status: "pending",
      }),
    });
    expect(mocks.ledgerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platformReferralCommissionId: commission.id,
        entryType: "accrual",
        amountCents: 1_000,
        eventIdentity: "paid:provider-paid-1",
      }),
    }));
  });

  it("fails closed for a cross-vendor subscription and never creates commission", async () => {
    mocks.attributionFindUnique.mockResolvedValueOnce({
      ownerUserId: "user-1",
      codeSnapshot: "EDEN10",
      commissionRateBpsSnapshot: 1000,
      subscription: { vendorId: "different-vendor" },
    });

    await expect(accruePlatformReferralCommission(typedDb, {
      vendorId: "vendor-1",
      subscriptionId: "subscription-1",
      paymentTransactionId: "transaction-1",
      providerName: "payuni",
      eventIdentity: "provider-paid-2",
      grossAmountCents: 10_000,
      currency: "TWD",
      occurredAt,
      hasRefundedOrder: false,
    })).resolves.toBeNull();
    expect(mocks.commissionCreate).not.toHaveBeenCalled();
  });

  it("replays an existing payment transaction without a second commission", async () => {
    mocks.commissionFindUnique.mockResolvedValueOnce(commission);

    await expect(accruePlatformReferralCommission(typedDb, {
      vendorId: "vendor-1",
      subscriptionId: "subscription-1",
      paymentTransactionId: "transaction-1",
      providerName: "payuni",
      eventIdentity: "provider-paid-retry",
      grossAmountCents: 10_000,
      currency: "TWD",
      occurredAt,
      hasRefundedOrder: false,
    })).resolves.toEqual(commission);
    expect(mocks.commissionCreate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it("does not accrue a second commission for a renewal on the same subscription", async () => {
    mocks.commissionFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "initial-commission" });

    await expect(accruePlatformReferralCommission(typedDb, {
      vendorId: "vendor-1",
      subscriptionId: "subscription-1",
      paymentTransactionId: "renewal-transaction-1",
      providerName: "payuni",
      eventIdentity: "provider-renewal-paid-1",
      grossAmountCents: 10_000,
      currency: "twd",
      occurredAt: occurredAt,
      hasRefundedOrder: false,
    })).resolves.toBeNull();

    expect(mocks.commissionCreate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it("applies a partial refund once and preserves the original commission snapshot", async () => {
    mocks.commissionFindUnique.mockResolvedValue(commission);
    mocks.ledgerAggregate.mockResolvedValue({ _sum: { amountCents: 1_000 } });

    await expect(applyPlatformReferralRefund(typedDb, {
      paymentTransactionId: "transaction-1",
      providerName: "payuni",
      eventIdentity: "provider-refund-1",
      refundAmountCents: 5_000,
      isFullRefund: false,
      occurredAt,
    })).resolves.toMatchObject({ status: "pending" });

    expect(mocks.ledgerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entryType: "refund", amountCents: -500 }),
    }));
    expect(mocks.commissionUpdate).toHaveBeenCalledWith({
      where: { id: commission.id },
      data: { status: "pending" },
    });
  });

  it("rejects a ledger write that would make the payable balance negative", async () => {
    mocks.ledgerAggregate.mockResolvedValueOnce({ _sum: { amountCents: 100 } });

    await expect(appendPlatformReferralCommissionLedgerEntry(typedDb, {
      commissionId: commission.id,
      entryType: "refund",
      amountCents: -101,
      providerName: "payuni",
      eventIdentity: "provider-refund-overflow",
      occurredAt,
    })).rejects.toThrow("淨額不可低於零");
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it("records a dispute lifecycle once and reverses the remaining balance only on lost", async () => {
    const opened = {
      id: "dispute-opened",
      entryType: "dispute_opened",
      amountCents: 0,
      providerName: "payuni",
      eventIdentity: "dispute-opened-event",
      disputeCaseId: "case-1",
    };
    mocks.ledgerFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([opened])
      .mockResolvedValueOnce([opened, { ...opened, id: "dispute-lost", entryType: "dispute_lost", amountCents: -1_000 }]);
    mocks.ledgerAggregate.mockResolvedValue({ _sum: { amountCents: 1_000 } });
    mocks.ledgerCreate
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce({ ...opened, id: "dispute-lost", entryType: "dispute_lost", amountCents: -1_000 });

    await expect(appendPlatformReferralDisputeLedgerEntry(typedDb, {
      commissionId: commission.id,
      entryType: "dispute_opened",
      providerName: "payuni",
      eventIdentity: "dispute-opened-event",
      disputeCaseId: "case-1",
      occurredAt,
    })).resolves.toEqual(opened);

    await expect(appendPlatformReferralDisputeLedgerEntry(typedDb, {
      commissionId: commission.id,
      entryType: "dispute_lost",
      providerName: "payuni",
      eventIdentity: "dispute-lost-event",
      disputeCaseId: "case-1",
      occurredAt,
    })).resolves.toMatchObject({ entryType: "dispute_lost", amountCents: -1_000 });

    await expect(appendPlatformReferralDisputeLedgerEntry(typedDb, {
      commissionId: commission.id,
      entryType: "dispute_lost",
      providerName: "payuni",
      eventIdentity: "dispute-lost-retry",
      disputeCaseId: "case-1",
      occurredAt,
    })).resolves.toMatchObject({ entryType: "dispute_lost", amountCents: -1_000 });

    expect(mocks.ledgerCreate).toHaveBeenCalledTimes(2);
    expect(mocks.ledgerCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ disputeCaseId: "case-1", amountCents: -1_000 }),
    }));
  });

  it("marks a platform referral commission void when a dispute is lost", async () => {
    mocks.commissionFindUnique.mockResolvedValue(commission);
    mocks.ledgerFindMany.mockResolvedValue([{ entryType: "dispute_opened", amountCents: 0 }]);
    mocks.ledgerAggregate.mockResolvedValue({ _sum: { amountCents: 1_000 } });
    mocks.ledgerCreate.mockResolvedValue({ id: "dispute-lost", entryType: "dispute_lost", amountCents: -1_000 });
    mocks.commissionUpdate.mockResolvedValue({ ...commission, status: "void" });

    await expect(applyPlatformReferralDispute(typedDb, {
      paymentTransactionId: commission.paymentTransactionId,
      entryType: "dispute_lost",
      providerName: "payuni",
      eventIdentity: "dispute-lost-event",
      disputeCaseId: "case-2",
      occurredAt,
    })).resolves.toMatchObject({ status: "void" });

    expect(mocks.commissionUpdate).toHaveBeenCalledWith({
      where: { id: commission.id },
      data: { status: "void" },
    });
  });
});
