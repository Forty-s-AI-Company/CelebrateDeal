import type { PaymentTransaction, PrismaClient } from "@prisma/client";
import { getPaymentProvider } from "@/lib/payment-providers";
import { PaymentQueryProviderError, type PaymentQueryResult } from "@/lib/payment-providers/types";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { wp4PayUniPurposeFromMetadata, wp4SourceCommitFromMetadata } from "@/lib/wp4-payuni-sandbox-reconciliation";
import { paymentWebhookFailureMessage, type PaymentWebhookFailureCode } from "@/lib/payment-webhook-errors";

// The sole synthetic submission from run 36217020374. Never accept a caller-supplied transaction ID.
export const WP4_CURRENT_BUYER_PAYMENT_SOURCE_SHA = "00099f7e3b3c8a7e923047e1ab72a827fcb78e4c";

export type BuyerPaymentCheckResult = {
  status: "VERIFIED" | "MISSING" | "AMBIGUOUS" | "REFERENCE_UNAVAILABLE" | "QUERY_REJECTED" | "QUERY_FAILED" | "STATE_MISMATCH";
  localStatus: "UNKNOWN" | "PENDING" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED";
  providerStatus: "UNKNOWN" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
  referenceState: "UNKNOWN" | "AVAILABLE" | "ORDER_MISSING" | "PROVIDER_MISSING" | "BOTH_MISSING";
  queryAttempts: 0 | 1;
  callbackStatus: "NOT_OBSERVED" | "RECEIVED" | "PROCESSED" | "FAILED" | "AMBIGUOUS" | "UNKNOWN";
  callbackFailure: "NONE" | "SCOPE_MISSING" | "SCOPE_INVALID" | "SCOPE_MISMATCH" | "ORDER_AMBIGUOUS" | "AMOUNT_MISMATCH" | "INVENTORY_CONFLICT" | "PROCESSING_CLAIM_LOST" | "PROCESSING_FAILED" | "UNKNOWN";
};

type CheckDb = {
  paymentTransaction: Pick<PrismaClient["paymentTransaction"], "findMany">;
  webhookEvent: Pick<PrismaClient["webhookEvent"], "findMany">;
};

function localStatus(value: string): BuyerPaymentCheckResult["localStatus"] {
  if (value === "pending" || value === "paid" || value === "partially_refunded" || value === "refunded" || value === "failed") {
    return value === "partially_refunded" ? "PARTIALLY_REFUNDED" : value.toUpperCase() as BuyerPaymentCheckResult["localStatus"];
  }
  return "UNKNOWN";
}

function providerStatus(value: PaymentQueryResult["status"]): BuyerPaymentCheckResult["providerStatus"] {
  return value === "paid" ? "PAID" : value === "partially_refunded" ? "PARTIALLY_REFUNDED" : value === "refunded" ? "REFUNDED" : "UNKNOWN";
}

/** Reveal only which read-only query reference is missing, never its value. */
function referenceState(orderNumber: string | null, providerTradeNo: string | null): BuyerPaymentCheckResult["referenceState"] {
  const orderAvailable = Boolean(orderNumber?.trim());
  const providerAvailable = Boolean(providerTradeNo?.trim());
  if (!orderAvailable && !providerAvailable) return "BOTH_MISSING";
  if (!orderAvailable) return "ORDER_MISSING";
  if (!providerAvailable) return "PROVIDER_MISSING";
  return "AVAILABLE";
}

function metadataObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const CALLBACK_FAILURE_CODES: readonly PaymentWebhookFailureCode[] = ["scope_missing", "scope_invalid", "scope_mismatch", "order_ambiguous", "amount_mismatch", "inventory_conflict", "processing_claim_lost", "processing_failed"];
function callbackFailure(errorMessage: string | null): BuyerPaymentCheckResult["callbackFailure"] {
  if (!errorMessage) return "UNKNOWN";
  const code = CALLBACK_FAILURE_CODES.find((candidate) => paymentWebhookFailureMessage(candidate) === errorMessage);
  return code ? code.toUpperCase() as BuyerPaymentCheckResult["callbackFailure"] : "UNKNOWN";
}

type CallbackEvidence = Pick<BuyerPaymentCheckResult, "callbackStatus" | "callbackFailure">;
async function readCallbackEvidence(db: CheckDb, orderNumber: string): Promise<CallbackEvidence> {
  const events = await db.webhookEvent.findMany({
    where: { provider: "payuni", eventType: "paid", payload: { path: ["normalized", "orderNumber"], equals: orderNumber } },
    select: { status: true, errorMessage: true },
    take: 2,
  });
  if (events.length === 0) return { callbackStatus: "NOT_OBSERVED", callbackFailure: "NONE" };
  if (events.length > 1) return { callbackStatus: "AMBIGUOUS", callbackFailure: "UNKNOWN" };
  const event = events[0]!;
  if (event.status === "failed") return { callbackStatus: "FAILED", callbackFailure: callbackFailure(event.errorMessage) };
  if (event.status === "processed") return { callbackStatus: "PROCESSED", callbackFailure: "NONE" };
  if (event.status === "received") return { callbackStatus: "RECEIVED", callbackFailure: "NONE" };
  return { callbackStatus: "UNKNOWN", callbackFailure: "UNKNOWN" };
}

export async function checkWp4PayUniBuyerPayment(db: CheckDb): Promise<BuyerPaymentCheckResult> {
  const rows = await db.paymentTransaction.findMany({
    where: {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      status: { in: ["pending", "paid", "partially_refunded", "refunded", "failed"] },
      AND: [
        { metadata: { path: ["wp4SourceCommit"], equals: WP4_CURRENT_BUYER_PAYMENT_SOURCE_SHA } },
        { metadata: { path: ["billingPurpose"], equals: "buyer_order" } },
        { metadata: { path: ["productId"], equals: WP4_SANDBOX_FIXTURE.productId } },
        { metadata: { path: ["wp4PaymentSubmissionReserved"], equals: true } },
      ],
    },
    orderBy: { occurredAt: "desc" },
    take: 2,
    select: {
      id: true, vendorId: true, providerName: true, providerTradeNo: true,
      orderNumber: true, grossAmountCents: true, status: true, metadata: true,
    },
  });
  const candidates = rows.filter((row) => {
    const metadata = metadataObject(row.metadata);
    return row.vendorId === WP4_SANDBOX_FIXTURE.vendorId
      && row.providerName === "payuni"
      && ["pending", "paid", "partially_refunded", "refunded", "failed"].includes(row.status)
      && Number.isSafeInteger(row.grossAmountCents)
      && row.grossAmountCents > 0
      && row.grossAmountCents % 100 === 0
      && wp4SourceCommitFromMetadata(metadata) === WP4_CURRENT_BUYER_PAYMENT_SOURCE_SHA
      && wp4PayUniPurposeFromMetadata(metadata) === "buyer_order"
      && metadata?.productId === WP4_SANDBOX_FIXTURE.productId
      && metadata.wp4PaymentSubmissionReserved === true;
  });
  if (candidates.length === 0) return { status: "MISSING", localStatus: "UNKNOWN", providerStatus: "UNKNOWN", referenceState: "UNKNOWN", queryAttempts: 0, callbackStatus: "UNKNOWN", callbackFailure: "UNKNOWN" };
  if (candidates.length > 1) return { status: "AMBIGUOUS", localStatus: "UNKNOWN", providerStatus: "UNKNOWN", referenceState: "UNKNOWN", queryAttempts: 0, callbackStatus: "UNKNOWN", callbackFailure: "UNKNOWN" };

  const transaction = candidates[0]!;
  const local = localStatus(transaction.status);
  const reference = referenceState(transaction.orderNumber, transaction.providerTradeNo);
  const callback = transaction.orderNumber ? await readCallbackEvidence(db, transaction.orderNumber) : { callbackStatus: "UNKNOWN" as const, callbackFailure: "UNKNOWN" as const };
  if (reference !== "AVAILABLE") {
    return { status: "REFERENCE_UNAVAILABLE", localStatus: local, providerStatus: "UNKNOWN", referenceState: reference, queryAttempts: 0, ...callback };
  }

  let snapshot: PaymentQueryResult;
  try {
    const provider = getPaymentProvider("payuni");
    if (!provider.queryPayment) return { status: "QUERY_REJECTED", localStatus: local, providerStatus: "UNKNOWN", referenceState: reference, queryAttempts: 0, ...callback };
    snapshot = await provider.queryPayment({ transaction: transaction as PaymentTransaction });
  } catch (error) {
    return {
      status: error instanceof PaymentQueryProviderError && error.category === "request_contract" ? "QUERY_REJECTED" : "QUERY_FAILED",
      localStatus: local,
      providerStatus: "UNKNOWN",
      referenceState: reference,
      queryAttempts: 1,
      ...callback,
    };
  }
  const providerState = providerStatus(snapshot.status);
  const matchingIdentity = snapshot.providerTradeNo === transaction.providerTradeNo
    && snapshot.orderNumber === transaction.orderNumber
    && snapshot.grossAmountCents === transaction.grossAmountCents;
  const matchingState = (local === "PAID" && providerState === "PAID")
    || (local === "PARTIALLY_REFUNDED" && providerState === "PARTIALLY_REFUNDED")
    || (local === "REFUNDED" && providerState === "REFUNDED");
  return {
    status: matchingIdentity && matchingState ? "VERIFIED" : "STATE_MISMATCH",
    localStatus: local,
    providerStatus: providerState,
    referenceState: reference,
    queryAttempts: 1,
    ...callback,
  };
}
