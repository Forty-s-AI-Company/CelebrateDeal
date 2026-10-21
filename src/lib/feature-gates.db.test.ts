import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { isCardBindingRequiredForVendor, isProductPurchasable, isVendorFeatureEnabled, purchasableProductWhere } from "@/lib/feature-gates";

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

describe("course products while the courses module is closed (F-001, review M-1)", () => {
  async function products(vendorId: string) {
    const base = { vendorId, priceCents: 1000, isActive: true, fulfillmentTypeConfirmed: true };
    await db.product.create({ data: { ...base, name: "實體商品", slug: `physical-${randomUUID()}`, fulfillmentType: "physical" } });
    await db.product.create({ data: { ...base, name: "課程商品", slug: `course-${randomUUID()}`, fulfillmentType: "course", commerceDomain: "course" } });
  }

  it("drops course products from buyer-facing queries only for a vendor without the grant", async () => {
    const closed = await vendor();
    const open = await vendor({ betaFeatureGrants: ["courses"] });
    await products(closed.id);
    await products(open.id);

    const visible = async (vendorId: string) => (await db.product.findMany({
      where: { vendorId, ...await purchasableProductWhere(db, vendorId) }, select: { fulfillmentType: true },
    })).map((row) => String(row.fulfillmentType)).sort();
    await expect(visible(closed.id)).resolves.toEqual(["physical"]);
    await expect(visible(open.id)).resolves.toEqual(["course", "physical"]);
  });

  it("treats a course product as unsellable unless the vendor holds the grant", () => {
    expect(isProductPurchasable({ betaFeatureGrants: [] }, { fulfillmentType: "course" })).toBe(false);
    expect(isProductPurchasable({ betaFeatureGrants: [] }, { commerceDomain: "course", fulfillmentType: "digital" })).toBe(false);
    expect(isProductPurchasable({ betaFeatureGrants: [] }, { commerceDomain: "merchant", fulfillmentType: "physical" })).toBe(true);
    expect(isProductPurchasable({ betaFeatureGrants: ["courses"] }, { fulfillmentType: "course" })).toBe(true);
  });
});
