import { describe, expect, it } from "vitest";
import type { PaymentTransaction } from "@prisma/client";
import {
  payUniStagingPlanSessionAllowed,
  payUniStagingPlanTestAllowed,
  payUniStagingPlanTestAvailability,
  payUniStagingPlanTestScope,
  payUniStagingPlanRetryPermit,
  payUniStagingAcknowledgedPendingAllowed,
  PAYUNI_STAGING_APP_ORIGIN,
  PAYUNI_STAGING_PLAN_PERMIT_PREFIX,
  PAYUNI_STAGING_RETRY_VENDOR_ID,
  PAYUNI_STAGING_RETRY_TRANSACTION_ID,
  PAYUNI_STAGING_RETRY_ORDER_NUMBER,
  PAYUNI_STAGING_RETRY_MERCHANT_ID,
} from "@/lib/payuni-staging-plan-test";

const ref = "ocbugvgojrunvenozsbx";
const deploymentHost = "celebrate-deal-staging-abc123.vercel.app";
const permit = PAYUNI_STAGING_PLAN_PERMIT_PREFIX + JSON.stringify({
  deploymentHost,
  merchantId: "SYNTHETIC-MERCHANT",
  vendorId: "synthetic-vendor",
  expiresAt: "2099-01-01T00:00:00.000Z",
});

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_ID: "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn",
    VERCEL_GIT_COMMIT_REF: "codex/prelaunch-engineering-20260929",
    VERCEL_URL: deploymentHost,
    PAYMENT_PROVIDER: "payuni",
    PAYUNI_ENV: "production",
    PAYUNI_STAGING_PLAN_TEST_ENABLED: "true",
    PAYUNI_MERCHANT_ID: "SYNTHETIC-MERCHANT",
    PAYUNI_HASH_KEY: "12345678901234567890123456789012",
    PAYUNI_HASH_IV: "1234567890123456",
    NEXT_PUBLIC_APP_URL: PAYUNI_STAGING_APP_ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    DATABASE_URL: `postgresql:${"//"}postgres.${ref}:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
    DIRECT_URL: `postgresql:${"//"}postgres:synthetic@db.${ref}.supabase.co:5432/postgres`,
    STAGING_DATABASE_URL: `postgresql:${"//"}postgres:synthetic@db.${ref}.supabase.co:5432/postgres`,
  };
}

const plan = { id: "starter-id", code: "staging-payuni-starter", monthlyPriceCents: 100, isActive: false, description: permit };
const transaction = {
  vendorId: "synthetic-vendor", providerName: "payuni", paymentMode: "platform", status: "pending",
  currency: "TWD", grossAmountCents: 100,
  metadata: { billingPurpose: "platform_subscription_checkout", billingPlanId: plan.id, billingPlanCode: plan.code, platformSubscriptionId: "synthetic-subscription", stagingPayUniPlanPermit: permit },
} as unknown as PaymentTransaction;

describe("staging live plan scope", () => {
  it("accepts only a complete retry permit bound to the fixed owner acknowledgment", () => {
    const retryData = {
      deploymentHost, merchantId: PAYUNI_STAGING_RETRY_MERCHANT_ID, vendorId: PAYUNI_STAGING_RETRY_VENDOR_ID,
      expiresAt: "2099-01-01T00:00:00.000Z", retryAttemptId: "00000000-0000-4000-8000-000000000001",
      acknowledgedPendingTransactionId: PAYUNI_STAGING_RETRY_TRANSACTION_ID,
    };
    const env = { ...environment(), PAYUNI_MERCHANT_ID: PAYUNI_STAGING_RETRY_MERCHANT_ID };
    const retryPlan = { ...plan, description: PAYUNI_STAGING_PLAN_PERMIT_PREFIX + JSON.stringify(retryData) };
    expect(payUniStagingPlanRetryPermit(PAYUNI_STAGING_RETRY_VENDOR_ID, retryPlan, env)).toEqual(retryData);
    for (const change of [
      { acknowledgedPendingTransactionId: "another-pending" }, { retryAttemptId: "not-a-uuid" },
      { retryAttemptId: undefined }, { acknowledgedPendingTransactionId: undefined },
      { vendorId: "another-vendor" }, { merchantId: "OTHER-MERCHANT" },
    ]) {
      const altered = { ...retryPlan, description: PAYUNI_STAGING_PLAN_PERMIT_PREFIX + JSON.stringify({ ...retryData, ...change }) };
      expect(payUniStagingPlanTestAllowed(PAYUNI_STAGING_RETRY_VENDOR_ID, altered, env)).toBe(false);
      expect(payUniStagingPlanRetryPermit(PAYUNI_STAGING_RETRY_VENDOR_ID, altered, env)).toBeNull();
    }
    const subscription = { id: "old-subscription", vendorId: retryData.vendorId, planId: plan.id, status: "pending_payment", plan: retryPlan };
    const oldMetadata = {
      ...transaction.metadata as object, platformSubscriptionId: subscription.id,
      stagingPayUniPlanPermit: PAYUNI_STAGING_PLAN_PERMIT_PREFIX + JSON.stringify({ deploymentHost, merchantId: retryData.merchantId, vendorId: retryData.vendorId, expiresAt: "2000-01-01T00:00:00.000Z" }),
      checkoutSession: { provider: "payuni", mode: "form_post", formMethod: "POST", formAction: "https://api.payuni.com.tw/api/upp", formPayload: { MerID: retryData.merchantId } },
    };
    const old = { ...transaction, id: PAYUNI_STAGING_RETRY_TRANSACTION_ID, vendorId: retryData.vendorId,
      orderNumber: PAYUNI_STAGING_RETRY_ORDER_NUMBER, providerTradeNo: null,
      checkoutIdempotencyKey: `platform-plan:v1:${retryData.vendorId}:${plan.id}`, metadata: oldMetadata };
    expect(payUniStagingAcknowledgedPendingAllowed(retryData, old, subscription)).toBe(true);
    for (const change of [{ id: "other" }, { orderNumber: "other" }, { providerName: "demo" }, { status: "paid" }, { providerTradeNo: "known" }, { grossAmountCents: 200 }, { checkoutIdempotencyKey: null }]) {
      expect(payUniStagingAcknowledgedPendingAllowed(retryData, { ...old, ...change }, subscription)).toBe(false);
    }
    expect(payUniStagingAcknowledgedPendingAllowed(retryData, old, { ...subscription, id: "other-subscription" })).toBe(false);
    expect(payUniStagingAcknowledgedPendingAllowed(retryData, old, { ...subscription, status: "active" })).toBe(false);
    expect(payUniStagingPlanSessionAllowed(retryData.vendorId, retryPlan, old, env)).toBe(false);
    const newOrder = { ...old, id: "new-order", metadata: { ...oldMetadata, stagingPayUniPlanPermit: retryPlan.description,
      stagingPayUniRetryAttemptId: retryData.retryAttemptId, stagingPayUniAcknowledgedPendingTransactionId: retryData.acknowledgedPendingTransactionId } };
    expect(payUniStagingPlanSessionAllowed(retryData.vendorId, retryPlan, newOrder, env)).toBe(true);
    expect(payUniStagingPlanSessionAllowed(retryData.vendorId, retryPlan, { ...newOrder, metadata: { ...newOrder.metadata, stagingPayUniRetryAttemptId: "wrong-attempt" } }, env)).toBe(false);
  });

  it("explains expired and deployment-bound permits without enabling checkout", () => {
    const env = environment();
    const tests = Object.entries({ "staging-payuni-starter": 100, "staging-payuni-growth": 200, "staging-payuni-team-pro": 300 })
      .map(([code, monthlyPriceCents]) => ({ ...plan, code, monthlyPriceCents }));
    expect(payUniStagingPlanTestAvailability("synthetic-vendor", tests, env)).toBe("ready");
    const expired = tests.map((test) => ({ ...test, description: permit.replace("2099-01-01", "2000-01-01") }));
    expect(payUniStagingPlanTestAvailability("synthetic-vendor", expired, env)).toBe("expired_permit");
    expect(expired.every((test) => !payUniStagingPlanTestAllowed("synthetic-vendor", test, env))).toBe(true);
    expect(payUniStagingPlanTestAvailability("synthetic-vendor", tests, { ...env, VERCEL_URL: "new.vercel.app" })).toBe("deployment_changed");
    expect(payUniStagingPlanTestAvailability("synthetic-vendor", tests.map((test) => ({ ...test, description: null })), env)).toBe("missing_permit");
    expect(payUniStagingPlanTestAvailability("other-vendor", expired, env)).toBe("configuration");
    expect(payUniStagingPlanTestAvailability("synthetic-vendor", tests, { ...env, PAYUNI_STAGING_PLAN_TEST_ENABLED: "false" })).toBe("configuration");
  });
  it("accepts only the inactive test plan, designated vendor and bound deployment", () => {
    const env = environment();
    expect(payUniStagingPlanTestScope(env)).toBe(true);
    expect(payUniStagingPlanTestAllowed("synthetic-vendor", plan, env)).toBe(true);
    expect(payUniStagingPlanSessionAllowed("synthetic-vendor", plan, transaction, env)).toBe(true);
    expect(payUniStagingPlanTestAllowed("other-vendor", plan, env)).toBe(false);
    expect(payUniStagingPlanTestAllowed("synthetic-vendor", { ...plan, isActive: true }, env)).toBe(false);
    expect(payUniStagingPlanTestAllowed("synthetic-vendor", { ...plan, monthlyPriceCents: 248000 }, env)).toBe(false);
    expect(payUniStagingPlanTestAllowed("synthetic-vendor", { ...plan, code: "starter" }, env)).toBe(false);
    expect(payUniStagingPlanTestAllowed("synthetic-vendor", { ...plan, description: null }, env)).toBe(false);
  });

  it.each([
    ["VERCEL_ENV", "production"], ["PAYUNI_ENV", "sandbox"], ["PAYMENT_PROVIDER", "demo"],
    ["VERCEL_PROJECT_ID", "prj_other"], ["VERCEL_GIT_COMMIT_REF", "other-branch"],
    ["PAYUNI_STAGING_PLAN_TEST_ENABLED", "false"], ["VERCEL_URL", "old-deployment.vercel.app"],
    ["NEXT_PUBLIC_APP_URL", "https://another.example.test"],
    ["DATABASE_URL", `postgresql:${"//"}postgres.${ref}:synthetic@attacker.example:5432/postgres`],
    ["DIRECT_URL", "postgresql:" + "//postgres:synthetic@db.other.supabase.co/postgres"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://other.supabase.co"],
    ["PAYUNI_MERCHANT_ID", "OTHER-MERCHANT"], ["PAYUNI_HASH_IV", "short"],
  ])("rejects a mismatched %s", (key, value) => {
    expect(payUniStagingPlanTestAllowed("synthetic-vendor", plan, { ...environment(), [key]: value })).toBe(false);
  });

  it("rejects revoked permits and altered transactions", () => {
    const env = environment();
    expect(payUniStagingPlanTestAllowed("synthetic-vendor", { ...plan, description: permit.replace("2099-01-01", "2020-01-01") }, env)).toBe(false);
    expect(payUniStagingPlanSessionAllowed("synthetic-vendor", plan, { ...transaction, grossAmountCents: 300 }, env)).toBe(false);
    expect(payUniStagingPlanSessionAllowed("synthetic-vendor", plan, { ...transaction, paymentMode: "merchant" }, env)).toBe(false);
    expect(payUniStagingPlanSessionAllowed("synthetic-vendor", plan, { ...transaction, metadata: {} }, env)).toBe(false);
  });
});
