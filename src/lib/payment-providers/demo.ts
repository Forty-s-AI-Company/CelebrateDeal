import { PaymentWebhookPayload } from "@/lib/payment-providers/contract";
import type { PaymentProviderAdapter } from "@/lib/payment-providers/types";

export const demoPaymentProvider: PaymentProviderAdapter = {
  id: "demo",
  checkoutSessionPreparation: "local",
  checkoutReadiness() {
    return "local_only";
  },
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
    // `provider` goes after the spread so a body field cannot claim another
    // provider (#652 review MINOR-4): the payload always names this adapter.
    const payload = PaymentWebhookPayload.parse({
      ...rawPayload,
      provider: "demo",
    });
    return { payload, rawPayload };
  },
};
