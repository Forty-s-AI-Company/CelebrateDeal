import { demoPaymentProvider } from "@/lib/payment-providers/demo";
import { ecpayPaymentProvider } from "@/lib/payment-providers/ecpay";
import { payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import { stripePaymentProvider } from "@/lib/payment-providers/stripe";
import type { PaymentProviderAdapter } from "@/lib/payment-providers/types";

const providers: Record<string, PaymentProviderAdapter> = {
  demo: demoPaymentProvider,
  payuni: payUniPaymentProvider,
  ecpay: ecpayPaymentProvider,
  stripe: stripePaymentProvider,
  "platform-ecpay": ecpayPaymentProvider,
  "ecpay-like": ecpayPaymentProvider,
};

export function getPaymentProvider(providerId: string | null) {
  const provider = providerId && providerId.trim() ? providers[providerId] : undefined;
  if (!provider) {
    throw new Error("Unsupported payment provider");
  }
  return provider;
}

export type { PaymentProviderAdapter };
