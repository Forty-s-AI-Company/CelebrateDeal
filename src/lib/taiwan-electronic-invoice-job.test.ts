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

  it("skips unpaid queue entries and counts a successful issue", async () => {
    const now = new Date("2026-09-08T00:00:00Z");
    const queuedWithoutPayment = { id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", attemptCount: 0, order: { primaryPaymentTransactionId: null, status: "paid" } };
    const queuedWithPayment = { id: "invoice-2", vendorId: "vendor-1", orderId: "order-2", attemptCount: 0, order: { primaryPaymentTransactionId: "payment-2", status: "paid" } };
    const electronicInvoice = {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn()
        .mockResolvedValueOnce({ id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", status: "allowance", invoiceNumber: "CD12345678", amountCents: 10_500, attemptCount: 0, nextAttemptAt: now, processingStartedAt: null })
        .mockResolvedValueOnce({ id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", status: "voided", invoiceNumber: "CD12345678", amountCents: 10_500, attemptCount: 0, nextAttemptAt: now, processingStartedAt: null }),
      findMany: vi.fn().mockResolvedValueOnce([queuedWithoutPayment, queuedWithPayment]).mockResolvedValueOnce([]),
    };
    const db = {
      electronicInvoice,
      electronicInvoiceAllowance: { count: vi.fn() },
      commerceOrder: { findFirst: vi.fn() },
    };
    const adapter = { issue: vi.fn().mockResolvedValue({ invoiceNumber: "CD12345678", randomCode: "1234", issuedAt: now }), createAllowance: vi.fn(), void: vi.fn() };
    await expect(runElectronicInvoiceJob({ db: db as never, adapter, now })).resolves.toMatchObject({ attempted: 2, issued: 0, failed: 0 });
    expect(adapter.issue).not.toHaveBeenCalled();
  });

  it("counts an allowance and a voided refund while isolating refund failures", async () => {
    const now = new Date("2026-09-08T00:00:00Z");
    const electronicInvoice = {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn()
        .mockResolvedValueOnce({ id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", status: "allowance", invoiceNumber: "CD12345678", amountCents: 10_500, attemptCount: 0, nextAttemptAt: now, processingStartedAt: null })
        .mockResolvedValueOnce({ id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", status: "voided", invoiceNumber: "CD12345678", amountCents: 10_500, attemptCount: 0, nextAttemptAt: now, processingStartedAt: null }),
      findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{
        vendorId: "vendor-1", orderId: "order-1", status: "issued",
        order: { refunds: [
          { id: "refund-1", amountCents: 100, cumulativeAmountCents: 100, occurredAt: now },
          { id: "refund-2", amountCents: 10_400, cumulativeAmountCents: 10_500, occurredAt: now },
        ] },
      }]),
    };
    const allowanceCount = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const db = {
      electronicInvoice,
      electronicInvoiceAllowance: {
        count: allowanceCount,
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { pretaxAmountCents: 0, taxAmountCents: 0 } }),
        upsert: vi.fn().mockResolvedValue({ id: "allowance-1" }),
      },
      commerceOrder: { findFirst: vi.fn() },
    };
    const adapter = {
      issue: vi.fn(),
      createAllowance: vi.fn().mockResolvedValue({ allowanceNumber: "AL123", issuedAt: now }),
      void: vi.fn().mockResolvedValue({ voidedAt: now }),
    };
    await expect(runElectronicInvoiceJob({ db: db as never, adapter, now })).resolves.toMatchObject({ voided: 1, failed: 0 });
  });
});
