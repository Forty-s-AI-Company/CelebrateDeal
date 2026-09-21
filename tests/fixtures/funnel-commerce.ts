import type { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createLandingPageFixture } from "./landing-page";

/** Synthetic catalog only; reject accidental execution against deployed databases. */
export async function createFunnelCommerceFixture(db: PrismaClient, runKey: string) {
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  const base = await createLandingPageFixture(db, runKey);
  const create = async (name: string, slug: string, priceCents: number, linked = true) => {
    const product = await db.product.create({ data: {
      vendorId: base.vendor.id, name, slug, priceCents, inventory: 20,
      fulfillmentType: "physical", fulfillmentTypeConfirmed: true, isActive: true,
    } });
    if (linked) await db.salesProjectProduct.create({ data: {
      vendorId: base.vendor.id, projectId: base.project.id, productId: product.id,
    } });
    return { id: product.id, name, priceCents };
  };
  const product = await create("TEST ONLY 主商品", "test-only-main", 123400);
  const bump = await create("TEST ONLY 加購商品", "test-only-bump", 23400);
  const unlinked = await create("TEST ONLY 其他專案商品", "test-only-unlinked", 99900, false);
  return { ...base, product, bump, unlinked };
}
