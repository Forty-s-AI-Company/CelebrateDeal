export const COMMERCE_ORDER_STATUSES = [
  "draft",
  "pending_payment",
  "paid",
  "payment_failed",
  "expired",
  "cancelled",
  "partially_refunded",
  "refunded",
] as const;

export type CommerceOrderStatus = (typeof COMMERCE_ORDER_STATUSES)[number];
export type CommerceFulfillmentType = "physical" | "digital" | "service" | "course";
export type ShippingFulfillmentStatus =
  | "pending"
  | "packing"
  | "shipped"
  | "refund_review"
  | "delivered"
  | "returned"
  | "cancelled";
export type CommerceEntitlementStatus = "pending" | "granted" | "revoked";
export type ServiceFulfillmentStatus = "pending" | "scheduling" | "scheduled" | "completed" | "cancelled";
export type PaidFulfillmentStatus = ShippingFulfillmentStatus | CommerceEntitlementStatus | ServiceFulfillmentStatus;

const allowedOrderTransitions: Readonly<Record<CommerceOrderStatus, readonly CommerceOrderStatus[]>> = {
  draft: ["draft", "pending_payment", "cancelled"],
  pending_payment: ["pending_payment", "paid", "payment_failed", "expired", "cancelled"],
  paid: ["paid", "partially_refunded", "refunded"],
  // Providers may confirm money after the browser-side attempt failed or the
  // local inventory window expired. A verified late payment must converge to
  // paid instead of leaving a paid customer without an order.
  payment_failed: ["payment_failed", "pending_payment", "paid", "cancelled"],
  expired: ["expired", "paid"],
  cancelled: ["cancelled"],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: ["refunded"],
};

/** Returns whether an idempotent order status transition is part of the canonical lifecycle. */
export function isValidCommerceOrderStatusTransition(
  from: CommerceOrderStatus,
  to: CommerceOrderStatus,
): boolean {
  return allowedOrderTransitions[from].includes(to);
}

/** Fails closed before a caller persists an invalid order lifecycle transition. */
export function assertValidCommerceOrderStatusTransition(
  from: CommerceOrderStatus,
  to: CommerceOrderStatus,
): void {
  if (!isValidCommerceOrderStatusTransition(from, to)) {
    throw new Error(`Invalid CommerceOrder status transition: ${from} -> ${to}.`);
  }
}

/**
 * Returns the first fulfillment state after a paid order is materialized.
 * Digital and course products are immediately available; physical and service
 * work remains pending until a later fulfillment action records progress.
 */
export function initialFulfillmentStatusForPaidOrder(
  fulfillmentType: CommerceFulfillmentType,
): PaidFulfillmentStatus {
  switch (fulfillmentType) {
    case "digital":
    case "course":
      return "granted";
    case "physical":
    case "service":
      return "pending";
  }
}

export interface RefundStatusInput {
  paidAmountCents: number;
  totalAmountCents: number;
  refundedAmountCents: number;
}

function assertNonNegativeSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer amount in cents.`);
  }
}

/**
 * Derives the persisted order status from the cumulative refund ledger total.
 * A refund can never exceed either the actual payment or the original order total.
 */
export function deriveRefundOrderStatus({
  paidAmountCents,
  totalAmountCents,
  refundedAmountCents,
}: RefundStatusInput): CommerceOrderStatus {
  assertNonNegativeSafeInteger("paidAmountCents", paidAmountCents);
  assertNonNegativeSafeInteger("totalAmountCents", totalAmountCents);
  assertNonNegativeSafeInteger("refundedAmountCents", refundedAmountCents);

  const refundableAmountCents = Math.min(paidAmountCents, totalAmountCents);
  if (refundedAmountCents > refundableAmountCents) {
    throw new Error("refundedAmountCents cannot exceed paidAmountCents or totalAmountCents.");
  }
  if (refundedAmountCents === 0) return "paid";
  return refundedAmountCents === refundableAmountCents ? "refunded" : "partially_refunded";
}
