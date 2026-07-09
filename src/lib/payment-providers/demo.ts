import { PaymentWebhookPayload } from "@/lib/payment-webhooks";
import type { PaymentProviderAdapter } from "@/lib/payment-providers/types";

export const demoPaymentProvider: PaymentProviderAdapter = {
  id: "demo",
  async verifySignature() {
    return true;
  },
  async normalizePayload(rawBody) {
    const rawPayload = JSON.parse(rawBody);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      ...rawPayload,
    });
    return { payload, rawPayload };
  },
};
