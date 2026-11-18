import { demoPaymentProvider } from "@/lib/payment-providers/demo";
import { ecpayLikePaymentProvider } from "@/lib/payment-providers/ecpay-like";
import { payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import { PaymentProviderNotAllowedError, paymentProviderAllowedInRuntime } from "@/lib/payment-providers/runtime-policy";
import type { PaymentProviderAdapter } from "@/lib/payment-providers/types";

const providers: Record<string, PaymentProviderAdapter> = {
  demo: demoPaymentProvider,
  payuni: payUniPaymentProvider,
  "platform-ecpay": ecpayLikePaymentProvider,
  "ecpay-like": ecpayLikePaymentProvider,
};

/** F-003: a production deployment resolves only PayUni (runtime-policy.ts). */
export function getPaymentProvider(providerId: string | null, env: Readonly<Record<string, string | undefined>> = process.env) {
  // Own keys only: `providers["constructor"]` or `providers["__proto__"]` would
  // otherwise resolve to Object.prototype members (#652 review NIT).
  const provider = providerId && providerId.trim() && Object.hasOwn(providers, providerId) ? providers[providerId] : undefined;
  if (!provider) {
    throw new Error("Unsupported payment provider");
  }
  if (!paymentProviderAllowedInRuntime(providerId, env)) throw new PaymentProviderNotAllowedError();
  return provider;
}

export type { PaymentProviderAdapter };
