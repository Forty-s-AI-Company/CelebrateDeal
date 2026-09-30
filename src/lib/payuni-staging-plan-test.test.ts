import { describe, expect, it } from "vitest";
import type { PaymentTransaction } from "@prisma/client";
import {
  payUniStagingPlanSessionAllowed,
  payUniStagingPlanTestAllowed,
  payUniStagingPlanTestScope,
  PAYUNI_STAGING_APP_ORIGIN,
  PAYUNI_STAGING_PLAN_PERMIT_PREFIX,
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
  };
}

const plan = { id: "starter-id", code: "staging-payuni-starter", monthlyPriceCents: 100, isActive: false, description: permit };
const transaction = {
  vendorId: "synthetic-vendor", providerName: "payuni", paymentMode: "platform", status: "pending",
  currency: "TWD", grossAmountCents: 100,
  metadata: { billingPurpose: "platform_subscription_checkout", billingPlanId: plan.id, billingPlanCode: plan.code, platformSubscriptionId: "synthetic-subscription", stagingPayUniPlanPermit: permit },
} as unknown as PaymentTransaction;

describe("staging live plan scope", () => {
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
