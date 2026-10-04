import type { BillingPlan, PaymentTransaction } from "@prisma/client";
import { getStagingDatabaseIdentityReport, isStagingPayUniPreviewCandidate } from "@/lib/database-identity";
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
export const PAYUNI_STAGING_RETRY_VENDOR_ID = "199d96aa-7e6e-48e0-986c-23ba07f5a856";
export const PAYUNI_STAGING_RETRY_TRANSACTION_ID = "cmusddjxy0003jt04ov7ylk3h";
export const PAYUNI_STAGING_RETRY_ORDER_NUMBER = "CD-20261003123000-PBHP04";
export const PAYUNI_STAGING_RETRY_MERCHANT_ID = "HTCU1130301000101";

type TestPlan = Pick<BillingPlan, "code" | "monthlyPriceCents" | "isActive" | "description">;
type Permit = { deploymentHost: string; merchantId: string; vendorId: string; expiresAt: string };
export type PayUniStagingRetryPermit = Permit & { retryAttemptId: string; acknowledgedPendingTransactionId: string };

function parsePermit(description: string | null): Permit | null {
  if (!description?.startsWith(PAYUNI_STAGING_PLAN_PERMIT_PREFIX)) return null;
  try {
    const data = JSON.parse(description.slice(PAYUNI_STAGING_PLAN_PERMIT_PREFIX.length)) as Partial<Permit>;
    if (typeof data.deploymentHost !== "string" || !/^[-a-z0-9.]+\.vercel\.app$/.test(data.deploymentHost)
      || typeof data.merchantId !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(data.merchantId)
      || typeof data.vendorId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(data.vendorId)
      || typeof data.expiresAt !== "string" || !Number.isFinite(Date.parse(data.expiresAt))) return null;
    const retry = data as Partial<PayUniStagingRetryPermit>;
    // A partial or widened acknowledgment must never fall back to legacy scope.
    if (retry.retryAttemptId !== undefined || retry.acknowledgedPendingTransactionId !== undefined) {
      if (typeof retry.retryAttemptId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(retry.retryAttemptId)
        || retry.acknowledgedPendingTransactionId !== PAYUNI_STAGING_RETRY_TRANSACTION_ID
        || data.vendorId !== PAYUNI_STAGING_RETRY_VENDOR_ID
        || data.merchantId !== PAYUNI_STAGING_RETRY_MERCHANT_ID) return null;
    }
    return data as Permit;
  } catch {
    return null;
  }
}

/** One owner-acknowledged exception, issued by the fixed staging runner. */
export function payUniStagingPlanRetryPermit(vendorId: string, plan: TestPlan, env: NodeJS.ProcessEnv = process.env) {
  if (!payUniStagingPlanTestAllowed(vendorId, plan, env)) return null;
  const permit = parsePermit(plan.description) as PayUniStagingRetryPermit | null;
  return permit?.retryAttemptId ? permit : null;
}

type AcknowledgedSubscription = { id: string; vendorId: string; planId: string; status: string; plan: Pick<BillingPlan, "id" | "code" | "monthlyPriceCents" | "isActive"> };

function acknowledgedPaymentIdentity(permit: PayUniStagingRetryPermit, transaction: PaymentTransaction) {
  return transaction.id === permit.acknowledgedPendingTransactionId
    && transaction.id === PAYUNI_STAGING_RETRY_TRANSACTION_ID
    && transaction.vendorId === PAYUNI_STAGING_RETRY_VENDOR_ID
    && transaction.vendorId === permit.vendorId
    && transaction.orderNumber === PAYUNI_STAGING_RETRY_ORDER_NUMBER
    && transaction.providerName === "payuni" && transaction.paymentMode === "platform"
    && transaction.status === "pending" && transaction.providerTradeNo === null
    && transaction.currency === "TWD" && transaction.grossAmountCents === 100;
}

function acknowledgedSubscriptionSnapshot(permit: PayUniStagingRetryPermit, transaction: PaymentTransaction, subscription: AcknowledgedSubscription) {
  const metadata = transaction.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return transaction.checkoutIdempotencyKey === `platform-plan:v1:${permit.vendorId}:${subscription.planId}`
    && metadata.billingPurpose === "platform_subscription_checkout"
    && metadata.billingPlanId === subscription.planId && metadata.billingPlanCode === "staging-payuni-starter"
    && metadata.platformSubscriptionId === subscription.id
    && subscription.vendorId === permit.vendorId
    && (subscription.status === "pending_payment" || subscription.status === "payment_superseded")
    && subscription.plan.id === subscription.planId && subscription.plan.code === "staging-payuni-starter"
    && subscription.plan.monthlyPriceCents === 100 && !subscription.plan.isActive;
}

function acknowledgedLegacyPermitAndSession(permit: PayUniStagingRetryPermit, transaction: PaymentTransaction) {
  const metadata = transaction.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const originalPermit = typeof metadata.stagingPayUniPlanPermit === "string" ? parsePermit(metadata.stagingPayUniPlanPermit) : null;
  const session = metadata.checkoutSession;
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;
  const payload = session.formPayload;
  return originalPermit?.vendorId === permit.vendorId && originalPermit.merchantId === permit.merchantId
    && !("retryAttemptId" in originalPermit) && Date.parse(originalPermit.expiresAt) <= Date.now()
    && session.provider === "payuni" && session.mode === "form_post" && session.formMethod === "POST"
    && session.formAction === PAYUNI_PRODUCTION_UPP_URL
    && Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && payload.MerID === permit.merchantId);
}

/** Check the old server snapshot without changing or regenerating its form. */
export function payUniStagingAcknowledgedPendingAllowed(
  permit: PayUniStagingRetryPermit,
  transaction: PaymentTransaction,
  subscription: AcknowledgedSubscription | null,
) {
  return Boolean(subscription && acknowledgedPaymentIdentity(permit, transaction)
    && acknowledgedSubscriptionSnapshot(permit, transaction, subscription)
    && acknowledgedLegacyPermitAndSession(permit, transaction));
}

/** Environment checks are intentionally independent of the DB-held permit. */
export function payUniStagingPlanTestScope(env: NodeJS.ProcessEnv = process.env) {
  const identity = getStagingDatabaseIdentityReport(env);
  return env.VERCEL_ENV === "preview"
    && isStagingPayUniPreviewCandidate(env)
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

/** Explain a closed test window without exposing credentials or changing authorization. */
export function payUniStagingPlanTestAvailability(vendorId: string, plans: TestPlan[], env: NodeJS.ProcessEnv = process.env) {
  const tests = plans.filter((plan) => Object.hasOwn(PAYUNI_STAGING_PLAN_PRICES_CENTS, plan.code));
  if (tests.length === 3 && new Set(tests.map((plan) => plan.code)).size === 3
    && tests.every((plan) => payUniStagingPlanTestAllowed(vendorId, plan, env))) return "ready";
  if (!payUniStagingPlanTestScope(env) || tests.length !== 3) return "configuration";
  const permits = tests.map((plan) => parsePermit(plan.description));
  if (permits.some((permit) => !permit)) return "missing_permit";
  // Another tenant's permit remains opaque.
  if (permits.some((permit) => permit!.vendorId !== vendorId)) return "configuration";
  if (permits.some((permit) => Date.parse(permit!.expiresAt) <= Date.now())) return "expired_permit";
  if (permits.some((permit) => permit!.deploymentHost !== env.VERCEL_URL)) return "deployment_changed";
  return "configuration";
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
  const retry = payUniStagingPlanRetryPermit(vendorId, plan, env);
  return (!retry || (transaction.id !== retry.acknowledgedPendingTransactionId
      && metadata.stagingPayUniRetryAttemptId === retry.retryAttemptId
      && metadata.stagingPayUniAcknowledgedPendingTransactionId === retry.acknowledgedPendingTransactionId))
    && transaction.vendorId === vendorId
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
