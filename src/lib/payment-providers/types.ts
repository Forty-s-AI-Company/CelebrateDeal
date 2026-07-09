import type { PaymentWebhookPayloadInput } from "@/lib/payment-webhooks";

export type ProviderNormalizeResult = {
  payload: PaymentWebhookPayloadInput;
  rawPayload: unknown;
};

export type PaymentProviderAdapter = {
  id: string;
  verifySignature(request: Request, rawBody: string): Promise<boolean>;
  normalizePayload(rawBody: string): Promise<ProviderNormalizeResult>;
};
