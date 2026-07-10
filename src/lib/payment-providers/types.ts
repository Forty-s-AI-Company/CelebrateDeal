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

export type PaymentProviderAdapter = {
  id: string;
  verifySignature(request: Request, rawBody: string): Promise<boolean>;
  normalizePayload(rawBody: string): Promise<ProviderNormalizeResult>;
  createCheckoutSession?(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
};
