export type PaymentWebhookFailureCode =
  | "scope_missing"
  | "scope_invalid"
  | "scope_mismatch"
  | "order_ambiguous"
  | "amount_mismatch"
  | "inventory_conflict"
  | "processing_failed";

const KNOWN_FAILURES = new Map<string, PaymentWebhookFailureCode>([
  ["付款 webhook 缺少商家識別（vendorId 或 vendorSlug）。", "scope_missing"],
  ["付款 webhook 缺少商家識別，且找不到對應的既存結帳交易。", "scope_missing"],
  ["付款 webhook 商家識別無效：vendorId 或 vendorSlug 找不到對應商家。", "scope_invalid"],
  ["找不到 webhook 對應商家。", "scope_invalid"],
  ["付款 webhook 商家識別不一致：vendorId 與 vendorSlug 必須對應同一商家。", "scope_mismatch"],
  ["付款 webhook 訂單識別不唯一，拒絕自動歸屬商家。", "order_ambiguous"],
  ["付款 webhook 訂單金額或幣別與既存交易不一致。", "amount_mismatch"],
  ["Serializable inventory transaction attempts exhausted.", "inventory_conflict"],
  ["Inventory reservation tenant mismatch.", "inventory_conflict"],
  ["Inventory reservation product mismatch.", "inventory_conflict"],
  ["Inventory reservation changed concurrently.", "inventory_conflict"],
]);

/**
 * Webhook failures cross an unauthenticated provider boundary and are also shown
 * in the finance console. Only explicitly reviewed messages may become a stable
 * operator-facing code; every other exception is reduced to a generic category.
 */
export function classifyPaymentWebhookFailure(error: unknown): PaymentWebhookFailureCode {
  if (!(error instanceof Error)) return "processing_failed";
  return KNOWN_FAILURES.get(error.message) ?? "processing_failed";
}

export function paymentWebhookFailureMessage(code: PaymentWebhookFailureCode) {
  return `Payment webhook processing failed (${code}).`;
}
