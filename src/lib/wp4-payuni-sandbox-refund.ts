import {
  isWp4PayUniSandboxTransaction,
  wp4PayUniPurposeFromMetadata,
  type Wp4PayUniPurpose,
} from "@/lib/wp4-payuni-sandbox-reconciliation";

export const WP4_PAYUNI_REFUND_PHASES = ["partial", "remaining"] as const;

export type Wp4PayUniRefundPhase = typeof WP4_PAYUNI_REFUND_PHASES[number];

export type Wp4PayUniRefundCandidate = {
  vendorId: string;
  providerName: string;
  grossAmountCents: number;
  refundedAmountCents: number;
  gatewayFeeCents: number;
  platformFeeCents: number;
  status: string;
  metadata: unknown;
};

export type Wp4PayUniFixedRefund = {
  purpose: Wp4PayUniPurpose;
  phase: Wp4PayUniRefundPhase;
  refundAmountCents: number;
  gatewayFeeRefundCents: 0;
  platformFeeRefundCents: 0;
};

function safeNonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Derives one server-owned refund operation for the deterministic WP4 fixture.
 * The operation is deliberately independent of request input: callers must
 * first load a candidate from the database, then pass it through this narrow
 * selector before the shared PayUni refund core may be invoked.
 */
export function selectWp4PayUniFixedRefund(
  candidate: Wp4PayUniRefundCandidate,
  phase: Wp4PayUniRefundPhase,
): Wp4PayUniFixedRefund | null {
  if (!WP4_PAYUNI_REFUND_PHASES.includes(phase)) return null;
  if (!isWp4PayUniSandboxTransaction(candidate)) return null;
  if (!safeNonNegativeInteger(candidate.refundedAmountCents)
    || !safeNonNegativeInteger(candidate.gatewayFeeCents)
    || !safeNonNegativeInteger(candidate.platformFeeCents)
    || candidate.refundedAmountCents > candidate.grossAmountCents) return null;

  const purpose = wp4PayUniPurposeFromMetadata(candidate.metadata);
  if (!purpose) return null;
  const remainingCents = candidate.grossAmountCents - candidate.refundedAmountCents;
  if (!Number.isSafeInteger(remainingCents) || remainingCents <= 0) return null;

  if (phase === "partial") {
    // A partial refund must leave a positive, server-derived remainder for the
    // distinct remaining/full-refund phase. One-cent fixtures fail closed.
    if (candidate.status !== "paid" || candidate.refundedAmountCents !== 0 || remainingCents < 2) return null;
    const refundAmountCents = Math.floor(remainingCents / 2);
    if (refundAmountCents <= 0 || refundAmountCents >= remainingCents) return null;
    return { purpose, phase, refundAmountCents, gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 };
  }

  if (candidate.status !== "partially_refunded" || candidate.refundedAmountCents <= 0) return null;
  return { purpose, phase, refundAmountCents: remainingCents, gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 };
}
