import type { PaymentTransaction, Product, Vendor } from "@prisma/client";
import type { PaymentWebhookPayloadInput } from "@/lib/payment-webhooks";

export type ProviderNormalizeResult = {
  payload: PaymentWebhookPayloadInput;
  rawPayload: unknown;
};

export type CheckoutSessionInput = {
  transaction: PaymentTransaction;
  product: Product;
  vendor: Vendor;
  referralCode?: string;
  appUrl: string;
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

/** Safe-to-log categories only. Never attach provider payloads, URLs or secrets. */
export type RefundFailureCategory = "authentication" | "request_contract" | "provider_response" | "network" | "unknown";

export class RefundProviderError extends Error {
  constructor(public readonly category: RefundFailureCategory) {
    super("Payment provider refund failed.");
  }
}

export type PaymentProviderAdapter = {
  id: string;
  verifySignature(request: Request, rawBody: string): Promise<boolean>;
  normalizePayload(rawBody: string): Promise<ProviderNormalizeResult>;
  createCheckoutSession?(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  refundPayment?(input: RefundPaymentInput): Promise<RefundPaymentResult>;
};
