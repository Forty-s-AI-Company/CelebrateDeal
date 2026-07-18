import { demoPaymentProvider } from "@/lib/payment-providers/demo";
import { ecpayLikePaymentProvider } from "@/lib/payment-providers/ecpay-like";
import { payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import type { PaymentProviderAdapter } from "@/lib/payment-providers/types";

const providers: Record<string, PaymentProviderAdapter> = {
  demo: demoPaymentProvider,
  payuni: payUniPaymentProvider,
  "platform-ecpay": ecpayLikePaymentProvider,
  "ecpay-like": ecpayLikePaymentProvider,
};

export function getPaymentProvider(providerId: string | null) {
  const provider = providerId && providerId.trim() ? providers[providerId] : undefined;
  if (!provider) {
    throw new Error("Unsupported payment provider");
  }
  return provider;
}

export type { PaymentProviderAdapter };
