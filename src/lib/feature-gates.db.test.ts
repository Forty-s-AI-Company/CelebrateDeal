import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { isCardBindingRequiredForVendor, isVendorFeatureEnabled } from "@/lib/feature-gates";

// F-001 / F-002: closed-beta grants live on Vendor.betaFeatureGrants
// (migration 20261021171100_vendor_beta_feature_grants).

const db = getDb();
const vendorIds: string[] = [];

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function vendor(data: { betaFeatureGrants?: string[]; enabledFeatureModules?: string[] } = {}) {
  const suffix = randomUUID();
  const created = await db.vendor.create({
    data: { name: "Beta gate", slug: `beta-gate-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only", ...data },
  });
  vendorIds.push(created.id);
  return created;
}

describe("Vendor.betaFeatureGrants", () => {
  it("starts empty, so every closed-beta module is off for a new vendor", async () => {
    const created = await vendor();
    expect(created.betaFeatureGrants).toEqual([]);
    for (const feature of ["courses", "billing", "funnel_binding", "consultation_booking", "browser_live", "danmaku"] as const) {
      await expect(isVendorFeatureEnabled(db, created.id, feature)).resolves.toBe(false);
    }
    await expect(isCardBindingRequiredForVendor(db, created.id)).resolves.toBe(false);
  });

  it("reads the grant of exactly the requested vendor", async () => {
    const granted = await vendor({ betaFeatureGrants: ["billing", "funnel_binding"] });
    const other = await vendor();
    await expect(isVendorFeatureEnabled(db, granted.id, "billing")).resolves.toBe(true);
    await expect(isCardBindingRequiredForVendor(db, granted.id)).resolves.toBe(true);
    await expect(isVendorFeatureEnabled(db, other.id, "billing")).resolves.toBe(false);
    await expect(isVendorFeatureEnabled(db, `missing-${randomUUID()}`, "billing")).resolves.toBe(false);
  });

  it("rejects values outside the known module set in the database", async () => {
    const created = await vendor();
    await expect(db.vendor.update({ where: { id: created.id }, data: { betaFeatureGrants: ["billing", "everything"] } })).rejects.toThrow();
    await expect(db.vendor.update({ where: { id: created.id }, data: { betaFeatureGrants: ["courses", "danmaku"] } })).resolves.toMatchObject({ betaFeatureGrants: ["courses", "danmaku"] });
  });
});
