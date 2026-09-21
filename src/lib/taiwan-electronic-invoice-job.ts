import type { PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import {
  reconcileElectronicInvoiceRefund,
  scheduleAndIssueOrderInvoice,
  type TaiwanElectronicInvoiceAdapter,
} from "@/lib/taiwan-electronic-invoice";

const MAX_BATCH_SIZE = 20;

export type ElectronicInvoiceJobResult = {
  adapterAvailable: boolean;
  attempted: number;
  issued: number;
  allowances: number;
  voided: number;
  failed: number;
};

/**
 * Bounded, tenant-safe durable worker. The route may invoke it repeatedly;
 * unique constraints and canonical refund IDs keep every transition idempotent.
 */
export async function runElectronicInvoiceJob(input: {
  adapter?: TaiwanElectronicInvoiceAdapter;
  db?: PrismaClient;
  now?: Date;
  limit?: number;
} = {}): Promise<ElectronicInvoiceJobResult> {
  const result: ElectronicInvoiceJobResult = { adapterAvailable: Boolean(input.adapter), attempted: 0, issued: 0, allowances: 0, voided: 0, failed: 0 };
  if (!input.adapter) return result;
  const db = input.db ?? getDb();
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(MAX_BATCH_SIZE, input.limit ?? MAX_BATCH_SIZE));
  const staleBefore = new Date(now.getTime() - 15 * 60_000);
  await db.electronicInvoice.updateMany({
    where: { processingStartedAt: { lt: staleBefore } },
    data: { processingStartedAt: null, lastErrorCode: "stale_processing_lease_recovered", nextAttemptAt: now },
  });

  const queued = await db.electronicInvoice.findMany({
    where: { status: "queued", nextAttemptAt: { lte: now }, processingStartedAt: null },
    select: { id: true, vendorId: true, orderId: true, attemptCount: true, order: { select: { primaryPaymentTransactionId: true, status: true } } },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  for (const invoice of queued) {
    result.attempted += 1;
    if (invoice.order.status === "refunded") {
      const updated = await db.electronicInvoice.updateMany({
        where: { id: invoice.id, vendorId: invoice.vendorId, status: "queued", attemptCount: invoice.attemptCount, processingStartedAt: null },
        data: { status: "voided", voidedAt: now, lastAttemptAt: now, attemptCount: { increment: 1 } },
      });
      result.voided += updated.count;
      continue;
    }
    if (!invoice.order.primaryPaymentTransactionId) continue;
    try {
      const issued = await scheduleAndIssueOrderInvoice(db, { vendorId: invoice.vendorId, paymentTransactionId: invoice.order.primaryPaymentTransactionId, occurredAt: now }, input.adapter);
      if (issued?.status === "issued") result.issued += 1;
    } catch {
      result.failed += 1;
    }
  }

  const refundable = await db.electronicInvoice.findMany({
    where: { status: { in: ["issued", "allowance"] }, nextAttemptAt: { lte: now }, processingStartedAt: null, order: { refunds: { some: { status: "processed" } } } },
    select: {
      vendorId: true,
      orderId: true,
      status: true,
      order: {
        select: {
          refunds: {
            where: { status: "processed" },
            orderBy: { occurredAt: "asc" },
            select: { id: true, amountCents: true, cumulativeAmountCents: true, occurredAt: true },
          },
        },
      },
    },
    take: limit,
  });
  for (const invoice of refundable) {
    for (const refund of invoice.order.refunds) {
      const before = await db.electronicInvoiceAllowance.count({ where: { vendorId: invoice.vendorId, commerceRefundId: refund.id } });
      try {
        const reconciled = await reconcileElectronicInvoiceRefund(db, { vendorId: invoice.vendorId, orderId: invoice.orderId, commerceRefundId: refund.id, refundAmountCents: refund.amountCents, cumulativeAmountCents: refund.cumulativeAmountCents, occurredAt: refund.occurredAt }, input.adapter);
        if (reconciled?.status === "voided") { result.voided += 1; break; }
        const after = await db.electronicInvoiceAllowance.count({ where: { vendorId: invoice.vendorId, commerceRefundId: refund.id } });
        if (before === 0 && after === 1) result.allowances += 1;
      } catch {
        result.failed += 1;
      }
    }
  }
  return result;
}
