import type { PrismaClient } from "@prisma/client";
import { executePayUniRefund } from "@/lib/payuni-refund-execution";
import {
  isWp4PayUniSandboxTransactionForSource,
  wp4PayUniPurposeFromMetadata,
  type Wp4PayUniPurpose,
} from "@/lib/wp4-payuni-sandbox-reconciliation";
import {
  selectWp4PayUniFixedRefund,
  type Wp4PayUniRefundPhase,
} from "@/lib/wp4-payuni-sandbox-refund";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

const PURPOSES: readonly Wp4PayUniPurpose[] = [
  "buyer_order",
  "platform_subscription",
  "invoice_payment",
];

type Candidate = {
  id: string;
  vendorId: string;
  providerName: string;
  grossAmountCents: number;
  refundedAmountCents: number;
  gatewayFeeCents: number;
  platformFeeCents: number;
  status: string;
  metadata: unknown;
};

export type Wp4PayUniSandboxRefundExecutionResult = {
  status: "COMPLETED" | "FIXTURE_UNAVAILABLE" | "CANDIDATE_AMBIGUOUS" | "REFUND_NOT_ELIGIBLE" | "PROVIDER_UNAVAILABLE" | "PROVIDER_REJECTED" | "RECONCILIATION_REQUIRED";
  purpose: Wp4PayUniPurpose | null;
  phase: Wp4PayUniRefundPhase | null;
  providerWriteAttempted: boolean;
};

type RefundExecutionDb = Pick<PrismaClient, "paymentTransaction">;

function monthKey(now: Date) {
  return now.toISOString().slice(0, 7);
}

function matchesPurpose(candidate: Candidate, sourceCommit: string, purpose: Wp4PayUniPurpose) {
  return isWp4PayUniSandboxTransactionForSource(candidate, sourceCommit)
    && wp4PayUniPurposeFromMetadata(candidate.metadata) === purpose;
}

/**
 * Executes at most one server-selected WP4 refund. It has no caller-owned
 * transaction, amount, or phase; each invocation walks a fixed purpose order
 * and chooses partial before remaining. An ambiguous fixture set fails closed
 * before the provider refund function is reached.
 */
export async function executeNextWp4PayUniSandboxRefund(
  db: RefundExecutionDb,
  sourceCommit: string,
  now = new Date(),
): Promise<Wp4PayUniSandboxRefundExecutionResult> {
  const rows = await db.paymentTransaction.findMany({
    where: {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      status: { in: ["paid", "partially_refunded"] },
    },
    select: {
      id: true,
      vendorId: true,
      providerName: true,
      grossAmountCents: true,
      refundedAmountCents: true,
      gatewayFeeCents: true,
      platformFeeCents: true,
      status: true,
      metadata: true,
    },
  }) as Candidate[];

  for (const purpose of PURPOSES) {
    const candidates = rows.filter((row) => matchesPurpose(row, sourceCommit, purpose));
    if (candidates.length > 1) {
      return { status: "CANDIDATE_AMBIGUOUS", purpose, phase: null, providerWriteAttempted: false };
    }
    const candidate = candidates[0];
    if (!candidate) continue;
    const phase: Wp4PayUniRefundPhase = candidate.status === "paid" ? "partial" : "remaining";
    const fixed = selectWp4PayUniFixedRefund(candidate, phase);
    if (!fixed || fixed.purpose !== purpose) {
      return { status: "REFUND_NOT_ELIGIBLE", purpose, phase, providerWriteAttempted: false };
    }
    const result = await executePayUniRefund({
      db: db as PrismaClient,
      transactionId: candidate.id,
      refundAmountCents: fixed.refundAmountCents,
      gatewayFeeRefundCents: fixed.gatewayFeeRefundCents,
      platformFeeRefundCents: fixed.platformFeeRefundCents,
      reason: "wp4_sandbox_fixed_refund",
      monthKey: monthKey(now),
      actor: { id: WP4_SANDBOX_FIXTURE.userId, label: "wp4_sandbox_runner" },
    });
    if (result.disposition === "completed") {
      return { status: "COMPLETED", purpose, phase, providerWriteAttempted: true };
    }
    if (result.disposition === "provider_unavailable") {
      return { status: "PROVIDER_UNAVAILABLE", purpose, phase, providerWriteAttempted: false };
    }
    if (result.disposition === "provider_request_rejected") {
      return { status: "PROVIDER_REJECTED", purpose, phase, providerWriteAttempted: true };
    }
    return { status: "RECONCILIATION_REQUIRED", purpose, phase, providerWriteAttempted: true };
  }
  return { status: "FIXTURE_UNAVAILABLE", purpose: null, phase: null, providerWriteAttempted: false };
}
