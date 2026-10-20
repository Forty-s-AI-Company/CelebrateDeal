type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * F-003 / B01-03: PayUni is the only provider that moves real money. Its
 * refunds call the provider; every other provider would only write local
 * ledger rows. A production deployment therefore accepts no other provider
 * for checkout, callbacks or refunds. Demo and the ECPay-like adapter remain
 * available to local, test, CI and Preview runtimes.
 *
 * Production means the Vercel production deployment. `next start` with
 * NODE_ENV=production (local e2e, controlled CI builds) is not production.
 */
export const PRODUCTION_PAYMENT_PROVIDER = "payuni";

export function isProductionDeployment(env: RuntimeEnvironment = process.env) {
  return env.VERCEL_ENV === "production";
}

export function paymentProviderAllowedInRuntime(providerId: string | null | undefined, env: RuntimeEnvironment = process.env) {
  return !isProductionDeployment(env) || providerId === PRODUCTION_PAYMENT_PROVIDER;
}

export class PaymentProviderNotAllowedError extends Error {
  constructor() {
    super("Payment provider is not allowed in production");
    this.name = "PaymentProviderNotAllowedError";
  }
}
