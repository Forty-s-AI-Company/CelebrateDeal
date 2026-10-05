import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { isWp4PayUniSandboxTransactionForSource, wp4PayUniPurposeFromMetadata } from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

export const PAYUNI_REFUND_STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";

function reference(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex").slice(0, 12);
}

/** Read one exact, current-source synthetic buyer payment in a consistent snapshot.
 * This service never invokes a provider or persists raw identifiers in evidence.
 */
export async function readPendingRefundProof(db: Pick<PrismaClient, "$transaction">, transactionId: string, sourceCommit: string) {
  return db.$transaction(async (tx) => {
    const transaction = await tx.paymentTransaction.findFirst({
      where: { id: transactionId, vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni" },
      select: { id: true, vendorId: true, providerName: true, orderNumber: true, providerTradeNo: true,
        grossAmountCents: true, refundedAmountCents: true, status: true, metadata: true,
        refunds: { select: { status: true, refundAmountCents: true, providerEventId: true } } },
    });
    if (!transaction || !transaction.orderNumber || !transaction.providerTradeNo
      || !isWp4PayUniSandboxTransactionForSource(transaction, sourceCommit)
      || wp4PayUniPurposeFromMetadata(transaction.metadata) !== "buyer_order") return null;

    // Payment evidence must belong to this order, trade, amount and tenant.
    // A processed callback for an unrelated transaction cannot satisfy the gate.
    const callback = await tx.webhookEvent.findFirst({
      where: { vendorId: transaction.vendorId, provider: "payuni", eventType: "paid", status: "processed",
        AND: [
          { payload: { path: ["normalized", "orderNumber"], equals: transaction.orderNumber } },
          { payload: { path: ["normalized", "providerTradeNo"], equals: transaction.providerTradeNo } },
          { payload: { path: ["normalized", "grossAmountCents"], equals: transaction.grossAmountCents } },
        ] },
      select: { id: true },
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
      paymentCallbackMatched: Boolean(callback), singleProcessedRefund,
      refundPersistencePassed: Boolean(callback) && singleProcessedRefund && transaction.status === "refunded"
        && transaction.refundedAmountCents === transaction.grossAmountCents,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
