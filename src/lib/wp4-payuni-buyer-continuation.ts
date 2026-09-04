import type { PrismaClient } from "@prisma/client";
import { executeNextWp4PayUniSandboxRefund } from "@/lib/wp4-payuni-sandbox-refund-execution";
import { reconcileWp4PayUniSandboxRefund, type Wp4PayUniSandboxReconciliationResult } from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { wp4PayUniPurposeFromMetadata, wp4SourceCommitFromMetadata } from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA } from "@/lib/wp4-payuni-buyer-callback-retry";

export const WP4_CURRENT_BUYER_CONTINUATION_SOURCE_SHA = WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA;
export type BuyerContinuationResult = {
  status: "COMPLETED" | "REFUND_NOT_ELIGIBLE" | "PROVIDER_UNAVAILABLE" | "PROVIDER_REJECTED" | "RECONCILIATION_REQUIRED" | Wp4PayUniSandboxReconciliationResult["status"];
  providerWriteAttempted?: boolean;
  reconciled?: boolean;
};
type Db = Pick<PrismaClient, "paymentTransaction" | "webhookEvent" | "refundRecord">;

async function fixedCandidate(db: Db) {
  const rows = await db.paymentTransaction.findMany({
    where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni", status: { in: ["pending", "paid", "partially_refunded", "refunded"] } },
    select: { id: true, vendorId: true, providerName: true, orderNumber: true, providerTradeNo: true, grossAmountCents: true, refundedAmountCents: true, status: true, metadata: true },
  });
  return rows.filter((row) => row.vendorId === WP4_SANDBOX_FIXTURE.vendorId
    && row.providerName === "payuni"
    && wp4SourceCommitFromMetadata(row.metadata) === WP4_CURRENT_BUYER_CONTINUATION_SOURCE_SHA
    && wp4PayUniPurposeFromMetadata(row.metadata) === "buyer_order"
    && row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    && (row.metadata as Record<string, unknown>).productId === WP4_SANDBOX_FIXTURE.productId
    && (row.metadata as Record<string, unknown>).wp4PaymentSubmissionReserved === true
    && Number.isSafeInteger(row.grossAmountCents) && row.grossAmountCents > 0 && row.grossAmountCents % 100 === 0);
}

async function processedEvent(db: Db, orderNumber: string) {
  return db.webhookEvent.findMany({
    where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, provider: "payuni", eventType: "paid", status: "processed", payload: { path: ["normalized", "orderNumber"], equals: orderNumber } },
    select: { id: true }, take: 2,
  });
}

export async function continueWp4BuyerRefund(db: Db): Promise<BuyerContinuationResult> {
  const candidates = await fixedCandidate(db);
  if (candidates.length === 0) return { status: "FIXTURE_UNAVAILABLE", providerWriteAttempted: false };
  if (candidates.length > 1) return { status: "CANDIDATE_AMBIGUOUS", providerWriteAttempted: false };
  const candidate = candidates[0]!;
  if (candidate.status !== "paid" || candidate.grossAmountCents !== 100 || candidate.refundedAmountCents !== 0 || !candidate.providerTradeNo || !candidate.orderNumber) return { status: "REFUND_NOT_ELIGIBLE", providerWriteAttempted: false };
  const events = await processedEvent(db, candidate.orderNumber);
  if (events.length !== 1) return { status: events.length > 1 ? "CANDIDATE_AMBIGUOUS" : "REFUND_NOT_ELIGIBLE", providerWriteAttempted: false };
  const existing = await db.refundRecord.findMany({ where: { paymentTransactionId: candidate.id }, select: { id: true }, take: 1 });
  if (existing.length !== 0) return { status: "REFUND_NOT_ELIGIBLE", providerWriteAttempted: false };
  const result = await executeNextWp4PayUniSandboxRefund(db as Parameters<typeof executeNextWp4PayUniSandboxRefund>[0], WP4_CURRENT_BUYER_CONTINUATION_SOURCE_SHA, undefined, candidate.id);
  return { status: result.status, providerWriteAttempted: result.providerWriteAttempted };
}

export async function continueWp4BuyerReconcile(db: Db): Promise<BuyerContinuationResult> {
  const candidates = await fixedCandidate(db);
  if (candidates.length === 0) return { status: "FIXTURE_UNAVAILABLE", reconciled: false };
  if (candidates.length > 1) return { status: "CANDIDATE_AMBIGUOUS", reconciled: false };
  const candidate = candidates[0]!;
  if (!candidate.orderNumber || !candidate.providerTradeNo || !["paid", "partially_refunded", "refunded"].includes(candidate.status)) return { status: "PENDING_RESERVATION_UNAVAILABLE", reconciled: false };
  const events = await processedEvent(db, candidate.orderNumber);
  if (events.length !== 1) return { status: events.length > 1 ? "CANDIDATE_AMBIGUOUS" : "PENDING_RESERVATION_UNAVAILABLE", reconciled: false };
  const result = await reconcileWp4PayUniSandboxRefund(db as unknown as Parameters<typeof reconcileWp4PayUniSandboxRefund>[0], WP4_CURRENT_BUYER_CONTINUATION_SOURCE_SHA, candidate.id);
  return { status: result.status, reconciled: result.reconciled };
}
