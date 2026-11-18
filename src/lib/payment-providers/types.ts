import type { BillingPlan, PaymentTransaction, Product, Vendor } from "@prisma/client";
import type { PaymentWebhookPayloadInput } from "@/lib/payment-providers/contract";
import type { PaymentMethodSetupVerificationInput } from "@/lib/payment-method-reference";

export type ProviderNormalizeResult = {
  payload: PaymentWebhookPayloadInput;
  rawPayload: unknown;
};

export type CheckoutSessionInput = {
  transaction: PaymentTransaction;
  /** Existing product checkout keeps using the product display name. */
  product?: Product;
  /** Platform plan checkout uses the server-read billing plan instead. */
  billingPlan?: BillingPlan;
  /** Invoice checkout uses a server-selected, non-user-controlled description. */
  description?: string;
  vendor: Vendor;
  referralCode?: string;
  appUrl: string;
  /** Browser return origin; NotifyURL remains pinned to the canonical appUrl. */
  returnAppUrl?: string;
};

export type CheckoutSessionResult = {
  provider: string;
  mode: "redirect" | "form_post" | "manual";
  checkoutUrl: string | null;
  formAction?: string;
  formMethod?: "POST";
  formPayload?: Record<string, string>;
  nextAction: string;
  externalRequired?: boolean;
};

export type CheckoutProviderReadiness = "ready" | "local_only" | "unavailable";

export function checkoutReadinessAllowsNewTransaction(
  readiness: CheckoutProviderReadiness,
  runtimeEnvironment = process.env.NODE_ENV,
  explicitLocalE2eRuntime = false,
) {
  return readiness === "ready" || (
    readiness === "local_only"
    && (runtimeEnvironment !== "production" || explicitLocalE2eRuntime)
  );
}

function isHttpDestination(value: string | null | undefined) {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function checkoutSessionHasUsableDestination(
  session: CheckoutSessionResult,
  readiness: CheckoutProviderReadiness,
) {
  if (readiness === "unavailable") return false;
  if (readiness === "local_only" && session.mode === "manual") return true;
  if (session.mode === "redirect") return isHttpDestination(session.checkoutUrl);
  return session.mode === "form_post"
    && isHttpDestination(session.formAction)
    && session.formMethod === "POST"
    && Boolean(session.formPayload && Object.keys(session.formPayload).length > 0);
}

export type PaymentMethodSetupSessionInput = {
  /** Opaque values the provider must echo in its signed setup callback. */
  intentId: string;
  setupNonce: string;
  vendor: Vendor;
  scopeType: "VENDOR" | "MEMBERSHIP";
  teamId?: string;
  membershipId?: string;
  appUrl: string;
  returnPath: string;
};

export type PaymentMethodSetupSessionResult = {
  provider: string;
  mode: "redirect" | "form_post" | "manual";
  setupUrl: string | null;
  formAction?: string;
  formMethod?: "POST";
  formPayload?: Record<string, string>;
  nextAction: string;
  externalRequired?: boolean;
};

export type PaymentMethodReferenceRevocationInput = {
  /** Opaque provider token kept server-side; never expose it to the client. */
  providerPaymentMethodRef: string;
  providerCustomerRef?: string | null;
};

export type PaymentMethodReferenceRevocationResult = {
  providerEventId?: string;
};

export type RefundPaymentInput = {
  transaction: PaymentTransaction;
  refundAmountCents: number;
  /**
   * CelebrateDeal-generated reference used to reserve the local refund before
   * calling a provider. It must never be derived from a card or secret.
   */
  requestId: string;
};

export type RefundPaymentResult = {
  /** Provider-side reference, if the provider returns one. */
  providerEventId?: string;
};

export type QueryPaymentInput = {
  transaction: PaymentTransaction;
};

/**
 * A provider query is deliberately reduced to the fields needed to reconcile
 * a previously accepted refund.  Raw provider rows, card data and encrypted
 * envelopes must never cross this boundary.
 */
export type PaymentQueryResult = {
  providerTradeNo: string;
  orderNumber: string;
  grossAmountCents: number;
  refundedAmountCents: number;
  remainingRefundableAmountCents: number;
  status: "paid" | "partially_refunded" | "refunded";
};

export type PendingPaymentQueryInput = {
  /** Server-owned checkout row; only these fields cross the adapter boundary. */
  transaction: Pick<PaymentTransaction, "providerName" | "orderNumber" | "paymentMode" | "grossAmountCents" | "currency">;
  /** Network timeout for the read-only query; defaults to the provider transport's own limit. */
  timeoutMs?: number;
};

/** Reasons a provider query reports something the reconciler must not apply automatically. */
export type PendingPaymentManualReason =
  /** TradeStatus 1 collected by a payment method outside the allowlist (R448-01). */
  | "payment_type_not_allowed"
  /** A well-formed TradeStatus outside the documented tables. */
  | "trade_status_unknown"
  /** The provider reports a refund on an order this system never recorded as paid. */
  | "refunded_at_provider"
  /** A paid card trade whose capture was cancelled (CloseStatus 3 請款取消). */
  | "capture_cancelled"
  /** A paid card trade with a CloseStatus outside the documented query table. */
  | "close_status_unknown"
  /** More than one provider trade for the same merchant order number. */
  | "multiple_trades";

/**
 * A-2 05: authenticated query result for a still-pending checkout. Only bounded
 * identifiers and an allowlisted snapshot cross this boundary. `paid` and
 * `failed` carry the same normalized payload (provider, eventId, eventType) a
 * callback for that trade state would produce, so the webhook engine treats
 * both paths as one provider event. Errors are thrown as PaymentQueryProviderError.
 */
export type PendingPaymentQueryResult =
  | {
    outcome: "paid";
    orderNumber: string;
    providerTradeNo: string;
    /** Signed TradeAmt; the caller must still compare it with the server record. */
    grossAmountCents: number;
    payload: PaymentWebhookPayloadInput;
    rawSnapshot: Record<string, string | number | boolean>;
  }
  | {
    outcome: "failed";
    orderNumber: string;
    providerTradeNo?: string;
    tradeStatus: string;
    payload: PaymentWebhookPayloadInput;
    rawSnapshot: Record<string, string | number | boolean>;
  }
  /** Signed TradeStatus 4 (query table "expired"): no money was received; nothing to apply. */
  | { outcome: "expired"; orderNumber: string; providerTradeNo?: string; tradeStatus: string }
  /** Issued, awaiting confirmation, unpaid, or incomplete data (DataSource B): ask again later. */
  | { outcome: "pending"; orderNumber: string; providerTradeNo?: string; tradeStatus?: string }
  /** Authenticated QUERY03001: the provider has no trade for this order number. */
  | { outcome: "not_found"; orderNumber: string }
  | {
    outcome: "manual_reconciliation";
    reason: PendingPaymentManualReason;
    /**
     * The provider reported a collection (some trade has TradeStatus 1), so money
     * may be captured and the pending payment must be held from expiry.
     */
    collectionReported: boolean;
    orderNumber: string;
    providerTradeNo?: string;
    tradeStatus?: string;
    paymentType?: string;
    rawSnapshot: Record<string, string | number | boolean>;
  };

/** Safe-to-log categories only. Never attach provider payloads, URLs or secrets. */
export type RefundFailureCategory = "authentication" | "request_contract" | "provider_response" | "network" | "unknown";

export class RefundProviderError extends Error {
  constructor(public readonly category: RefundFailureCategory) {
    super("Payment provider refund failed.");
  }
}

/** `manual_reconciliation`: the provider reports a completed collection by a payment method this system does not apply automatically. */
export type PaymentQueryFailureCategory = "authentication" | "request_contract" | "provider_response" | "network" | "unknown" | "manual_reconciliation";

export class PaymentQueryProviderError extends Error {
  constructor(public readonly category: PaymentQueryFailureCategory) {
    super("Payment provider query failed.");
  }
}

/**
 * Provider status codes from the signed part of a setup result. Every value is
 * a bounded provider code or fixed enum; never card data, tokens or free text.
 * Unsigned envelope fields are never copied; `outerStatusMismatch` only says
 * that the unauthenticated outer status disagreed with the signed one.
 */
export type PaymentMethodSetupProviderDiagnostics = {
  status?: string;
  messageCode?: string;
  tradeStatus?: string;
  resCode?: string;
  outerStatusMismatch?: boolean;
};

/** "declined": the provider did not bind a card. "pending": the provider has not decided yet. */
export type PaymentMethodSetupProviderOutcome = "declined" | "pending";

/**
 * Thrown by `normalizePaymentMethodSetupPayload` only after the callback is
 * authenticated and the signed provider fields report a non-successful result.
 */
export class PaymentMethodSetupProviderResultError extends Error {
  constructor(
    public readonly outcome: PaymentMethodSetupProviderOutcome,
    public readonly diagnostics: PaymentMethodSetupProviderDiagnostics,
    /** Opaque digest of signed identity fields; replays of the same result share it. */
    public readonly resultKey: string,
    /** Server-owned intent scope, present only for a still-pending, unexpired stored intent. */
    public readonly scope: { setupIntentId: string; vendorId: string } | null = null,
  ) {
    super("Payment provider did not complete payment method setup.");
    this.name = "PaymentMethodSetupProviderResultError";
  }
}

/**
 * Thrown by `normalizePaymentMethodSetupPayload` for an authenticated payload
 * that breaks the setup contract. `resultKey` is an opaque digest of the signed
 * content so replays can be de-duplicated without storing the payload.
 */
export class PaymentMethodSetupMalformedPayloadError extends Error {
  constructor(public readonly resultKey: string) {
    super("Payment method setup payload is malformed.");
    this.name = "PaymentMethodSetupMalformedPayloadError";
  }
}

/**
 * An authenticated payment callback that must not change payment state
 * automatically: a pending provider state (for example a number issued but not
 * yet paid), a payment method outside the allowlist, or a provider status that
 * is not a final success.
 */
export type PaymentWebhookNotActionableReason = "trade_pending" | "payment_type_not_allowed" | "provider_status_not_success"
  /** Signed result is a paid card trade; only the unsigned outer Status disagrees. */
  | "outer_status_mismatch"
  /** Signed, well-formed TradeStatus outside the documented UPP table (for example 4); neither paid nor failed. */
  | "trade_status_unknown"
  /**
   * Signed TradeStatus 4: "expired" in the trade query table, not in the UPP
   * table. No money was received, so it is recorded without holding the
   * pending payment; stock is released on the normal reservation expiry (RR-03).
   */
  | "trade_expired"
  /** Signed refund notice without a provider refund serial (CloseNo/RefundNo); never applied automatically. */
  | "refund_reference_missing";

/** Bounded provider identifiers only (order/trade numbers and status codes), never PII or card data. */
export type PaymentWebhookCallbackIdentifiers = {
  orderNumber?: string;
  providerTradeNo?: string;
  tradeStatus?: string;
  paymentType?: string;
};

const PAYMENT_WEBHOOK_IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;

function boundedIdentifier(value: string | undefined) {
  // Same card-number guard as the provider diagnostics: never keep a 12-19 digit run.
  return value !== undefined && PAYMENT_WEBHOOK_IDENTIFIER.test(value) && !/[0-9]{12,19}/.test(value) ? value : undefined;
}

export class PaymentWebhookNotActionableError extends Error {
  readonly identifiers: PaymentWebhookCallbackIdentifiers;

  constructor(
    public readonly reason: PaymentWebhookNotActionableReason,
    identifiers: PaymentWebhookCallbackIdentifiers = {},
    /** Allowlisted, size-bounded provider snapshot for the reconciliation record. */
    public readonly rawSnapshot?: Record<string, string | number | boolean>,
  ) {
    super("Payment webhook is not actionable.");
    this.name = "PaymentWebhookNotActionableError";
    this.identifiers = Object.fromEntries(Object.entries({
      orderNumber: boundedIdentifier(identifiers.orderNumber),
      providerTradeNo: boundedIdentifier(identifiers.providerTradeNo),
      tradeStatus: boundedIdentifier(identifiers.tradeStatus),
      paymentType: boundedIdentifier(identifiers.paymentType),
    }).filter(([, value]) => value !== undefined)) as PaymentWebhookCallbackIdentifiers;
  }

  /**
   * The provider reported a completed collection (paid trade status), or a
   * trade state this system cannot map, that it refuses to apply
   * automatically. The money may already be captured,
   * so it must be recorded for manual reconciliation, never silently dropped.
   */
  get requiresManualReconciliation() {
    return this.reason !== "trade_pending";
  }

  /**
   * Whether the matching pending payment is held from inventory expiry while
   * finance reconciles. An expired trade (TradeStatus 4) received no money, so
   * it is recorded and alerted at warning level but never holds stock (RR-03).
   */
  get holdsPaymentForReconciliation() {
    return this.requiresManualReconciliation && this.reason !== "trade_expired";
  }
}

export type PaymentProviderAdapter = {
  id: string;
  /** Session preparation is pure local work; no remote trade is created. */
  checkoutSessionPreparation?: "local";
  /** Runtime capability check. It must never return configuration values or secret material. */
  checkoutReadiness(): CheckoutProviderReadiness;
  verifySignature(request: Request, rawBody: string): Promise<boolean>;
  normalizePayload(rawBody: string): Promise<ProviderNormalizeResult>;
  createCheckoutSession?(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  createPaymentMethodSetupSession?(input: PaymentMethodSetupSessionInput): Promise<PaymentMethodSetupSessionResult>;
  /** Verifies and reduces a signed provider setup callback without exposing raw payloads. */
  verifyPaymentMethodSetupSignature?(request: Request, rawBody: string): Promise<boolean>;
  normalizePaymentMethodSetupPayload?(rawBody: string): Promise<PaymentMethodSetupVerificationInput>;
  /** Revokes a provider-side opaque payment method token without exposing token data. */
  revokePaymentMethodReference?(input: PaymentMethodReferenceRevocationInput): Promise<PaymentMethodReferenceRevocationResult>;
  refundPayment?(input: RefundPaymentInput): Promise<RefundPaymentResult>;
  queryPayment?(input: QueryPaymentInput): Promise<PaymentQueryResult>;
  /** A-2 05: read-only status of a checkout whose callback never arrived (by merchant order number only). */
  queryPendingPayment?(input: PendingPaymentQueryInput): Promise<PendingPaymentQueryResult>;
  /** Preview Sandbox observation only. Null is authenticated not-found, not a terminal payment state. */
  queryUnreferencedSandboxPayment?(input: QueryPaymentInput): Promise<PaymentQueryResult | null>;
};
