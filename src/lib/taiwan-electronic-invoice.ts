import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export type IssuedInvoiceIdentity = { invoiceNumber: string; randomCode: string; issuedAt: Date };

export interface TaiwanElectronicInvoiceAdapter {
  issue(input: { idempotencyKey: string; vendorId: string; orderId: string; amountCents: number; occurredAt: Date }): Promise<IssuedInvoiceIdentity>;
  createAllowance(input: { idempotencyKey: string; vendorId: string; invoiceNumber: string; refundId: string; amountCents: number; occurredAt: Date }): Promise<{ allowanceNumber: string; issuedAt: Date }>;
  void(input: { idempotencyKey: string; vendorId: string; invoiceNumber: string; refundId: string; occurredAt: Date }): Promise<{ voidedAt: Date }>;
}

/** Inclusive 5% VAT split. Amount is always preserved exactly in integer cents. */
export function splitTaiwanVat(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error("Invoice amount must be a non-negative safe integer.");
  // Inclusive VAT is exactly 20/21; avoid floating-point rounding at large amounts.
  const pretaxAmountCents = Number((BigInt(amountCents) * BigInt(20) + BigInt(10)) / BigInt(21));
  return { pretaxAmountCents, taxAmountCents: amountCents - pretaxAmountCents };
}

/** Local reference adapter. A production fiscal adapter can implement the same interface later. */
export class DeterministicTaiwanInvoiceTestAdapter implements TaiwanElectronicInvoiceAdapter {
  async issue(input: { idempotencyKey: string; vendorId: string; orderId: string; amountCents: number; occurredAt: Date }) {
    const digest = createHash("sha256").update(`${input.vendorId}:${input.orderId}`).digest("hex");
    const digits = BigInt(`0x${digest.slice(0, 16)}`).toString().padStart(8, "0");
    const randomDigits = BigInt(`0x${digest.slice(16, 24)}`).toString().padStart(4, "0");
    return { invoiceNumber: `CD${digits.slice(-8)}`, randomCode: randomDigits.slice(-4), issuedAt: input.occurredAt };
  }
  async createAllowance(input: { idempotencyKey: string; vendorId: string; invoiceNumber: string; refundId: string; amountCents: number; occurredAt: Date }) {
    const digest = createHash("sha256").update(`${input.vendorId}:${input.invoiceNumber}:${input.refundId}`).digest("hex");
    return { allowanceNumber: `AL${BigInt(`0x${digest.slice(0, 16)}`).toString().padStart(12, "0").slice(-12)}`, issuedAt: input.occurredAt };
  }
  async void(input: { idempotencyKey: string; vendorId: string; invoiceNumber: string; refundId: string; occurredAt: Date }) {
    return { voidedAt: input.occurredAt };
  }
}

type InvoiceDb = Pick<PrismaClient, "commerceOrder" | "electronicInvoice" | "electronicInvoiceAllowance">;

function nextRetryAt(now: Date, attemptCount: number) {
  return new Date(now.getTime() + Math.min(24 * 60, 2 ** Math.min(attemptCount, 10)) * 60_000);
}

export async function scheduleAndIssueOrderInvoice(
  db: InvoiceDb,
  input: { vendorId: string; paymentTransactionId: string; occurredAt: Date },
  adapter?: TaiwanElectronicInvoiceAdapter,
) {
  const order = await db.commerceOrder.findFirst({
    where: { vendorId: input.vendorId, primaryPaymentTransactionId: input.paymentTransactionId, status: { in: ["paid", "partially_refunded"] } },
    select: { id: true, vendorId: true, currency: true, totalAmountCents: true, invoiceType: true, invoiceBuyerDisplay: true, invoiceRequestEncryptedEnvelope: true },
  });
  if (!order || !order.invoiceType || !order.invoiceBuyerDisplay || !order.invoiceRequestEncryptedEnvelope) return null;
  const tax = splitTaiwanVat(order.totalAmountCents);
  const invoice = await db.electronicInvoice.upsert({
    where: { vendorId_orderId: { vendorId: input.vendorId, orderId: order.id } },
    create: {
      id: randomUUID(), vendorId: input.vendorId, orderId: order.id,
      invoiceType: order.invoiceType, buyerDisplay: order.invoiceBuyerDisplay,
      requestEncryptedEnvelope: order.invoiceRequestEncryptedEnvelope,
      currency: order.currency, amountCents: order.totalAmountCents, ...tax, status: "queued",
    },
    update: {},
  });
  if (invoice.status !== "queued") return invoice;
  // Queue-only is the safe default. Only an explicitly configured fiscal
  // adapter may claim that an invoice was issued.
  if (!adapter) return invoice;
  const claimed = await db.electronicInvoice.updateMany({
    where: { id: invoice.id, vendorId: input.vendorId, status: "queued", attemptCount: invoice.attemptCount, processingStartedAt: null, nextAttemptAt: { lte: input.occurredAt } },
    data: { attemptCount: { increment: 1 }, lastAttemptAt: input.occurredAt, processingStartedAt: input.occurredAt },
  });
  if (claimed.count !== 1) return db.electronicInvoice.findFirst({ where: { id: invoice.id, vendorId: input.vendorId } });
  let identity: IssuedInvoiceIdentity;
  try {
    identity = await adapter.issue({ idempotencyKey: `invoice-issue:${invoice.id}`, vendorId: input.vendorId, orderId: order.id, amountCents: order.totalAmountCents, occurredAt: input.occurredAt });
  } catch (error) {
    await db.electronicInvoice.updateMany({
      where: { id: invoice.id, vendorId: input.vendorId, status: "queued", processingStartedAt: input.occurredAt },
      data: { processingStartedAt: null, lastErrorCode: "adapter_issue_failed", nextAttemptAt: nextRetryAt(input.occurredAt, invoice.attemptCount + 1) },
    });
    throw error;
  }
  const updated = await db.electronicInvoice.updateMany({
    where: { id: invoice.id, vendorId: input.vendorId, status: "queued", processingStartedAt: input.occurredAt },
    data: { ...identity, status: "issued", processingStartedAt: null, lastErrorCode: null },
  });
  return updated.count === 1
    ? db.electronicInvoice.findFirst({ where: { id: invoice.id, vendorId: input.vendorId } })
    : db.electronicInvoice.findFirst({ where: { id: invoice.id, vendorId: input.vendorId } });
}

export async function reconcileElectronicInvoiceRefund(
  db: InvoiceDb,
  input: { vendorId: string; orderId: string; commerceRefundId: string; refundAmountCents: number; cumulativeAmountCents: number; occurredAt: Date },
  adapter?: TaiwanElectronicInvoiceAdapter,
) {
  const invoice = await db.electronicInvoice.findFirst({ where: { vendorId: input.vendorId, orderId: input.orderId } });
  if (!invoice) return null;
  if (invoice.status === "queued" && input.cumulativeAmountCents >= invoice.amountCents) {
    await db.electronicInvoice.updateMany({
      where: { id: invoice.id, vendorId: input.vendorId, status: "queued", attemptCount: invoice.attemptCount, processingStartedAt: null },
      data: { status: "voided", voidedAt: input.occurredAt },
    });
    return db.electronicInvoice.findFirst({ where: { id: invoice.id, vendorId: input.vendorId } });
  }
  if (!["issued", "allowance"].includes(invoice.status) || !invoice.invoiceNumber || !adapter) return invoice;
  const isFullRefund = input.cumulativeAmountCents >= invoice.amountCents;
  if (!isFullRefund) {
    const existing = await db.electronicInvoiceAllowance.findUnique({ where: { vendorId_commerceRefundId: { vendorId: input.vendorId, commerceRefundId: input.commerceRefundId } } });
    if (existing) {
      await db.electronicInvoice.updateMany({ where: { id: invoice.id, vendorId: input.vendorId, status: "issued" }, data: { status: "allowance", processingStartedAt: null, lastErrorCode: null } });
      return db.electronicInvoice.findFirst({ where: { id: invoice.id, vendorId: input.vendorId } });
    }
  }
  const claimed = await db.electronicInvoice.updateMany({
    where: { id: invoice.id, vendorId: input.vendorId, status: invoice.status, attemptCount: invoice.attemptCount, processingStartedAt: null, nextAttemptAt: { lte: input.occurredAt } },
    data: { attemptCount: { increment: 1 }, lastAttemptAt: input.occurredAt, processingStartedAt: input.occurredAt },
  });
  if (claimed.count !== 1) return db.electronicInvoice.findFirst({ where: { id: invoice.id, vendorId: input.vendorId } });
  try {
    if (isFullRefund) {
      const result = await adapter.void({ idempotencyKey: `invoice-void:${invoice.id}:${input.commerceRefundId}`, vendorId: input.vendorId, invoiceNumber: invoice.invoiceNumber, refundId: input.commerceRefundId, occurredAt: input.occurredAt });
      await db.electronicInvoice.updateMany({
        where: { id: invoice.id, vendorId: input.vendorId, status: { in: ["issued", "allowance"] }, processingStartedAt: input.occurredAt },
        data: { status: "voided", voidedAt: result.voidedAt, processingStartedAt: null, lastErrorCode: null },
      });
      return db.electronicInvoice.findFirst({ where: { id: invoice.id, vendorId: input.vendorId } });
    }
    const prior = await db.electronicInvoiceAllowance.aggregate({ where: { vendorId: input.vendorId, electronicInvoiceId: invoice.id }, _sum: { pretaxAmountCents: true, taxAmountCents: true } });
    const cumulativeTax = splitTaiwanVat(input.cumulativeAmountCents);
    const tax = {
      pretaxAmountCents: cumulativeTax.pretaxAmountCents - (prior._sum.pretaxAmountCents ?? 0),
      taxAmountCents: cumulativeTax.taxAmountCents - (prior._sum.taxAmountCents ?? 0),
    };
    const allowance = await adapter.createAllowance({ idempotencyKey: `invoice-allowance:${invoice.id}:${input.commerceRefundId}`, vendorId: input.vendorId, invoiceNumber: invoice.invoiceNumber, refundId: input.commerceRefundId, amountCents: input.refundAmountCents, occurredAt: input.occurredAt });
    await db.electronicInvoiceAllowance.upsert({
      where: { vendorId_commerceRefundId: { vendorId: input.vendorId, commerceRefundId: input.commerceRefundId } },
      create: {
        id: randomUUID(), vendorId: input.vendorId, electronicInvoiceId: invoice.id,
        commerceRefundId: input.commerceRefundId, allowanceNumber: allowance.allowanceNumber,
        amountCents: input.refundAmountCents, ...tax, issuedAt: allowance.issuedAt,
      },
      update: {},
    });
    await db.electronicInvoice.updateMany({ where: { id: invoice.id, vendorId: input.vendorId, status: "issued", processingStartedAt: input.occurredAt }, data: { status: "allowance", processingStartedAt: null, lastErrorCode: null } });
    return db.electronicInvoice.findFirst({ where: { id: invoice.id, vendorId: input.vendorId } });
  } catch (error) {
    await db.electronicInvoice.updateMany({
      where: { id: invoice.id, vendorId: input.vendorId, processingStartedAt: input.occurredAt },
      data: { processingStartedAt: null, lastErrorCode: isFullRefund ? "adapter_void_failed" : "adapter_allowance_failed", nextAttemptAt: nextRetryAt(input.occurredAt, invoice.attemptCount + 1) },
    });
    throw error;
  }
}

/** Invoice work is intentionally best-effort and must never change payment success. */
export async function reconcileElectronicInvoiceAfterPayment(
  db: InvoiceDb,
  input: {
    vendorId: string; paymentTransactionId: string; eventType: string; occurredAt: Date;
    refund?: { id: string; orderId: string; amountCents: number; cumulativeAmountCents: number } | null;
  },
  adapter?: TaiwanElectronicInvoiceAdapter,
) {
  try {
    if (input.eventType === "paid") return await scheduleAndIssueOrderInvoice(db, input, adapter);
    if (input.refund) return await reconcileElectronicInvoiceRefund(db, {
      vendorId: input.vendorId, orderId: input.refund.orderId, commerceRefundId: input.refund.id,
      refundAmountCents: input.refund.amountCents, cumulativeAmountCents: input.refund.cumulativeAmountCents,
      occurredAt: input.occurredAt,
    }, adapter);
  } catch {
    // The durable payment/order event remains authoritative; a later job may retry queued invoice work.
    return null;
  }
  return null;
}
