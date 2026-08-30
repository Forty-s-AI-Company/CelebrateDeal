import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  BillingCycleError: class BillingCycleError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.name = "BillingCycleError";
      this.code = code;
    }
  },
  invoiceDueAt: vi.fn(),
  monthRange: vi.fn(),
  generateSettlementForVendor: vi.fn(),
  subscriptionFindMany: vi.fn(),
  invoiceUpdateMany: vi.fn(),
}));

vi.mock("@/lib/billing", () => ({
  invoiceDueAt: mocks.invoiceDueAt,
  monthRange: mocks.monthRange,
}));
vi.mock("@/lib/billing-cycle", () => ({
  BillingCycleError: mocks.BillingCycleError,
  generateSettlementForVendor: mocks.generateSettlementForVendor,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendorSubscription: { findMany: mocks.subscriptionFindMany },
    invoice: { updateMany: mocks.invoiceUpdateMany },
  }),
}));

import { runBillingCycleJob } from "./billing-cycle-job";

const now = new Date("2026-08-06T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.monthRange.mockReturnValue({
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-08-01T00:00:00.000Z"),
  });
  mocks.invoiceDueAt.mockImplementation((_monthKey: string, billingCycleDay: number) => (
    new Date(`2026-08-${String(billingCycleDay).padStart(2, "0")}T00:00:00.000Z`)
  ));
  mocks.subscriptionFindMany.mockResolvedValue([
    { vendorId: "vendor-due", billingCycleDay: 5, startedAt: new Date("2026-01-01T00:00:00.000Z") },
    { vendorId: "vendor-due", billingCycleDay: 5, startedAt: new Date("2025-01-01T00:00:00.000Z") },
    { vendorId: "vendor-not-due", billingCycleDay: 10, startedAt: new Date("2026-01-01T00:00:00.000Z") },
  ]);
  mocks.generateSettlementForVendor.mockResolvedValue({ outcome: "created" });
  mocks.invoiceUpdateMany.mockResolvedValue({ count: 3 });
});

describe("runBillingCycleJob", () => {
  it("processes each active vendor once, skips future cycle days, and marks overdue invoices", async () => {
    await expect(runBillingCycleJob(now)).resolves.toEqual({
      monthKey: "2026-07",
      processed: 1,
      skippedNotDue: 1,
      locked: 0,
      conflicts: 0,
      terminalInvoiceConflicts: 0,
      streamReconciliationRequired: 0,
      missingSubscription: 0,
      failed: 0,
      overdueMarked: 3,
      automaticCharges: 0,
    });

    expect(mocks.generateSettlementForVendor).toHaveBeenCalledOnce();
    expect(mocks.generateSettlementForVendor).toHaveBeenCalledWith("vendor-due", "2026-07");
    expect(mocks.invoiceUpdateMany).toHaveBeenCalledWith({
      where: { status: "issued", dueAt: { lt: now } },
      data: { status: "overdue" },
    });
  });

  it("classifies terminal invoice drift and locked settlements without pretending they were processed", async () => {
    mocks.subscriptionFindMany.mockResolvedValue([
      { vendorId: "vendor-locked", billingCycleDay: 5, startedAt: new Date("2026-01-01T00:00:00.000Z") },
      { vendorId: "vendor-drift", billingCycleDay: 5, startedAt: new Date("2026-01-01T00:00:00.000Z") },
      { vendorId: "vendor-failed", billingCycleDay: 5, startedAt: new Date("2026-01-01T00:00:00.000Z") },
    ]);
    mocks.generateSettlementForVendor
      .mockRejectedValueOnce(new mocks.BillingCycleError("locked"))
      .mockRejectedValueOnce(new mocks.BillingCycleError("terminal_invoice_amount_conflict"))
      .mockRejectedValueOnce(new Error("database failure"));

    await expect(runBillingCycleJob(now)).resolves.toMatchObject({
      processed: 0,
      locked: 1,
      terminalInvoiceConflicts: 1,
      failed: 1,
      automaticCharges: 0,
    });
  });

  it("reports unresolved Stream reconciliation separately from infrastructure failures", async () => {
    mocks.subscriptionFindMany.mockResolvedValueOnce([
      { vendorId: "vendor-stream-review", billingCycleDay: 5, startedAt: new Date("2026-01-01T00:00:00.000Z") },
    ]);
    mocks.generateSettlementForVendor.mockRejectedValueOnce(new mocks.BillingCycleError("stream_reconciliation_required"));

    await expect(runBillingCycleJob(now)).resolves.toMatchObject({
      processed: 0,
      streamReconciliationRequired: 1,
      failed: 0,
      automaticCharges: 0,
    });
  });
});
