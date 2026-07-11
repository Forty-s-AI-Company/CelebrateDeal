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

export class UnsupportedPaymentProviderError extends Error {
  constructor(providerId: string | null | undefined, reason = "unsupported") {
    super(`Payment provider rejected: ${providerId?.trim() || "missing"} (${reason})`);
    this.name = "UnsupportedPaymentProviderError";
  }
}

export function getPaymentProvider(providerId: string | null | undefined) {
  const normalizedProviderId = providerId?.trim().toLowerCase();
  if (!normalizedProviderId) {
    throw new UnsupportedPaymentProviderError(providerId, "missing");
  }

  const provider = providers[normalizedProviderId];
  if (!provider) {
    throw new UnsupportedPaymentProviderError(providerId);
  }

  if (provider.id === "demo" && process.env.NODE_ENV === "production") {
    throw new UnsupportedPaymentProviderError(providerId, "demo_disabled_in_production");
  }

  return provider;
}

export type { PaymentProviderAdapter };
