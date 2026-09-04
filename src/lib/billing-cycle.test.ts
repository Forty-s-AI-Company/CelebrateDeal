import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calculateSettlement: vi.fn(),
  invoiceDueAt: vi.fn(),
  invoiceNumber: vi.fn(),
  monthRange: vi.fn(),
  vendorFindUnique: vi.fn(),
  settlementFindUnique: vi.fn(),
  settlementUpdateMany: vi.fn(),
  settlementFindUniqueInTransaction: vi.fn(),
  settlementCreate: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  invoiceUpsert: vi.fn(),
  reconciliationFindFirstInTransaction: vi.fn(),
  platformCheckoutFindManyInTransaction: vi.fn(),
  upsertUsageSnapshot: vi.fn(),
  transaction: vi.fn(),
  platformSubscriptionCheckoutPaymentSnapshot: vi.fn((transactions: Array<Record<string, unknown>>) => transactions
    .filter((transaction) => (transaction.metadata as Record<string, unknown> | null)?.billingPurpose === "platform_subscription_checkout")
    .map((transaction) => ({
      id: transaction.id,
      vendorId: transaction.vendorId,
      status: transaction.status,
      grossAmountCents: transaction.grossAmountCents,
      currency: transaction.currency,
      occurredAt: (transaction.occurredAt as Date).toISOString(),
      refundedAmountCents: transaction.refundedAmountCents,
      billingPurpose: "platform_subscription_checkout",
      platformSubscriptionId: (transaction.metadata as Record<string, unknown>).platformSubscriptionId ?? null,
      billingPlanId: (transaction.metadata as Record<string, unknown>).billingPlanId ?? null,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))),
  platformSubscriptionCheckoutPaymentSnapshotsMatch: vi.fn((left, right) => JSON.stringify(left) === JSON.stringify(right)),
  PlatformSubscriptionMonthlyFeeCreditConflictError: class PlatformSubscriptionMonthlyFeeCreditConflictError extends Error {
    readonly code = "platform_subscription_monthly_fee_credit_conflict" as const;
    constructor() {
      super("platform_subscription_monthly_fee_credit_conflict");
      this.name = "PlatformSubscriptionMonthlyFeeCreditConflictError";
    }
  },
  StreamUsageReconciliationRequiredError: class StreamUsageReconciliationRequiredError extends Error {
    readonly code = "stream_reconciliation_required";
    constructor() {
      super("stream_reconciliation_required");
      this.name = "StreamUsageReconciliationRequiredError";
    }
  },
}));

vi.mock("@/lib/billing", () => ({
  calculateSettlement: mocks.calculateSettlement,
  invoiceDueAt: mocks.invoiceDueAt,
  invoiceNumber: mocks.invoiceNumber,
  monthRange: mocks.monthRange,
  PlatformSubscriptionMonthlyFeeCreditConflictError: mocks.PlatformSubscriptionMonthlyFeeCreditConflictError,
  platformSubscriptionCheckoutPaymentSnapshot: mocks.platformSubscriptionCheckoutPaymentSnapshot,
  platformSubscriptionCheckoutPaymentSnapshotsMatch: mocks.platformSubscriptionCheckoutPaymentSnapshotsMatch,
  StreamUsageReconciliationRequiredError: mocks.StreamUsageReconciliationRequiredError,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendor: { findUnique: mocks.vendorFindUnique },
    settlement: { findUnique: mocks.settlementFindUnique },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/usage-estimation", () => ({ upsertUsageSnapshot: mocks.upsertUsageSnapshot }));

import { BillingCycleError, generateSettlementForVendor } from "./billing-cycle";

const calculation = {
  subscription: { billingCycleDay: 5, plan: { monthlyPriceCents: 1_000 } },
  streamUsageReconciliationStatus: "NO_EVIDENCE",
  streamUsageReconciliationId: null,
  monthlyFeeCents: 1_000,
  overflowFeeCents: 0,
  paymentServiceFeeCents: 300,
  transactionServiceFeeCents: 400,
  affiliateManagementFeeCents: 500,
  paymentGatewayFeeCents: 600,
  grossRevenueCents: 10_000,
  payoutableAmountCents: 8_000,
  platformSubscriptionCheckoutCreditApplied: false,
  platformSubscriptionCheckoutPaymentSnapshot: [],
};

const settlement = {
  id: "settlement-1",
  vendorId: "vendor-1",
  monthKey: "2026-07",
  monthlyFeeCents: 1_000,
  overflowFeeCents: 200,
  paymentServiceFeeCents: 300,
  transactionServiceFeeCents: 400,
  affiliateManagementFeeCents: 500,
  paymentGatewayFeeCents: 600,
  grossRevenueCents: 10_000,
  payoutableAmountCents: 8_000,
  adjustmentAmountCents: 0,
  adjustmentReason: null,
  finalPayoutAmountCents: 8_000,
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  lockedAt: null,
};

const invoice = {
  id: "invoice-1",
  invoiceNumber: "vendor-2026-07-vendor-1",
  status: "issued",
  monthlyFeeCents: 1_000,
  overflowFeeCents: 200,
  paymentServiceFeeCents: 300,
  transactionServiceFeeCents: 400,
  affiliateManagementFeeCents: 500,
  subtotalCents: 2_400,
  taxCents: 0,
  totalCents: 2_400,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.vendorFindUnique.mockResolvedValue({ id: "vendor-1", slug: "vendor" });
  mocks.settlementFindUnique.mockResolvedValue(null);
  mocks.calculateSettlement.mockResolvedValue(calculation);
  mocks.invoiceDueAt.mockReturnValue(new Date("2026-08-05T00:00:00.000Z"));
  mocks.invoiceNumber.mockReturnValue("vendor-2026-07-vendor-1");
  mocks.monthRange.mockReturnValue({
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-08-01T00:00:00.000Z"),
  });
  mocks.settlementCreate.mockResolvedValue(settlement);
  mocks.settlementUpdateMany.mockResolvedValue({ count: 1 });
  mocks.settlementFindUniqueInTransaction.mockResolvedValue(settlement);
  mocks.invoiceFindUnique.mockResolvedValue(null);
  mocks.invoiceUpdate.mockResolvedValue(invoice);
  mocks.invoiceUpsert.mockResolvedValue(invoice);
  mocks.reconciliationFindFirstInTransaction.mockResolvedValue(null);
  mocks.platformCheckoutFindManyInTransaction.mockResolvedValue([]);
  mocks.upsertUsageSnapshot.mockResolvedValue({ snapshot: {}, record: { id: "usage-snapshot" } });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    settlement: {
      create: mocks.settlementCreate,
      findUnique: mocks.settlementFindUniqueInTransaction,
      updateMany: mocks.settlementUpdateMany,
    },
    invoice: {
      findUnique: mocks.invoiceFindUnique,
      update: mocks.invoiceUpdate,
      upsert: mocks.invoiceUpsert,
    },
    streamUsageReconciliation: { findFirst: mocks.reconciliationFindFirstInTransaction },
    paymentTransaction: { findMany: mocks.platformCheckoutFindManyInTransaction },
  }));
});

describe("generateSettlementForVendor", () => {
  it("creates a settlement and an issued invoice in one Serializable transaction", async () => {
    const result = await generateSettlementForVendor("vendor-1", "2026-07");

    expect(result.outcome).toBe("created");
    expect(mocks.upsertUsageSnapshot).toHaveBeenCalledWith("vendor-1", "2026-07");
    expect(mocks.calculateSettlement).toHaveBeenCalledWith("vendor-1", "2026-07");
    expect(mocks.settlementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ vendorId: "vendor-1", monthKey: "2026-07", finalPayoutAmountCents: 8_000 }),
    });
    expect(mocks.invoiceUpsert).toHaveBeenCalledWith({
      where: { invoiceNumber: "vendor-2026-07-vendor-1" },
      create: expect.objectContaining({ status: "issued", overflowFeeCents: 0, totalCents: 2_200 }),
      update: expect.objectContaining({ overflowFeeCents: 0, totalCents: 2_200 }),
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("persists the calculated metered usage fee on a newly generated invoice", async () => {
    mocks.calculateSettlement.mockResolvedValueOnce({ ...calculation, overflowFeeCents: 8_100 });

    await generateSettlementForVendor("vendor-1", "2026-07");

    expect(mocks.settlementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ overflowFeeCents: 8_100 }),
    });
    expect(mocks.invoiceUpsert).toHaveBeenCalledWith({
      where: { invoiceNumber: "vendor-2026-07-vendor-1" },
      create: expect.objectContaining({ overflowFeeCents: 8_100, totalCents: 10_300 }),
      update: expect.objectContaining({ overflowFeeCents: 8_100, totalCents: 10_300 }),
    });
  });

  it("rolls back the regeneration path when a terminal invoice amount drifts", async () => {
    mocks.settlementFindUnique.mockResolvedValue(settlement);
    mocks.settlementFindUniqueInTransaction.mockResolvedValue(settlement);
    mocks.invoiceFindUnique.mockResolvedValue({ ...invoice, status: "paid", totalCents: 2_401 });

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ name: "BillingCycleError", code: "terminal_invoice_amount_conflict" });

    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
  });

  it.each(["paid", "partially_refunded", "refunded"])("does not write a matching terminal %s invoice", async (status) => {
    const terminalInvoice = { ...invoice, status };
    mocks.settlementFindUnique.mockResolvedValue(settlement);
    mocks.settlementFindUniqueInTransaction.mockResolvedValue(settlement);
    mocks.invoiceFindUnique.mockResolvedValue(terminalInvoice);

    const result = await generateSettlementForVendor("vendor-1", "2026-07");

    expect(result).toMatchObject({ outcome: "terminal_unchanged", invoice: terminalInvoice });
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
  });

  it("rejects terminal settlement payout drift before any settlement write", async () => {
    mocks.settlementFindUnique.mockResolvedValue({ ...settlement, grossRevenueCents: 10_001 });
    mocks.settlementFindUniqueInTransaction.mockResolvedValue({ ...settlement, grossRevenueCents: 10_001 });
    mocks.invoiceFindUnique.mockResolvedValue({ ...invoice, status: "paid" });

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ code: "terminal_settlement_amount_conflict" });

    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });

  it("preserves an existing invoice's metered liability after the billing policy changes", async () => {
    mocks.calculateSettlement.mockResolvedValueOnce({ ...calculation, overflowFeeCents: 8_100 });
    mocks.settlementFindUnique.mockResolvedValue({ ...settlement, overflowFeeCents: 200 });
    mocks.settlementFindUniqueInTransaction.mockResolvedValue({ ...settlement, overflowFeeCents: 200 });
    mocks.invoiceFindUnique.mockResolvedValue({ ...invoice, status: "overdue" });

    await generateSettlementForVendor("vendor-1", "2026-07");

    expect(mocks.settlementUpdateMany).toHaveBeenCalledWith({
      where: { id: settlement.id, lockedAt: null, updatedAt: settlement.updatedAt },
      data: expect.objectContaining({ overflowFeeCents: 200 }),
    });
    expect(mocks.invoiceUpsert).toHaveBeenCalledWith({
      where: { invoiceNumber: invoice.invoiceNumber },
      create: expect.objectContaining({ overflowFeeCents: 200, totalCents: 2_400 }),
      update: expect.objectContaining({ overflowFeeCents: 200, totalCents: 2_400 }),
    });
  });

  it("rejects a historical monthly-fee mismatch without rewriting either record", async () => {
    mocks.settlementFindUnique.mockResolvedValue(settlement);
    mocks.invoiceFindUnique.mockResolvedValue({ ...invoice, status: "overdue", monthlyFeeCents: 0, subtotalCents: 1_400, totalCents: 1_400 });

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ code: "historical_monthly_fee_conflict" });

    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid month before any database access", async () => {
    await expect(generateSettlementForVendor("vendor-1", "2026-13"))
      .rejects.toMatchObject({ name: "BillingCycleError", code: "invalid_month" });

    expect(mocks.vendorFindUnique).not.toHaveBeenCalled();
    expect(mocks.calculateSettlement).not.toHaveBeenCalled();
  });

  it("exposes a finite domain error for a locked settlement", async () => {
    mocks.settlementFindUnique.mockResolvedValue({ ...settlement, lockedAt: new Date("2026-08-01T00:00:00.000Z") });

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toEqual(expect.objectContaining({ code: "locked" } satisfies Partial<BillingCycleError>));

    expect(mocks.calculateSettlement).not.toHaveBeenCalled();
  });

  it("does not create a settlement or invoice while a known Stream provider mismatch is unresolved", async () => {
    mocks.calculateSettlement.mockRejectedValueOnce(new mocks.StreamUsageReconciliationRequiredError());

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ name: "BillingCycleError", code: "stream_reconciliation_required" });

    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });

  it("maps an ambiguous platform monthly-fee credit to a finite billing-cycle conflict", async () => {
    mocks.calculateSettlement.mockRejectedValueOnce(new mocks.PlatformSubscriptionMonthlyFeeCreditConflictError());

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ code: "platform_subscription_monthly_fee_credit_conflict" });

    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed"])("rejects a %s checkout conflict without writes", async () => {
    mocks.calculateSettlement.mockRejectedValueOnce(new mocks.PlatformSubscriptionMonthlyFeeCreditConflictError());

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ code: "platform_subscription_monthly_fee_credit_conflict" });

    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });

  it("credits a trusted paid checkout on an open invoice without erasing its other historical fees", async () => {
    const historicInvoice = {
      ...invoice,
      status: "issued",
      paymentServiceFeeCents: 333,
      transactionServiceFeeCents: 444,
      affiliateManagementFeeCents: 555,
      subtotalCents: 2_532,
      totalCents: 2_532,
    };
    const historicSettlement = {
      ...settlement,
      paymentServiceFeeCents: 333,
      transactionServiceFeeCents: 444,
      affiliateManagementFeeCents: 555,
    };
    const paidCheckoutSnapshot = [{
      id: "platform-checkout-1",
      vendorId: "vendor-1",
      status: "paid",
      grossAmountCents: 1_000,
      currency: "TWD",
      occurredAt: "2026-07-15T00:00:00.000Z",
      refundedAmountCents: 0,
      billingPurpose: "platform_subscription_checkout",
      platformSubscriptionId: "subscription-current",
      billingPlanId: "plan-current",
    }];
    mocks.calculateSettlement.mockResolvedValueOnce({
      ...calculation,
      monthlyFeeCents: 0,
      platformSubscriptionCheckoutCreditApplied: true,
      platformSubscriptionCheckoutPaymentSnapshot: paidCheckoutSnapshot,
    });
    mocks.settlementFindUnique.mockResolvedValue(historicSettlement);
    mocks.settlementFindUniqueInTransaction.mockResolvedValue(historicSettlement);
    mocks.invoiceFindUnique.mockResolvedValue(historicInvoice);
    mocks.platformCheckoutFindManyInTransaction
      .mockResolvedValueOnce([{
      ...paidCheckoutSnapshot[0],
      occurredAt: new Date("2026-07-15T00:00:00.000Z"),
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: "subscription-current",
        billingPlanId: "plan-current",
      },
      }])
      .mockResolvedValueOnce([]);

    await generateSettlementForVendor("vendor-1", "2026-07");

    expect(mocks.settlementUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        monthlyFeeCents: 0,
        overflowFeeCents: 200,
        paymentServiceFeeCents: 333,
        transactionServiceFeeCents: 444,
        affiliateManagementFeeCents: 555,
      }),
    }));
    expect(mocks.invoiceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        monthlyFeeCents: 0,
        overflowFeeCents: 200,
        paymentServiceFeeCents: 333,
        transactionServiceFeeCents: 444,
        affiliateManagementFeeCents: 555,
      }),
    }));
  });

  it.each(["pending", "failed"])("rejects a %s existing invoice payment before lowering the monthly fee", async (status) => {
    const paidCheckoutSnapshot = [{
      id: "platform-checkout-1", vendorId: "vendor-1", status: "paid", grossAmountCents: 1_000, currency: "TWD",
      occurredAt: "2026-07-15T00:00:00.000Z", refundedAmountCents: 0,
      billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "subscription-current", billingPlanId: "plan-current",
    }];
    mocks.calculateSettlement.mockResolvedValueOnce({
      ...calculation,
      monthlyFeeCents: 0,
      platformSubscriptionCheckoutCreditApplied: true,
      platformSubscriptionCheckoutPaymentSnapshot: paidCheckoutSnapshot,
    });
    mocks.settlementFindUnique.mockResolvedValue(settlement);
    mocks.invoiceFindUnique.mockResolvedValue(invoice);
    mocks.platformCheckoutFindManyInTransaction
      .mockResolvedValueOnce([{
        ...paidCheckoutSnapshot[0],
        occurredAt: new Date("2026-07-15T00:00:00.000Z"),
        metadata: {
          billingPurpose: "platform_subscription_checkout",
          platformSubscriptionId: "subscription-current",
          billingPlanId: "plan-current",
        },
      }])
      .mockResolvedValueOnce([{
        id: `invoice-payment-${status}`,
        metadata: { billingPurpose: "invoice_payment", invoiceId: invoice.id },
      }]);

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ code: "platform_subscription_monthly_fee_credit_conflict" });

    expect(mocks.platformCheckoutFindManyInTransaction).toHaveBeenLastCalledWith({
      where: {
        vendorId: "vendor-1",
        AND: [
          { metadata: { path: ["billingPurpose"], equals: "invoice_payment" } },
          { metadata: { path: ["invoiceId"], equals: invoice.id } },
        ],
      },
      select: { id: true },
    });
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });

  it("leaves a matching terminal credited invoice unchanged", async () => {
    const terminalInvoice = {
      ...invoice,
      status: "paid",
      monthlyFeeCents: 0,
      subtotalCents: 1_400,
      totalCents: 1_400,
    };
    const terminalSettlement = { ...settlement, monthlyFeeCents: 0 };
    const paidCheckoutSnapshot = [{
      id: "platform-checkout-1", vendorId: "vendor-1", status: "paid", grossAmountCents: 1_000, currency: "TWD",
      occurredAt: "2026-07-15T00:00:00.000Z", refundedAmountCents: 0,
      billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "subscription-current", billingPlanId: "plan-current",
    }];
    mocks.calculateSettlement.mockResolvedValueOnce({
      ...calculation,
      monthlyFeeCents: 0,
      platformSubscriptionCheckoutCreditApplied: true,
      platformSubscriptionCheckoutPaymentSnapshot: paidCheckoutSnapshot,
    });
    mocks.settlementFindUnique.mockResolvedValue(terminalSettlement);
    mocks.settlementFindUniqueInTransaction.mockResolvedValue(terminalSettlement);
    mocks.invoiceFindUnique.mockResolvedValue(terminalInvoice);
    mocks.platformCheckoutFindManyInTransaction.mockResolvedValueOnce([{
      ...paidCheckoutSnapshot[0],
      occurredAt: new Date("2026-07-15T00:00:00.000Z"),
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: "subscription-current",
        billingPlanId: "plan-current",
      },
    }]);

    const result = await generateSettlementForVendor("vendor-1", "2026-07");

    expect(result.outcome).toBe("terminal_unchanged");
    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });

  it.each([
    { transactionSnapshot: [{
      id: "platform-checkout-1", vendorId: "vendor-1", status: "paid", grossAmountCents: 1_000, currency: "TWD",
      occurredAt: new Date("2026-07-15T00:00:00.000Z"), refundedAmountCents: 0,
      metadata: { billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "subscription-current", billingPlanId: "plan-current" },
    }, {
      id: "platform-checkout-2", vendorId: "vendor-1", status: "paid", grossAmountCents: 1_000, currency: "TWD",
      occurredAt: new Date("2026-07-16T00:00:00.000Z"), refundedAmountCents: 0,
      metadata: { billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "subscription-current", billingPlanId: "plan-current" },
    }] },
    { transactionSnapshot: [{
      id: "platform-checkout-1", vendorId: "vendor-1", status: "refunded", grossAmountCents: 1_000, currency: "TWD",
      occurredAt: new Date("2026-07-15T00:00:00.000Z"), refundedAmountCents: 1_000,
      metadata: { billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "subscription-current", billingPlanId: "plan-current" },
    }] },
  ])("rejects a checkout snapshot changed inside the write transaction", async ({ transactionSnapshot }) => {
    mocks.calculateSettlement.mockResolvedValueOnce({
      ...calculation,
      platformSubscriptionCheckoutPaymentSnapshot: [{
        id: "platform-checkout-1", vendorId: "vendor-1", status: "paid", grossAmountCents: 1_000, currency: "TWD",
        occurredAt: "2026-07-15T00:00:00.000Z", refundedAmountCents: 0,
        billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "subscription-current", billingPlanId: "plan-current",
      }],
    });
    mocks.platformCheckoutFindManyInTransaction.mockResolvedValue(transactionSnapshot);

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ code: "platform_subscription_monthly_fee_credit_conflict" });

    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });

  it("rechecks unresolved Stream mismatches inside the invoice transaction to close the race window", async () => {
    mocks.reconciliationFindFirstInTransaction.mockResolvedValueOnce({ id: "concurrent-mismatch" });

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ code: "stream_reconciliation_required" });

    expect(mocks.reconciliationFindFirstInTransaction).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        monthKey: "2026-07",
        OR: [
          { status: "MISMATCH" },
          { status: "RESOLVED", resolution: "ESCALATED" },
        ],
      },
      select: { id: true },
    });
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });

  it("uses the reconciliation id as a CAS snapshot when evidence changes after calculation", async () => {
    mocks.reconciliationFindFirstInTransaction
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "newer-reconciliation" });

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ code: "conflict" });

    expect(mocks.reconciliationFindFirstInTransaction).toHaveBeenNthCalledWith(2, {
      where: { vendorId: "vendor-1", monthKey: "2026-07" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
  });
});
