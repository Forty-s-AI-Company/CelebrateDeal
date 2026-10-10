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