import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createStagingPayUniTestVendor, validateStagingTestVendorTarget } from "./staging-payuni-test-vendor";

const ref = "ocbugvgojrunvenozsbx";

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    DATABASE_URL: `postgresql:${"//"}postgres.${ref}:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
    DIRECT_URL: `postgresql:${"//"}postgres:synthetic@db.${ref}.supabase.co:5432/postgres`,
    STAGING_DATABASE_URL: `postgresql:${"//"}postgres:synthetic@db.${ref}.supabase.co:5432/postgres`,
    PAYUNI_STAGING_PLAN_TEST_ENABLED: "false",
    STAGING_PAYUNI_TEST_VENDOR_CHANGE_APPROVED: "true",
    STAGING_PAYUNI_TEST_ACCOUNT_EMAIL: "zeroyuanbrothers@gmail.com",
  };
}

function fakeDb(exists = false) {
  const tx = {
    vendor: {
      findFirst: vi.fn().mockResolvedValue(exists ? { id: "existing-vendor" } : null),
      create: vi.fn().mockResolvedValue({ id: "new-vendor" }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "new-user" }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as unknown as PrismaClient;
  return { db, tx };
}

describe("dedicated staging PAYUNi test vendor bootstrap", () => {
  it("requires an exact staging database, disabled payment flag and reviewed write gate", () => {
    const env = environment();
    expect(validateStagingTestVendorTarget(env)).toEqual({ email: "zeroyuanbrothers@gmail.com", name: "Staging PAYUNi Test Owner" });
    expect(() => validateStagingTestVendorTarget({ ...env, PAYUNI_STAGING_PLAN_TEST_ENABLED: "true" })).toThrow();
    expect(() => validateStagingTestVendorTarget({ ...env, STAGING_PAYUNI_TEST_VENDOR_CHANGE_APPROVED: "false" })).toThrow();
    expect(() => validateStagingTestVendorTarget({ ...env, STAGING_PAYUNI_TEST_ACCOUNT_EMAIL: "other@example.test" })).toThrow();
    expect(() => validateStagingTestVendorTarget({ ...env, STAGING_DATABASE_URL: `postgresql:${"//"}postgres:synthetic@db.awigitueyqdqaqwbjdgu.supabase.co:5432/postgres` })).toThrow();
    expect(() => validateStagingTestVendorTarget({ ...env, STAGING_DATABASE_URL: `postgresql:${"//"}postgres:synthetic@db.${ref}.supabase.co:6543/postgres` })).toThrow();
  });

  it("creates only a dedicated vendor, owner membership and audit record", async () => {
    const { db, tx } = fakeDb();
    await expect(createStagingPayUniTestVendor(db, { email: "owner@example.test", name: "Test Owner" })).resolves.toEqual({ vendorId: "new-vendor" });
    expect(tx.vendor.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ slug: "payuni-plan-test", tracking: { create: {} } }) }));
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ memberships: { create: { vendorId: "new-vendor", role: "owner", status: "active" } } }) }));
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.vendor.create.mock.calls[0][0].data.passwordHash).toMatch(/^scrypt:/);
    expect(tx.user.create.mock.calls[0][0].data.passwordHash).toMatch(/^scrypt:/);
    expect(tx.vendor.create.mock.calls[0][0].data.passwordHash).not.toBe(tx.user.create.mock.calls[0][0].data.passwordHash);
  });

  it("fails closed if the designated vendor already exists", async () => {
    const { db, tx } = fakeDb(true);
    await expect(createStagingPayUniTestVendor(db, { email: "owner@example.test", name: "Test Owner" })).rejects.toThrow("already exists");
    expect(tx.vendor.create).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });
});
