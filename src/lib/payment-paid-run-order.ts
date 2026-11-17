import type { Prisma } from "@prisma/client";

/**
 * Q-09: when the order behind a `payment_paid` delayed-step run still counts
 * as a purchase (docs/domain-workflows.md 「付款完成」→「延遲步驟」).
 *
 * Conservative rule: a partially refunded order goes on (the purchase still
 * stands), a fully refunded or cancelled one stops, and a test order never
 * counts. "Fully refunded" is read from the amounts as well as the status, so
 * an order still marked `paid` or `partially_refunded` whose refunds reached
 * the paid amount stops too. The amounts only decide this; nothing else reads
 * them.
 *
 * Used when the run is created (startDelayedSteps), when a step is due (the
 * worker, automation-delayed-steps.ts) and before a queued step e-mail is sent
 * (isCurrentAutomationStepEmailDelivery, delayed-step-runs.ts). Kept free of
 * other modules so the e-mail send path can import it without the automation
 * engine (design §8 point 12).
 */
export const PAYMENT_PAID_RUN_ORDER_STATUSES = ["paid", "partially_refunded"] as const;

export type PaymentPaidRunOrder = {
  status: string;
  isTestOrder: boolean;
  paidAmountCents: number;
  refundedAmountCents: number;
};

export function paymentPaidRunOrderCounts(order: PaymentPaidRunOrder | null | undefined): boolean {
  if (!order || order.isTestOrder) return false;
  if (!(PAYMENT_PAID_RUN_ORDER_STATUSES as readonly string[]).includes(order.status)) return false;
  return order.paidAmountCents > 0 && order.refundedAmountCents < order.paidAmountCents;
}

/** The order of a run, bound to the run's vendor (the composite foreign key binds it as well). */
export function paymentPaidRunOrderWhere(input: { vendorId: string; orderId: string }): Prisma.CommerceOrderWhereInput {
  return {
    id: input.orderId,
    vendorId: input.vendorId,
    isTestOrder: false,
    status: { in: [...PAYMENT_PAID_RUN_ORDER_STATUSES] },
  };
}

export const PAYMENT_PAID_RUN_ORDER_SELECT = {
  id: true,
  status: true,
  isTestOrder: true,
  paidAmountCents: true,
  refundedAmountCents: true,
} as const;
