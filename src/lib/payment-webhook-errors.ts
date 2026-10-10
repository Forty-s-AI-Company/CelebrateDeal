export type PaymentWebhookFailureCode =
  | "scope_missing"
  | "scope_invalid"
  | "scope_mismatch"
  | "order_ambiguous"
  | "amount_mismatch"
  | "inventory_conflict"
  | "processing_timeout"
  | "processing_claim_lost"
  | "processing_failed";

const KNOWN_FAILURES = new Map<string, PaymentWebhookFailureCode>([
  ["付款 webhook 缺少商家識別（vendorId 或 vendorSlug）。", "scope_missing"],
  ["付款 webhook 缺少商家識別，且找不到對應的既存結帳交易。", "scope_missing"],
  ["付款 webhook 商家識別無效：vendorId 或 vendorSlug 找不到對應商家。", "scope_invalid"],
  ["找不到 webhook 對應商家。", "scope_invalid"],
  ["付款 webhook 商家識別不一致：vendorId 與 vendorSlug 必須對應同一商家。", "scope_mismatch"],
  ["Recovery payment identity changed before processing.", "scope_mismatch"],
  ["Recovery webhook tenant does not match the reserved payment.", "scope_mismatch"],
  ["付款 webhook 訂單識別不唯一，拒絕自動歸屬商家。", "order_ambiguous"],
  ["付款 webhook 訂單金額或幣別與既存交易不一致。", "amount_mismatch"],
  ["付款 webhook 訂單金額與既存交易不一致。", "amount_mismatch"],
  ["付款 webhook 訂單幣別與既存交易不一致。", "amount_mismatch"],
  ["Serializable inventory transaction attempts exhausted.", "inventory_conflict"],
  ["Inventory reservation tenant mismatch.", "inventory_conflict"],
  ["Inventory reservation product mismatch.", "inventory_conflict"],
  ["Inventory reservation changed concurrently.", "inventory_conflict"],
  ["Inventory reservation item snapshot is invalid.", "inventory_conflict"],
  ["付款 webhook 事件處理權已變更。", "processing_claim_lost"],
]);

const ERROR_CLASSES = new Set([
  "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError",
  "PrismaClientInitializationError", "PrismaClientValidationError",
  "CommerceOrderValidationError", "CommerceOrderConflictError",
  "CommerceOrderPiiValidationError", "MerchantAffiliatePolicyConflict", "ZodError",
] as const);

type ReviewedErrorClass = typeof ERROR_CLASSES extends Set<infer T> ? T : never;
export type PaymentWebhookErrorClass = ReviewedErrorClass | `P20${number}`
  | "SENSITIVE_KEY_MISSING" | "SENSITIVE_KEY_TOO_SHORT" | "SENSITIVE_ENVELOPE_INVALID"
  | "SENSITIVE_ENVELOPE_AUTH_FAILED" | "OTHER";

const CRYPTO_ERROR_CLASSES = new Map<string, PaymentWebhookErrorClass>([
  ["Sensitive data encryption key is not configured.", "SENSITIVE_KEY_MISSING"],
  ["Sensitive data encryption key is too short.", "SENSITIVE_KEY_TOO_SHORT"],
  ["Invalid sensitive data envelope.", "SENSITIVE_ENVELOPE_INVALID"],
  ["Unsupported state or unable to authenticate data", "SENSITIVE_ENVELOPE_AUTH_FAILED"],
]);

export const PAYMENT_WEBHOOK_STAGES = ["PAYMENT_UPDATE", "INVENTORY", "ORDER_TRANSITION",
  "PAID_DELIVERY_DECRYPT", "PAID_DELIVERY_PROTECT", "PAID_DELIVERY_PERSIST", "REFUND",
  "INVOICE", "SUBSCRIPTION", "COURSE", "MERCHANT_AFFILIATE", "LEGACY_COMMISSION",
  "DISPUTE", "TEAM_ATTRIBUTION", "PLATFORM_REFERRAL", "CLICK_CONVERSION", "EVENT_FINALIZE", "UNKNOWN"] as const;
export type PaymentWebhookStage = typeof PAYMENT_WEBHOOK_STAGES[number];
const stages = new WeakMap<Error, PaymentWebhookStage>();
const causes = new WeakMap<Error, PaymentWebhookErrorClass>();

/** Preserve the original exception and its inner stage without adding raw context. */
export function tagPaymentWebhookStage(error: unknown, stage: PaymentWebhookStage) {
  if (error instanceof Error && !stages.has(error) && PAYMENT_WEBHOOK_STAGES.includes(stage)) stages.set(error, stage);
}
export function paymentWebhookErrorStage(error: unknown): PaymentWebhookStage {
  return error instanceof Error ? stages.get(error) ?? "UNKNOWN" : "UNKNOWN";
}
/** Annotate a stage without changing the thrown value or transaction outcome. */
export async function withPaymentWebhookStage<T>(stage: PaymentWebhookStage, action: () => T | Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) { tagPaymentWebhookStage(error, stage); throw error; }
}
/** Keep only the closed cause class; monitoring cannot serialize WeakMap data. */
export function retainPaymentWebhookCause(wrapper: Error, cause: unknown) {
  causes.set(wrapper, classifyPaymentWebhookErrorClass(cause));
  return wrapper;
}

/** Only closed classes and bounded Prisma codes cross the audit boundary.
 * Never persist exception messages, arbitrary names or Prisma metadata. */
export function classifyPaymentWebhookErrorClass(error: unknown): PaymentWebhookErrorClass {
  if (!(error instanceof Error)) return "OTHER";
  const retained = causes.get(error);
  if (retained) return retained;
  const cryptoClass = CRYPTO_ERROR_CLASSES.get(error.message);
  if (cryptoClass) return cryptoClass;
  if (error.name === "PrismaClientKnownRequestError" && "code" in error
    && typeof error.code === "string" && /^P20\d{2}$/u.test(error.code)) {
    return error.code as `P20${number}`;
  }
  return ERROR_CLASSES.has(error.name as ReviewedErrorClass) ? error.name as ReviewedErrorClass : "OTHER";
}

/**
 * Webhook failures cross an unauthenticated provider boundary and are also shown
 * in the finance console. Only explicitly reviewed messages may become a stable
 * operator-facing code; every other exception is reduced to a generic category.
 */
export function classifyPaymentWebhookFailure(error: unknown): PaymentWebhookFailureCode {
  if (!(error instanceof Error)) return "processing_failed";
  if (
    ("code" in error && error.code === "P2028")
    || error.message.includes("Transaction already closed")
  ) return "processing_timeout";
  return KNOWN_FAILURES.get(error.message) ?? "processing_failed";
}

export function paymentWebhookFailureMessage(code: PaymentWebhookFailureCode) {
  return `Payment webhook processing failed (${code}).`;
}
