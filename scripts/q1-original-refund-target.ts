import { Prisma, type PrismaClient } from "@prisma/client";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";
import { WP4_SANDBOX_FIXTURE } from "../src/lib/wp4-sandbox-fixture";
export const ORIGINAL_REFUND_SOURCE = "9acfe8d2dba62430e950cff2c0387841ab91f44b";

/** Fixed catalog only. Raw identifiers never leave the injected Node process. */
export async function readOriginalRefundTarget(db: Pick<PrismaClient, "$transaction">) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const rows = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(ORIGINAL_REFUND_SOURCE), take: 2,
      select: { id: true, orderNumber: true, providerTradeNo: true, status: true, refundedAmountCents: true, metadata: true,
        refunds: { select: { status: true } } } });
    if (rows.length !== 1) throw new Error("Original target unavailable.");
    const row = rows[0]!, metadata = row.metadata;
    if (!row.orderNumber || !row.providerTradeNo || !metadata || typeof metadata !== "object" || Array.isArray(metadata)
      || metadata.wp4CallbackRetryReserved !== true || metadata.q1SchemaRecoveryReserved !== true
      || metadata.q1OriginalRefundReserved === true || row.status !== "paid" || row.refundedAmountCents !== 0 || row.refunds.length !== 0)
      throw new Error("Original target rejected.");
    return { transactionId: row.id, orderNumber: row.orderNumber, providerTradeNo: row.providerTradeNo };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Reserve once immediately before the exact CSRF form submission. A lost UI
 * response cannot authorize another attempt; the marker is never cleared. */
export async function reserveOriginalRefund(db: Pick<PrismaClient, "$transaction">, transactionId: string) {
  return db.$transaction(async tx => {
    const rows = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(ORIGINAL_REFUND_SOURCE), take: 2, select: { id: true } });
    if (rows.length !== 1 || rows[0]!.id !== transactionId) throw new Error("Original reservation rejected.");
    const changed = await tx.$executeRaw(Prisma.sql`
      UPDATE "PaymentTransaction" p
      SET "metadata" = jsonb_set(p."metadata", '{q1OriginalRefundReserved}', 'true'::jsonb)
      WHERE p."id" = ${transactionId} AND p."vendorId" = ${WP4_SANDBOX_FIXTURE.vendorId}
        AND p."providerName" = 'payuni' AND p."status" = 'paid'
        AND p."grossAmountCents" = 100 AND p."refundedAmountCents" = 0 AND p."currency" = 'TWD'
        AND p."metadata"->>'wp4SourceCommit' = ${ORIGINAL_REFUND_SOURCE}
        AND p."metadata"->>'wp4CallbackRetryReserved' = 'true'
        AND p."metadata"->>'q1SchemaRecoveryReserved' = 'true'
        AND p."metadata"->>'q1OriginalRefundReserved' IS DISTINCT FROM 'true'
        AND NOT EXISTS (SELECT 1 FROM "RefundRecord" r WHERE r."paymentTransactionId" = p."id")
    `);
    if (changed !== 1) throw new Error("Original reservation rejected.");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
/** Resume only observation of a previously reserved original. No writes, marker
 * clearing, replacement transaction or refund submission are permitted here. */
export async function readReservedOriginalRefundTarget(db: Pick<PrismaClient, "$transaction">) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const rows = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(ORIGINAL_REFUND_SOURCE), take: 2,
      select: { id: true, orderNumber: true, providerTradeNo: true, status: true, grossAmountCents: true,
        refundedAmountCents: true, metadata: true, refunds: { select: { status: true, refundAmountCents: true, providerEventId: true } } } });
    if (rows.length !== 1) throw new Error("Reserved original unavailable.");
    const row = rows[0]!, metadata = row.metadata;
    if (!row.orderNumber || !row.providerTradeNo || !metadata || typeof metadata !== "object" || Array.isArray(metadata)
      || metadata.q1OriginalRefundReserved !== true || metadata.wp4CallbackRetryReserved !== true || metadata.q1SchemaRecoveryReserved !== true
      || row.status !== "refunded" || row.refundedAmountCents !== row.grossAmountCents
      || row.refunds.length !== 1 || row.refunds[0]!.status !== "processed"
      || row.refunds[0]!.refundAmountCents !== row.grossAmountCents || !row.refunds[0]!.providerEventId?.trim())
      throw new Error("Reserved original not terminal.");
    return { transactionId: row.id, orderNumber: row.orderNumber, providerTradeNo: row.providerTradeNo, reservationVerified: true as const, duplicateUIVerified: metadata.q1OriginalRefundDuplicateVerified === true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
/** Persist only a duplicate rejection actually observed in the finance browser.
 * It cannot create or complete a refund; a full processed original is required. */
export async function recordOriginalDuplicateVerified(db: Pick<PrismaClient, "$transaction">, transactionId: string) {
  const target = await readReservedOriginalRefundTarget(db);
  if (target.transactionId !== transactionId) throw new Error("Duplicate original rejected.");
  return db.$transaction(async tx => {
    const changed = await tx.$executeRaw(Prisma.sql`
      UPDATE "PaymentTransaction" p SET "metadata" = jsonb_set(p."metadata", '{q1OriginalRefundDuplicateVerified}', 'true'::jsonb)
      WHERE p."id"=${transactionId} AND p."vendorId"=${WP4_SANDBOX_FIXTURE.vendorId} AND p."providerName"='payuni'
        AND p."status"='refunded' AND p."grossAmountCents"=100 AND p."refundedAmountCents"=100 AND p."currency"='TWD'
        AND p."metadata"->>'wp4SourceCommit'=${ORIGINAL_REFUND_SOURCE}
        AND p."metadata"->>'q1OriginalRefundReserved'='true'
        AND (SELECT COUNT(*) FROM "RefundRecord" r WHERE r."paymentTransactionId"=p."id")=1
        AND EXISTS (SELECT 1 FROM "RefundRecord" r WHERE r."paymentTransactionId"=p."id" AND r."status"='processed'
          AND r."refundAmountCents"=100 AND length(trim(r."providerEventId"))>0)
    `);
    if (changed !== 1) throw new Error("Duplicate original rejected.");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}