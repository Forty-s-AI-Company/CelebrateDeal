type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * F-003 / B01-03: PayUni is the only provider that moves real money. Its
 * refunds call the provider; every other provider would only write local
 * ledger rows. A production deployment therefore accepts no other provider
 * for checkout, callbacks or refunds. Demo and the ECPay-like adapter remain
 * available to local, test, CI and Preview runtimes.
 *
 * Production means the Vercel production deployment, plus a conservative
 * fallback (PR #458 review m-5): a NODE_ENV=production server outside Vercel
 * is production unless it serves a loopback app URL (local e2e and the
 * disposable QA runners) or explicitly sets ALLOW_NON_PAYUNI_PROVIDERS=1.
 * Vercel preview/development deployments are never production here.
 */
export const PRODUCTION_PAYMENT_PROVIDER = "payuni";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function servesLoopbackAppUrl(env: RuntimeEnvironment) {
  try {
    const hostname = new URL(env.NEXT_PUBLIC_APP_URL ?? "").hostname.toLowerCase();
    return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** The Vercel production deployment only; used by the deploy-time preflight. */
export function isVercelProductionDeployment(env: RuntimeEnvironment = process.env) {
  return env.VERCEL_ENV === "production";
}

export function isProductionDeployment(env: RuntimeEnvironment = process.env) {
  if (isVercelProductionDeployment(env)) return true;
  if (env.VERCEL_ENV) return false;
  return env.NODE_ENV === "production" && !servesLoopbackAppUrl(env) && env.ALLOW_NON_PAYUNI_PROVIDERS !== "1";
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
