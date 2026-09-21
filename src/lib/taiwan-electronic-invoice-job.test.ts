import { describe, expect, it, vi } from "vitest";
import { runElectronicInvoiceJob } from "@/lib/taiwan-electronic-invoice-job";

describe("electronic invoice durable job", () => {
  it("does not touch the database without an explicitly configured adapter", async () => {
    const db = { electronicInvoice: { findMany: vi.fn() } };
    await expect(runElectronicInvoiceJob({ db: db as never })).resolves.toEqual({
      adapterAvailable: false, attempted: 0, issued: 0, allowances: 0, voided: 0, failed: 0,
    });
    expect(db.electronicInvoice.findMany).not.toHaveBeenCalled();
  });

  it("records a bounded retry after an adapter issue failure", async () => {
    const now = new Date("2026-09-08T00:00:00Z");
    const queued = { id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", attemptCount: 0, nextAttemptAt: now, processingStartedAt: null, order: { primaryPaymentTransactionId: "payment-1", status: "paid" } };
    const electronicInvoice = {
      findMany: vi.fn().mockResolvedValueOnce([queued]).mockResolvedValueOnce([]),
      upsert: vi.fn().mockResolvedValue({ ...queued, status: "queued" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn(),
    };
    const db = {
      electronicInvoice,
      electronicInvoiceAllowance: { count: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn(), upsert: vi.fn() },
      commerceOrder: { findFirst: vi.fn().mockResolvedValue({ id: "order-1", vendorId: "vendor-1", currency: "TWD", totalAmountCents: 10_500, invoiceType: "personal", invoiceBuyerDisplay: "m***@example.test", invoiceRequestEncryptedEnvelope: "encrypted" }) },
    };
    const adapter = { issue: vi.fn().mockRejectedValue(new Error("provider unavailable")), createAllowance: vi.fn(), void: vi.fn() };
    await expect(runElectronicInvoiceJob({ db: db as never, adapter, now })).resolves.toMatchObject({ attempted: 1, issued: 0, failed: 1 });
    expect(electronicInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "invoice-1", vendorId: "vendor-1", status: "queued", processingStartedAt: now },
      data: expect.objectContaining({ lastErrorCode: "adapter_issue_failed", processingStartedAt: null, nextAttemptAt: expect.any(Date) }),
    }));
    expect(adapter.issue).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "invoice-issue:invoice-1" }));
  });

  it("voids a queued invoice instead of issuing after a full refund", async () => {
    const now = new Date("2026-09-08T00:00:00Z");
    const electronicInvoice = {
      findMany: vi.fn().mockResolvedValueOnce([{ id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", attemptCount: 0, order: { primaryPaymentTransactionId: "payment-1", status: "refunded" } }]).mockResolvedValueOnce([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const db = { electronicInvoice, electronicInvoiceAllowance: {}, commerceOrder: {} };
    const adapter = { issue: vi.fn(), createAllowance: vi.fn(), void: vi.fn() };
    await expect(runElectronicInvoiceJob({ db: db as never, adapter, now })).resolves.toMatchObject({ attempted: 1, voided: 1, issued: 0 });
    expect(adapter.issue).not.toHaveBeenCalled();
  });
});
