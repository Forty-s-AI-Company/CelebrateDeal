import type { BillingPlan, PaymentTransaction } from "@prisma/client";
import { getStagingDatabaseIdentityReport } from "@/lib/database-identity";
import { activePayUniCredentials } from "@/lib/payuni-credentials";

// These inactive plans exist only in the staging database. Old deployments
// filter inactive plans and cannot sell them, even when they share that DB.
export const PAYUNI_STAGING_PLAN_PRICES_CENTS = {
  "staging-payuni-starter": 100,
  "staging-payuni-growth": 200,
  "staging-payuni-team-pro": 300,
} as const;

export const PAYUNI_STAGING_APP_ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
export const PAYUNI_PRODUCTION_UPP_URL = "https://api.payuni.com.tw/api/upp";
export const PAYUNI_STAGING_PLAN_PERMIT_PREFIX = "staging-payuni-plan-v1:";

type TestPlan = Pick<BillingPlan, "code" | "monthlyPriceCents" | "isActive" | "description">;
type Permit = { deploymentHost: string; merchantId: string; vendorId: string; expiresAt: string };

function parsePermit(description: string | null): Permit | null {
  if (!description?.startsWith(PAYUNI_STAGING_PLAN_PERMIT_PREFIX)) return null;
  try {
    const data = JSON.parse(description.slice(PAYUNI_STAGING_PLAN_PERMIT_PREFIX.length)) as Partial<Permit>;
    if (typeof data.deploymentHost !== "string" || !/^[-a-z0-9.]+\.vercel\.app$/.test(data.deploymentHost)
      || typeof data.merchantId !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(data.merchantId)
      || typeof data.vendorId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(data.vendorId)
      || typeof data.expiresAt !== "string" || !Number.isFinite(Date.parse(data.expiresAt))) return null;
    return data as Permit;
  } catch {
    return null;
  }
}

/** Environment checks are intentionally independent of the DB-held permit. */
export function payUniStagingPlanTestScope(env: NodeJS.ProcessEnv = process.env) {
  const identity = getStagingDatabaseIdentityReport(env);
  return env.VERCEL_ENV === "preview"
    && env.PAYUNI_ENV === "production"
    && env.PAYMENT_PROVIDER === "payuni"
    && env.PAYUNI_STAGING_PLAN_TEST_ENABLED === "true"
    && env.PAYUNI_LIVE_PROBE_ENABLED !== "true"
    && env.NEXT_PUBLIC_APP_URL === PAYUNI_STAGING_APP_ORIGIN
    && Boolean(env.VERCEL_URL)
    && identity.supabase_url_match
    && identity.database_url_match
    && identity.direct_url_match;
}

/** All three values must match: test price, inactive plan and live DB permit. */
export function payUniStagingPlanTestAllowed(vendorId: string, plan: TestPlan, env: NodeJS.ProcessEnv = process.env) {
  const expected = PAYUNI_STAGING_PLAN_PRICES_CENTS[plan.code as keyof typeof PAYUNI_STAGING_PLAN_PRICES_CENTS];
  const permit = parsePermit(plan.description);
  if (!payUniStagingPlanTestScope(env) || expected === undefined || plan.isActive || !permit
    || plan.monthlyPriceCents !== expected
    || permit.vendorId !== vendorId
    || permit.deploymentHost !== env.VERCEL_URL
    || Date.parse(permit.expiresAt) <= Date.now()) return false;
  try {
    return activePayUniCredentials(env).merchantId === permit.merchantId;
  } catch {
    return false;
  }
}

/** A forged provider call cannot turn a product or stale order into a plan test. */
export function payUniStagingPlanSessionAllowed(
  vendorId: string,
  plan: Pick<BillingPlan, "id" | "code" | "monthlyPriceCents" | "isActive" | "description"> | undefined,
  transaction: PaymentTransaction,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!plan || !payUniStagingPlanTestAllowed(vendorId, plan, env)) return false;
  const metadata = transaction.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return transaction.vendorId === vendorId
    && transaction.providerName === "payuni"
    && transaction.paymentMode === "platform"
    && transaction.status === "pending"
    && transaction.currency === "TWD"
    && transaction.grossAmountCents === plan.monthlyPriceCents
    && metadata.billingPurpose === "platform_subscription_checkout"
    && metadata.billingPlanId === plan.id
    && metadata.billingPlanCode === plan.code
    && metadata.stagingPayUniPlanPermit === plan.description
    && typeof metadata.platformSubscriptionId === "string"
    && metadata.platformSubscriptionId.length > 0;
}
