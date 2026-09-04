import type { BillingPlan, PaymentTransaction, Product, Vendor } from "@prisma/client";
import type { PaymentWebhookPayloadInput } from "@/lib/payment-webhooks";
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
  /** Server-validated payer origin; notification delivery stays canonical. */
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

/** Safe-to-log categories only. Never attach provider payloads, URLs or secrets. */
export type RefundFailureCategory = "authentication" | "request_contract" | "provider_response" | "network" | "unknown";

export class RefundProviderError extends Error {
  constructor(public readonly category: RefundFailureCategory) {
    super("Payment provider refund failed.");
  }
}

export type PaymentQueryFailureCategory = "authentication" | "request_contract" | "provider_response" | "network" | "unknown";

export class PaymentQueryProviderError extends Error {
  constructor(public readonly category: PaymentQueryFailureCategory) {
    super("Payment provider query failed.");
  }
}

export type PaymentProviderAdapter = {
  id: string;
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
};
