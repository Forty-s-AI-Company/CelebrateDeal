import { describe, expect, it } from "vitest";
import { assertPermitEnvironment, buildPermitSql, runPermit } from "./staging-payuni-management-permit";

const vendorId = "00000000-0000-4000-8000-000000000001";
const host = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";
const merchantId = "HTCU1130301000101";

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    STAGING_PAYUNI_TEST_CHANGE_APPROVED: "true",
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_ID: "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn",
    VERCEL_GIT_COMMIT_REF: "codex/prelaunch-engineering-20260929",
    NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
    NEXT_PUBLIC_SUPABASE_URL: "https://ocbugvgojrunvenozsbx.supabase.co",
    PAYMENT_PROVIDER: "payuni",
    PAYUNI_ENV: "production",
    PAYUNI_LIVE_PROBE_ENABLED: "false",
    PAYUNI_STAGING_PLAN_TEST_VENDOR_ID: vendorId,
    PAYUNI_STAGING_PLAN_TEST_DEPLOYMENT_HOST: host,
    PAYUNI_STAGING_PLAN_TEST_MERCHANT_ID: merchantId,
  };
}

describe("fixed staging PAYUNi Management API permit", () => {
  it("rejects an unreviewed target, branch alias, merchant or live probe before invoking CLI", () => {
    const env = environment();
    expect(() => assertPermitEnvironment(env, "enable")).not.toThrow();
    for (const [key, value] of [
      ["STAGING_PAYUNI_TEST_CHANGE_APPROVED", "false"],
      ["VERCEL_ENV", "production"],
      ["VERCEL_PROJECT_ID", "prj_other"],
      ["VERCEL_GIT_COMMIT_REF", "master"],
      ["NEXT_PUBLIC_APP_URL", "https://example.test"],
      ["NEXT_PUBLIC_SUPABASE_URL", "https://other.supabase.co"],
      ["PAYMENT_PROVIDER", "demo"],
      ["PAYUNI_ENV", "sandbox"],
      ["PAYUNI_LIVE_PROBE_ENABLED", "true"],
      ["PAYUNI_STAGING_PLAN_TEST_VENDOR_ID", "short"],
      ["PAYUNI_STAGING_PLAN_TEST_MERCHANT_ID", "OTHER"],
      ["PAYUNI_STAGING_PLAN_TEST_DEPLOYMENT_HOST", "celebrate-deal-staging-git-codex-a25814740s-projects.vercel.app"],
      ["PAYUNI_STAGING_PLAN_TEST_DEPLOYMENT_HOST", "celebrate-deal-staging.vercel.app"],
    ] as const) {
      expect(() => assertPermitEnvironment({ ...env, [key]: value }, "enable")).toThrow();
    }
    expect(() => runPermit(["--inspect"], env)).toThrow("PERMIT_MODE_INVALID");
  });

  it("keeps emergency disable available despite unrelated runtime drift", () => {
    expect(() => assertPermitEnvironment({ NODE_ENV: "test", STAGING_PAYUNI_TEST_CHANGE_APPROVED: "true" }, "disable")).not.toThrow();
    expect(() => assertPermitEnvironment({ NODE_ENV: "test" }, "disable")).toThrow("PERMIT_CHANGE_NOT_APPROVED");
  });

  it("generates one serializable short-lived permit for three inactive exact-price plans", () => {
    const sql = buildPermitSql("enable", { vendorId, host, merchantId });
    expect(sql).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;/u);
    expect(sql).toContain("pg_advisory_xact_lock(351, 20261003)");
    expect(sql).toContain("lock_timeout = '3s'");
    expect(sql).toContain("statement_timeout = '20s'");
    expect(sql).toContain("'expiresAt', CURRENT_TIMESTAMP + interval '2 hours'");
    expect(sql).toContain("PERMIT_PENDING_PAYMENT_EXISTS");
    expect(sql).toContain("PERMIT_TEST_PLANS_INVALID");
    expect(sql).toContain("IF affected <> 3 THEN RAISE EXCEPTION 'PERMIT_ENABLE_COUNT_INVALID'");
    expect(sql).toContain("'staging-payuni-starter', 100");
    expect(sql).toContain("'staging-payuni-growth', 200");
    expect(sql).toContain("'staging-payuni-team-pro', 300");
    expect(sql).toContain("'staging-payuni-plan-v1:'");
    expect(sql).toContain("'deploymentHost'");
    expect(sql).toContain("'merchantId'");
    expect(sql).toContain("'vendorId'");
    expect(sql).not.toMatch(/\b(?:INSERT|DELETE)\b/iu);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/u);
    expect(() => buildPermitSql("enable", { vendorId, host: "branch-alias.vercel.app", merchantId })).toThrow();
    expect(() => buildPermitSql("enable", { vendorId, host, merchantId: "OTHER" })).toThrow();
  });

  it("generates bounded revocation without vendor, merchant or pending-payment dependency", () => {
    const sql = buildPermitSql("disable");
    expect(sql).toContain("SET \"description\" = NULL, \"isActive\" = false");
    expect(sql).toContain("PERMIT_DISABLE_COUNT_INVALID");
    expect(sql).not.toContain("PaymentTransaction");
    expect(sql).not.toContain("VendorMember");
    expect(sql).not.toContain("'starter', 'growth', 'team-pro'");
    expect(sql).not.toMatch(/\b(?:INSERT|DELETE)\b/iu);
  });
});
