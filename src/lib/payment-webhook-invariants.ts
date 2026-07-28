export type PaymentWebhookEventType = "paid" | "refunded" | "partially_refunded" | "failed"
  | "dispute_opened" | "dispute_released" | "dispute_lost";
export type DisputeWebhookEventType = Extract<PaymentWebhookEventType, `dispute_${string}`>;
export type PaymentLifecycleWebhookEventType = Exclude<PaymentWebhookEventType, DisputeWebhookEventType>;

type RefundSnapshot = {
  providerEventId: string | null;
  refundAmountCents: number;
};

export type ExistingPaymentSnapshot = {
  status: string;
  grossAmountCents: number;
  refundedAmountCents: number;
  currency: string;
  refunds: RefundSnapshot[];
};

type PaymentWebhookInvariantInput = {
  eventId: string;
  eventType: PaymentWebhookEventType;
  grossAmountCents?: number;
  refundAmountCents: number;
  currency?: string;
};

export type PaymentWebhookInvariantResult = {
  duplicateRefundEvent: boolean;
  remainingRefundableCents: number;
};

const REFUND_EVENT_TYPES = new Set<PaymentWebhookEventType>(["refunded", "partially_refunded"]);
const DISPUTE_EVENT_TYPES = new Set<PaymentWebhookEventType>(["dispute_opened", "dispute_released", "dispute_lost"]);
const REFUNDABLE_STATUSES = new Set(["paid", "partially_refunded"]);

export function isRefundEvent(eventType: PaymentWebhookEventType) {
  return REFUND_EVENT_TYPES.has(eventType);
}

export function isDisputeEvent(eventType: PaymentWebhookEventType): eventType is DisputeWebhookEventType {
  return DISPUTE_EVENT_TYPES.has(eventType);
}

export function isPaymentLifecycleEvent(eventType: PaymentWebhookEventType): eventType is PaymentLifecycleWebhookEventType {
  return !isDisputeEvent(eventType);
}

export function validatePaymentWebhookInvariants(
  input: PaymentWebhookInvariantInput,
  existing: ExistingPaymentSnapshot | null,
): PaymentWebhookInvariantResult {
  if (!existing) {
    if (isRefundEvent(input.eventType) || isDisputeEvent(input.eventType)) {
      throw new Error("退款或 dispute webhook 找不到既存付款交易。");
    }
    return { duplicateRefundEvent: false, remainingRefundableCents: 0 };
  }

  if (input.grossAmountCents !== undefined && input.grossAmountCents !== existing.grossAmountCents) {
    throw new Error("付款 webhook 訂單金額與既存交易不一致。");
  }
  if (input.currency !== undefined && input.currency !== existing.currency) {
    throw new Error("付款 webhook 訂單幣別與既存交易不一致。");
  }

  const remainingRefundableCents = Math.max(0, existing.grossAmountCents - existing.refundedAmountCents);
  if (!isRefundEvent(input.eventType)) {
    return { duplicateRefundEvent: false, remainingRefundableCents };
  }

  const duplicateRefund = existing.refunds.find((refund) => refund.providerEventId === input.eventId);
  if (duplicateRefund) {
    if (duplicateRefund.refundAmountCents !== input.refundAmountCents) {
      throw new Error("退款 webhook 事件金額與既存退款紀錄不一致。");
    }
    return { duplicateRefundEvent: true, remainingRefundableCents };
  }

  if (!REFUNDABLE_STATUSES.has(existing.status)) {
    throw new Error("退款 webhook 的付款交易狀態不可退款。");
  }
  if (input.refundAmountCents <= 0 || input.refundAmountCents > remainingRefundableCents) {
    throw new Error("退款 webhook 金額超過剩餘可退款額度。");
  }
  if (input.eventType === "refunded" && input.refundAmountCents !== remainingRefundableCents) {
    throw new Error("全額退款 webhook 金額必須等於剩餘可退款額度。");
  }
  if (input.eventType === "partially_refunded" && input.refundAmountCents >= remainingRefundableCents) {
    throw new Error("部分退款 webhook 不得耗盡剩餘可退款額度。");
  }

  return { duplicateRefundEvent: false, remainingRefundableCents };
}

export function resolvePaymentStatus(
  existingStatus: string | null,
  eventType: PaymentWebhookEventType,
) {
  if (!existingStatus || existingStatus === "pending") return eventType;

  if (isDisputeEvent(eventType)) return existingStatus;

  if (existingStatus === "refunded") return "refunded";
  if (existingStatus === "partially_refunded") {
    return eventType === "refunded" ? "refunded" : "partially_refunded";
  }
  if (existingStatus === "paid") {
    return isRefundEvent(eventType) ? eventType : "paid";
  }
  if (existingStatus === "failed") {
    return eventType === "paid" ? "paid" : "failed";
  }
  if (existingStatus === "expired") {
    return eventType === "paid" ? "paid" : "expired";
  }

  throw new Error("付款 webhook 遇到不支援的交易狀態。");
}
