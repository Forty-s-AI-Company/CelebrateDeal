import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runStagingPlanPriceChange, validateTarget } from "./staging-payuni-plan-prices";

const ref = "ocbugvgojrunvenozsbx";
const originalPlans = [
  { id: "starter-id", code: "starter", name: "Starter", monthlyPriceCents: 248000, isActive: true },
  { id: "growth-id", code: "growth", name: "Growth", monthlyPriceCents: 598000, isActive: true },
  { id: "team-id", code: "team-pro", name: "Team / Pro", monthlyPriceCents: 1280000, isActive: true },
];
const testPlans = originalPlans.map((p, i) => ({ ...p, id: `test-${p.id}`, code: `staging-payuni-${p.code}`, monthlyPriceCents: (i + 1) * 100, isActive: false, description: null as string | null }));

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_ID: "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn",
    VERCEL_GIT_COMMIT_REF: "codex/prelaunch-engineering-20260929",
    PAYMENT_PROVIDER: "payuni",
    NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    DATABASE_URL: `postgresql:${"//"}postgres.${ref}:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
    DIRECT_URL: `postgresql:${"//"}postgres:synthetic@db.${ref}.supabase.co:5432/postgres`,
    STAGING_DATABASE_URL: `postgresql:${"//"}postgres:synthetic@db.${ref}.supabase.co:5432/postgres`,
    PAYUNI_STAGING_PLAN_TEST_VENDOR_ID: "synthetic-vendor",
  };
}

function fakeDb(tests = testPlans) {
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockImplementation(({ where }) => Promise.resolve(where.isActive ? originalPlans : tests));
  const tx = {
    billingPlan: { findMany, create, update },
    vendor: { findUnique: vi.fn().mockResolvedValue({ id: "synthetic-vendor" }) },
    paymentTransaction: { count: vi.fn().mockResolvedValue(0) },
  };
  return { db: { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as unknown as PrismaClient, tx };
}

describe("inactive staging payment plans", () => {
  it("requires the exact staging database and a reviewed write gate", () => {
    const env = environment();
    expect(() => validateTarget(env, "inspect")).not.toThrow();
    expect(() => validateTarget(env, "prepare")).toThrow();
    expect(() => validateTarget({ ...env, STAGING_PAYUNI_TEST_CHANGE_APPROVED: "true" }, "prepare")).not.toThrow();
    expect(() => validateTarget({ ...env, STAGING_DATABASE_URL: `postgresql:${"//"}postgres.${ref}:synthetic@attacker.example/postgres` }, "inspect")).toThrow();
    expect(() => validateTarget({ ...env, STAGING_DATABASE_URL: `postgresql:${"//"}postgres:synthetic@db.${ref}.supabase.co:6543/postgres` }, "inspect")).toThrow();
  });

  it("inspects without writes; prepare never changes original plan rows", async () => {
    const env = environment();
    const { db, tx } = fakeDb([]);
    expect(await runStagingPlanPriceChange(db, env, "inspect")).toMatchObject({ mode: "inspect" });
    expect(tx.billingPlan.create).not.toHaveBeenCalled();
    expect(await runStagingPlanPriceChange(db, env, "prepare")).toMatchObject({ mode: "prepare", changed: 3 });
    expect(tx.billingPlan.create.mock.calls.map(([query]) => query.data.monthlyPriceCents)).toEqual([100, 200, 300]);
    expect(tx.billingPlan.create.mock.calls.every(([query]) => query.data.isActive === false)).toBe(true);
    expect(tx.billingPlan.update).not.toHaveBeenCalled();
  });

  it("binds activation to a deployment and revokes it without changing prices", async () => {
    const env = { ...environment(), PAYUNI_STAGING_PLAN_TEST_DEPLOYMENT_HOST: "staging-abc.vercel.app", PAYUNI_STAGING_PLAN_TEST_MERCHANT_ID: "SYNTHETIC-MERCHANT", STAGING_PAYUNI_TEST_CHANGE_APPROVED: "true" };
    expect(() => validateTarget(env, "enable")).not.toThrow();
    expect(() => validateTarget({ ...env, VERCEL_PROJECT_ID: "prj_other" }, "enable")).toThrow();
    expect(() => validateTarget({ ...env, VERCEL_GIT_COMMIT_REF: "other-branch" }, "enable")).toThrow();
    const { db, tx } = fakeDb();
    await runStagingPlanPriceChange(db, env, "enable");
    expect(tx.billingPlan.update.mock.calls).toHaveLength(3);
    expect(tx.billingPlan.update.mock.calls.every(([query]) => query.data.description.startsWith("staging-payuni-plan-v1:"))).toBe(true);
    await runStagingPlanPriceChange(db, env, "disable");
    expect(tx.billingPlan.update.mock.calls.slice(3).every(([query]) => query.data.description === null)).toBe(true);
  });

  it("revokes surviving permits even when a test row or unrelated runtime setting has drifted", async () => {
    const activePermit = "staging-payuni-plan-v1:{}";
    const { db, tx } = fakeDb([{ ...testPlans[0], isActive: true, description: activePermit }, { ...testPlans[1], description: activePermit }]);
    const env = { STAGING_DATABASE_URL: environment().STAGING_DATABASE_URL, NODE_ENV: "test" as const };
    expect(() => validateTarget(env, "disable")).not.toThrow();
    expect(await runStagingPlanPriceChange(db, env, "disable")).toMatchObject({ changed: 2, found: 2, anomalous: 1 });
    expect(tx.billingPlan.update.mock.calls).toHaveLength(2);
    expect(tx.billingPlan.update.mock.calls.every(([query]) => query.data.isActive === false)).toBe(true);
  });

  it("does not rebind a new deployment while the vendor has a pending PAYUNi platform payment", async () => {
    const env = { ...environment(), PAYUNI_STAGING_PLAN_TEST_DEPLOYMENT_HOST: "staging-new.vercel.app", PAYUNI_STAGING_PLAN_TEST_MERCHANT_ID: "SYNTHETIC-MERCHANT" };
    const { db, tx } = fakeDb();
    tx.paymentTransaction.count.mockResolvedValue(1);
    await expect(runStagingPlanPriceChange(db, env, "enable")).rejects.toThrow("Reconcile pending PAYUNi platform payments");
    expect(tx.billingPlan.update).not.toHaveBeenCalled();
  });
});
