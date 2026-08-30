/**
 * Provider-net reference is display-only. It must never alter the gross
 * commission base or the immutable payout ledger.
 */
export function calculateNetReferenceAmountCents(input: {
  netAmountCents: number;
  refundedAmountCents: number;
  gatewayFeeRefundCents: number;
  platformFeeRefundCents: number;
}) {
  return Math.max(
    0,
    input.netAmountCents
      - input.refundedAmountCents
      + input.gatewayFeeRefundCents
      + input.platformFeeRefundCents,
  );
}
