export type PaymentWebhookEventType = "paid" | "refunded" | "partially_refunded" | "failed"
  | "dispute_opened" | "dispute_released" | "dispute_lost";
export type DisputeWebhookEventType = Extract<PaymentWebhookEventType, `dispute_${string}`>;
export type PaymentLifecycleWebhookEventType = Exclude<PaymentWebhookEventType, DisputeWebhookEventType>;

type RefundSnapshot = {
  providerEventId: string | null;
  refundAmountCents: number;
  status?: string;
};

export type ExistingPaymentSnapshot = {
  status: string;
  grossAmountCents: number;
  refundedAmountCents: number;
  currency: string;
  providerName?: string;
  providerTradeNo?: string | null;
  refunds: RefundSnapshot[];
};

/**
 * PayUni refunds started here store `CloseNo ?? RefundNo ?? TradeNo` as the
 * refund's provider event. A refund identified only by the trade number cannot
 * be told apart from another refund of the same trade, so a non-duplicate PayUni
 * refund is refused (manual reconciliation) whenever either side carries only the
 * trade number and another processed refund exists (PR #454 A-1).
 */
function hasAmbiguousPayUniRefundIdentity(input: PaymentWebhookInvariantInput, existing: ExistingPaymentSnapshot) {
  const tradeNo = existing.providerTradeNo;
  if (existing.providerName !== "payuni" || !tradeNo) return false;
  const processed = existing.refunds.filter((refund) => refund.status === undefined || refund.status === "processed");
  return processed.some((refund) => refund.providerEventId === tradeNo)
    || (input.eventId === tradeNo && processed.length > 0);
}

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

  if (existing.refunds.some((refund) => refund.status === "pending")) {
    throw new Error("付款交易仍有待處理退款。");
  }

  const duplicateRefund = existing.refunds.find((refund) => refund.providerEventId === input.eventId);
  if (duplicateRefund) {
    if (duplicateRefund.refundAmountCents !== input.refundAmountCents) {
      throw new Error("退款 webhook 事件金額與既存退款紀錄不一致。");
    }
    if (
      (existing.status === "partially_refunded" && input.eventType === "refunded")
      || (existing.status === "refunded" && input.eventType === "partially_refunded")
    ) {
      throw new Error("退款 webhook 事件類型與既存退款紀錄不一致。");
    }
    return { duplicateRefundEvent: true, remainingRefundableCents };
  }

  if (hasAmbiguousPayUniRefundIdentity(input, existing)) {
    throw new Error("退款 webhook 無法與只帶交易編號的既有退款區分，需人工對帳。");
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
