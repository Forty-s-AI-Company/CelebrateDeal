import type { PrismaClient } from "@prisma/client";
import { retryWebhookEvent } from "@/lib/webhook-retry";
import type { PaymentWebhookFailureCode } from "@/lib/payment-webhook-errors";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { wp4PayUniPurposeFromMetadata, wp4SourceCommitFromMetadata } from "@/lib/wp4-payuni-sandbox-reconciliation";

export const WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA = "8497ec1ad66a07b0a286585dc050915c998d0f67";
export type BuyerCallbackRetryResult = {
  status: "PROCESSED" | "ALREADY_PROCESSED" | "FIXTURE_UNAVAILABLE" | "CANDIDATE_AMBIGUOUS" | "EVENT_UNAVAILABLE" | "RETRY_REJECTED" | "RETRY_FAILED";
  retryAttempts: 0 | 1;
  failureCode: "NONE" | PaymentWebhookFailureCode | "UNKNOWN";
};
type RetryDb = Pick<PrismaClient, "paymentTransaction" | "webhookEvent">;
function empty(status: BuyerCallbackRetryResult["status"]): BuyerCallbackRetryResult { return { status, retryAttempts: 0, failureCode: "NONE" }; }
function metadataObject(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

export async function retryWp4PayUniBuyerCallback(db: RetryDb): Promise<BuyerCallbackRetryResult> {
  const transactions = await db.paymentTransaction.findMany({
    where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni", status: { in: ["pending", "paid"] } },
    select: { id: true, vendorId: true, providerName: true, orderNumber: true, grossAmountCents: true, status: true, metadata: true },
    orderBy: { occurredAt: "desc" },
  });
  const candidates = transactions.filter((transaction) => {
    const metadata = metadataObject(transaction.metadata);
    return transaction.vendorId === WP4_SANDBOX_FIXTURE.vendorId
      && transaction.providerName === "payuni"
      && Number.isSafeInteger(transaction.grossAmountCents) && transaction.grossAmountCents > 0 && transaction.grossAmountCents % 100 === 0
      && wp4SourceCommitFromMetadata(metadata) === WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA
      && wp4PayUniPurposeFromMetadata(metadata) === "buyer_order"
      && metadata?.productId === WP4_SANDBOX_FIXTURE.productId
      && metadata.wp4PaymentSubmissionReserved === true;
  });
  if (candidates.length === 0) return empty("FIXTURE_UNAVAILABLE");
  if (candidates.length > 1) return empty("CANDIDATE_AMBIGUOUS");
  const transaction = candidates[0]!;
  if (transaction.status === "paid") return empty("ALREADY_PROCESSED");
  if (!transaction.orderNumber) return empty("EVENT_UNAVAILABLE");
  const events = await db.webhookEvent.findMany({
    where: { provider: "payuni", eventType: "paid", status: "failed", payload: { path: ["normalized", "orderNumber"], equals: transaction.orderNumber } },
    select: { id: true, status: true, retryCount: true, maxRetries: true }, take: 2,
  });
  if (events.length === 0 || events.some((event) => event.retryCount >= event.maxRetries)) return empty("EVENT_UNAVAILABLE");
  if (events.length > 1) return empty("CANDIDATE_AMBIGUOUS");
  const retry = await retryWebhookEvent(events[0]!.id, "wp4:current-buyer-callback");
  if (retry.status === "processed") return { status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" };
  if (retry.status === "claimed_elsewhere" || retry.status === "missing") return { status: "RETRY_REJECTED", retryAttempts: 1, failureCode: "UNKNOWN" };
  const failureCode = retry.errorCode ?? "UNKNOWN";
  return { status: "RETRY_FAILED", retryAttempts: 1, failureCode };
}
