import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calculateSettlement: vi.fn(),
  invoiceDueAt: vi.fn(),
  invoiceNumber: vi.fn(),
  vendorFindUnique: vi.fn(),
  settlementFindUnique: vi.fn(),
  settlementUpdateMany: vi.fn(),
  settlementFindUniqueInTransaction: vi.fn(),
  settlementCreate: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  invoiceUpsert: vi.fn(),
  reconciliationFindFirstInTransaction: vi.fn(),
  upsertUsageSnapshot: vi.fn(),
  transaction: vi.fn(),
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
  subscription: { billingCycleDay: 5 },
  streamUsageReconciliationStatus: "NO_EVIDENCE",
  streamUsageReconciliationId: null,
  monthlyFeeCents: 1_000,
  overflowFeeCents: 200,
  paymentServiceFeeCents: 300,
  transactionServiceFeeCents: 400,
  affiliateManagementFeeCents: 500,
  paymentGatewayFeeCents: 600,
  grossRevenueCents: 10_000,
  payoutableAmountCents: 8_000,
};

const settlement = {
  id: "settlement-1",
  vendorId: "vendor-1",
  monthKey: "2026-07",
  adjustmentAmountCents: 0,
  adjustmentReason: null,
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
  mocks.settlementCreate.mockResolvedValue(settlement);
  mocks.settlementUpdateMany.mockResolvedValue({ count: 1 });
  mocks.settlementFindUniqueInTransaction.mockResolvedValue(settlement);
  mocks.invoiceFindUnique.mockResolvedValue(null);
  mocks.invoiceUpdate.mockResolvedValue(invoice);
  mocks.invoiceUpsert.mockResolvedValue(invoice);
  mocks.reconciliationFindFirstInTransaction.mockResolvedValue(null);
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
      create: expect.objectContaining({ status: "issued", totalCents: 2_400 }),
      update: expect.objectContaining({ totalCents: 2_400 }),
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("rolls back the regeneration path when a terminal invoice amount drifts", async () => {
    mocks.settlementFindUnique.mockResolvedValue(settlement);
    mocks.settlementFindUniqueInTransaction.mockResolvedValue(settlement);
    mocks.invoiceFindUnique.mockResolvedValue({ ...invoice, status: "paid", totalCents: 2_401 });

    await expect(generateSettlementForVendor("vendor-1", "2026-07"))
      .rejects.toMatchObject({ name: "BillingCycleError", code: "terminal_invoice_amount_conflict" });

    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
  });

  it("only refreshes dueAt when a terminal invoice has the same amounts", async () => {
    mocks.invoiceFindUnique.mockResolvedValue({ ...invoice, status: "partially_refunded" });

    const result = await generateSettlementForVendor("vendor-1", "2026-07");

    expect(result.outcome).toBe("terminal_unchanged");
    expect(mocks.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: invoice.id },
      data: { dueAt: new Date("2026-08-05T00:00:00.000Z") },
    });
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
