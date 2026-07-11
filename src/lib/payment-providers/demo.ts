import { PaymentWebhookPayload } from "@/lib/payment-webhooks";
import type { PaymentProviderAdapter } from "@/lib/payment-providers/types";

export const demoPaymentProvider: PaymentProviderAdapter = {
  id: "demo",
  async createCheckoutSession({ transaction }) {
    return {
      provider: "demo",
      mode: "manual",
      checkoutUrl: null,
      nextAction: "demo_checkout_transaction_created",
      formPayload: {
        orderNumber: transaction.orderNumber ?? transaction.id,
        transactionId: transaction.id,
      },
    };
  },
  async verifySignature() {
    return true;
  },
  async normalizePayload(rawBody) {
    const rawPayload = JSON.parse(rawBody);
    const payload = PaymentWebhookPayload.parse({
      ...rawPayload,
      provider: "demo",
    });
    return { payload, rawPayload };
  },
};
