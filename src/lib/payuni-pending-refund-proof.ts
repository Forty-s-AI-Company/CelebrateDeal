import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { isWp4PayUniSandboxTransactionForSource, wp4PayUniPurposeFromMetadata } from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { wp4HistoricalBuyerWhere } from "@/lib/wp4-buyer-recovery";

export const PAYUNI_REFUND_STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
export const Q1_ORIGINAL_REFUND_SOURCE = "9acfe8d2dba62430e950cff2c0387841ab91f44b";

function reference(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex").slice(0, 12);
}

/** Read one exact, current-source synthetic buyer payment in a consistent snapshot.
 * This service never invokes a provider or persists raw identifiers in evidence.
 */
async function readProof(tx: Prisma.TransactionClient, transactionId: string, sourceCommit: string, transactionSource = sourceCommit) {
    const transaction = await tx.paymentTransaction.findFirst({
      where: { id: transactionId, vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni" },
      select: { id: true, vendorId: true, providerName: true, orderNumber: true, providerTradeNo: true,
        grossAmountCents: true, refundedAmountCents: true, status: true, metadata: true,
        refunds: { select: { status: true, refundAmountCents: true, providerEventId: true } } },
    });
    if (!transaction || !transaction.orderNumber || !transaction.providerTradeNo
      || !isWp4PayUniSandboxTransactionForSource(transaction, transactionSource)
      || wp4PayUniPurposeFromMetadata(transaction.metadata) !== "buyer_order") return null;

    // Payment evidence must belong to this order, trade, amount and tenant.
    // A processed callback for an unrelated transaction cannot satisfy the gate.
    const callbacks = await tx.webhookEvent.findMany({
      where: { vendorId: transaction.vendorId, provider: "payuni", eventType: "paid", status: "processed",
        AND: [
          { payload: { path: ["normalized", "orderNumber"], equals: transaction.orderNumber } },
          { payload: { path: ["normalized", "providerTradeNo"], equals: transaction.providerTradeNo } },
          { payload: { path: ["normalized", "grossAmountCents"], equals: transaction.grossAmountCents } },
        ] },
      select: { id: true }, take: 2,
    });
    const refunds = transaction.refunds;
    const singleProcessedRefund = refunds.length === 1 && refunds[0]!.status === "processed"
      && refunds[0]!.refundAmountCents === transaction.grossAmountCents
      && Boolean(refunds[0]!.providerEventId?.trim());
    return {
      schemaVersion: "celebratedeal-payuni-pending-refund-proof/v1",
      environment: "preview", payuniEnvironment: "sandbox", appHost: PAYUNI_REFUND_STAGING_HOST,
      providerHost: "sandbox-api.payuni.com.tw", sourceCommit, vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      transactionRef: reference(transaction.id), orderRef: reference(transaction.orderNumber), tradeRef: reference(transaction.providerTradeNo),
      status: transaction.status, grossAmountCents: transaction.grossAmountCents,
      refundedAmountCents: transaction.refundedAmountCents, refundRecordCount: refunds.length,
      paymentCallbackMatched: callbacks.length === 1, singleProcessedRefund,
      refundPersistencePassed: callbacks.length === 1 && singleProcessedRefund && transaction.status === "refunded"
        && transaction.refundedAmountCents === transaction.grossAmountCents,
    };
}

/** The normal current-source proof remains source-bound; no historical fallback. */
export async function readPendingRefundProof(db: Pick<PrismaClient, "$transaction">, transactionId: string, sourceCommit: string) {
  return db.$transaction(tx => readProof(tx, transactionId, sourceCommit), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** The one catalog-owned original is independent of the executing deployment.
 * Never accept a caller-owned transaction/source or rewrite payment metadata. */
export async function readQ1OriginalPendingRefundProof(db: Pick<PrismaClient, "$transaction">, executionSource: string) {
  if (!/^[a-f0-9]{40}$/.test(executionSource)) return null;
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(Q1_ORIGINAL_REFUND_SOURCE), take: 2,
      select: { id: true, metadata: true } });
    if (payments.length !== 1) return null;
    const payment = payments[0]!, metadata = payment.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
      || metadata.wp4CallbackRetryReserved !== true || metadata.q1SchemaRecoveryReserved !== true) return null;
    const proof = await readProof(tx, payment.id, executionSource, Q1_ORIGINAL_REFUND_SOURCE);
    if (!proof?.paymentCallbackMatched) return null;
    return { ...proof, transactionSourceCommit: Q1_ORIGINAL_REFUND_SOURCE, historicalOriginalBound: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
