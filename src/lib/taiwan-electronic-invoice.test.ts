import { describe, expect, it, vi } from "vitest";
import { DeterministicTaiwanInvoiceTestAdapter, reconcileElectronicInvoiceAfterPayment, reconcileElectronicInvoiceRefund, scheduleAndIssueOrderInvoice, splitTaiwanVat } from "@/lib/taiwan-electronic-invoice";

describe("Taiwan electronic invoice lifecycle", () => {
  it("splits tax-inclusive amounts without losing cents", () => {
    expect(splitTaiwanVat(10_500)).toEqual({ pretaxAmountCents: 10_000, taxAmountCents: 500 });
    expect(Object.values(splitTaiwanVat(1)).reduce((sum, value) => sum + value, 0)).toBe(1);
  });

  it("creates stable local invoice identities through the adapter contract", async () => {
    const adapter = new DeterministicTaiwanInvoiceTestAdapter();
    const input = { idempotencyKey: "invoice-issue:invoice-1", vendorId: "vendor-1", orderId: "order-1", amountCents: 10_500, occurredAt: new Date("2026-09-08T00:00:00Z") };
    await expect(adapter.issue(input)).resolves.toEqual(await adapter.issue(input));
    await expect(adapter.issue(input)).resolves.toMatchObject({ invoiceNumber: expect.stringMatching(/^[A-Z]{2}[0-9]{8}$/u), randomCode: expect.stringMatching(/^[0-9]{4}$/u) });
  });

  it("never rejects the payment path when invoice scheduling fails", async () => {
    const db = { commerceOrder: { findFirst: vi.fn().mockRejectedValue(new Error("queue unavailable")) } } as never;
    await expect(reconcileElectronicInvoiceAfterPayment(db, {
      vendorId: "vendor-1", paymentTransactionId: "payment-1", eventType: "paid", occurredAt: new Date(),
    })).resolves.toBeNull();
  });

  it("automatically persists a durable queued snapshot when no fiscal adapter is configured", async () => {
    const queued = { id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", status: "queued" };
    const db = {
      commerceOrder: { findFirst: vi.fn().mockResolvedValue({ id: "order-1", vendorId: "vendor-1", currency: "TWD", totalAmountCents: 10_500, invoiceType: "personal", invoiceBuyerDisplay: "m***@example.test", invoiceRequestEncryptedEnvelope: "encrypted" }) },
      electronicInvoice: { upsert: vi.fn().mockResolvedValue(queued), updateMany: vi.fn(), findFirst: vi.fn() },
      electronicInvoiceAllowance: {},
    };
    await expect(reconcileElectronicInvoiceAfterPayment(db as never, {
      vendorId: "vendor-1", paymentTransactionId: "payment-1", eventType: "paid", occurredAt: new Date("2026-09-08T00:00:00Z"),
    })).resolves.toEqual(queued);
    expect(db.electronicInvoice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_orderId: { vendorId: "vendor-1", orderId: "order-1" } },
      create: expect.objectContaining({ status: "queued", amountCents: 10_500, pretaxAmountCents: 10_000, taxAmountCents: 500 }),
    }));
    expect(db.electronicInvoice.updateMany).not.toHaveBeenCalled();
  });

  it("issues an idempotent tenant-bound order snapshot", async () => {
    const issued = { invoiceNumber: "CD12345678", randomCode: "2468", issuedAt: new Date("2026-09-08T00:00:00Z") };
    const stored = { id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", status: "queued", attemptCount: 0, nextAttemptAt: issued.issuedAt, processingStartedAt: null };
    const db = {
      commerceOrder: { findFirst: vi.fn().mockResolvedValue({ id: "order-1", vendorId: "vendor-1", currency: "TWD", totalAmountCents: 10_500, invoiceType: "company", invoiceBuyerDisplay: "公司（統編末四碼 5257）", invoiceRequestEncryptedEnvelope: "encrypted" }) },
      electronicInvoice: { upsert: vi.fn().mockResolvedValue(stored), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn().mockResolvedValue({ ...stored, ...issued, status: "issued" }) },
      electronicInvoiceAllowance: {},
    };
    const adapter = { issue: vi.fn().mockResolvedValue(issued), createAllowance: vi.fn(), void: vi.fn() };
    await expect(scheduleAndIssueOrderInvoice(db as never, { vendorId: "vendor-1", paymentTransactionId: "payment-1", occurredAt: issued.issuedAt }, adapter)).resolves.toMatchObject({ status: "issued" });
    expect(db.commerceOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1" }) }));
    expect(db.electronicInvoice.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId_orderId: { vendorId: "vendor-1", orderId: "order-1" } } }));
    expect(adapter.issue).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "invoice-issue:invoice-1" }));
  });

  it("does not call the fiscal adapter when another worker owns the issuance lease", async () => {
    const occurredAt = new Date("2026-09-08T00:00:00Z");
    const stored = { id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", status: "queued", attemptCount: 0, nextAttemptAt: occurredAt, processingStartedAt: null };
    const db = {
      commerceOrder: { findFirst: vi.fn().mockResolvedValue({ id: "order-1", vendorId: "vendor-1", currency: "TWD", totalAmountCents: 10_500, invoiceType: "personal", invoiceBuyerDisplay: "m***@example.test", invoiceRequestEncryptedEnvelope: "encrypted" }) },
      electronicInvoice: { upsert: vi.fn().mockResolvedValue(stored), updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn() },
      electronicInvoiceAllowance: {},
    };
    const adapter = { issue: vi.fn(), createAllowance: vi.fn(), void: vi.fn() };
    await expect(scheduleAndIssueOrderInvoice(db as never, { vendorId: "vendor-1", paymentTransactionId: "payment-1", occurredAt }, adapter)).resolves.toBeUndefined();
    expect(adapter.issue).not.toHaveBeenCalled();
  });

  it("does not locally void a queued invoice while an issuance lease is active", async () => {
    const occurredAt = new Date("2026-09-08T00:00:00Z");
    const invoice = { id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", status: "queued", amountCents: 10_500, attemptCount: 1, processingStartedAt: occurredAt };
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = {
      commerceOrder: {},
      electronicInvoice: { findFirst: vi.fn().mockResolvedValue(invoice), updateMany },
      electronicInvoiceAllowance: {},
    };
    await reconcileElectronicInvoiceRefund(db as never, { vendorId: "vendor-1", orderId: "order-1", commerceRefundId: "refund-1", refundAmountCents: 10_500, cumulativeAmountCents: 10_500, occurredAt });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ processingStartedAt: null, attemptCount: 1 }),
    }));
  });

  it("creates an allowance for a partial refund and voids on a full refund", async () => {
    const baseInvoice = { id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", invoiceNumber: "CD12345678", status: "issued", amountCents: 10_500, attemptCount: 0, nextAttemptAt: new Date("2026-09-08T00:00:00Z"), processingStartedAt: null };
    const db = {
      commerceOrder: {},
      electronicInvoice: { findFirst: vi.fn().mockResolvedValue(baseInvoice), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      electronicInvoiceAllowance: { findUnique: vi.fn().mockResolvedValue(null), aggregate: vi.fn().mockResolvedValue({ _sum: { pretaxAmountCents: 0, taxAmountCents: 0 } }), upsert: vi.fn().mockResolvedValue({ id: "allowance-1" }) },
    };
    const adapter = new DeterministicTaiwanInvoiceTestAdapter();
    const occurredAt = new Date("2026-09-08T00:00:00Z");
    await reconcileElectronicInvoiceRefund(db as never, { vendorId: "vendor-1", orderId: "order-1", commerceRefundId: "refund-1", refundAmountCents: 1_050, cumulativeAmountCents: 1_050, occurredAt }, adapter);
    expect(db.electronicInvoiceAllowance.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId_commerceRefundId: { vendorId: "vendor-1", commerceRefundId: "refund-1" } } }));
    expect(db.electronicInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "allowance" }) }));

    db.electronicInvoice.findFirst.mockResolvedValue(baseInvoice);
    await reconcileElectronicInvoiceRefund(db as never, { vendorId: "vendor-1", orderId: "order-1", commerceRefundId: "refund-2", refundAmountCents: 9_450, cumulativeAmountCents: 10_500, occurredAt }, adapter);
    expect(db.electronicInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "voided", voidedAt: occurredAt }) }));
  });

  it("allocates cumulative VAT rounding remainder across split allowances", async () => {
    const invoice = { id: "invoice-1", vendorId: "vendor-1", orderId: "order-1", invoiceNumber: "CD12345678", status: "issued", amountCents: 2_000, attemptCount: 0, nextAttemptAt: new Date("2026-09-08T00:00:00Z"), processingStartedAt: null };
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      commerceOrder: {},
      electronicInvoice: { findFirst: vi.fn().mockResolvedValue(invoice), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      electronicInvoiceAllowance: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValueOnce({ _sum: { pretaxAmountCents: 0, taxAmountCents: 0 } }).mockResolvedValueOnce({ _sum: { pretaxAmountCents: 952, taxAmountCents: 48 } }),
        upsert,
      },
    };
    const adapter = new DeterministicTaiwanInvoiceTestAdapter();
    const occurredAt = new Date("2026-09-08T00:00:00Z");
    await reconcileElectronicInvoiceRefund(db as never, { vendorId: "vendor-1", orderId: "order-1", commerceRefundId: "r1", refundAmountCents: 1_000, cumulativeAmountCents: 1_000, occurredAt }, adapter);
    await reconcileElectronicInvoiceRefund(db as never, { vendorId: "vendor-1", orderId: "order-1", commerceRefundId: "r2", refundAmountCents: 200, cumulativeAmountCents: 1_200, occurredAt }, adapter);
    const first = upsert.mock.calls[0]![0].create;
    const second = upsert.mock.calls[1]![0].create;
    expect(first.pretaxAmountCents + second.pretaxAmountCents).toBe(1_143);
    expect(first.taxAmountCents + second.taxAmountCents).toBe(57);
  });
});
