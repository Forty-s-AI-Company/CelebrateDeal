import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { resolvePaidOrderPostPurchaseOffer } from "./post-purchase-upsell-access";

const vendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function createVendor(name: string) {
  const suffix = randomUUID();
  const vendor = await getDb().vendor.create({
    data: { name, slug: `${name.toLowerCase()}-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic" },
  });
  vendorIds.push(vendor.id);
  return vendor;
}

async function createPaidOrder(input: {
  vendorId: string;
  items: Array<{ productId: string; quantity?: number }>;
  totalAmountCents: number;
}) {
  const db = getDb();
  const order = await db.commerceOrder.create({
    data: {
      vendorId: input.vendorId,
      orderNumber: `CD-AUDIT-${randomUUID()}`,
      checkoutIdempotencyKey: randomUUID(),
      checkoutIdentityHash: createHash("sha256").update(randomUUID()).digest("base64url"),
      status: "paid",
      currency: "TWD",
      subtotalAmountCents: input.totalAmountCents,
      totalAmountCents: input.totalAmountCents,
      paidAmountCents: input.totalAmountCents,
      buyerEncryptedEnvelope: "synthetic-envelope",
      buyerMaskedName: "測••",
      buyerMaskedEmail: "t***@example.test",
    },
  });
  await db.commerceOrderItem.createMany({
    data: input.items.map(({ productId, quantity = 1 }, lineIndex) => ({
      vendorId: input.vendorId,
      orderId: order.id,
      productId,
      lineIndex,
      productName: `Snapshot ${lineIndex + 1}`,
      productSlug: `snapshot-${lineIndex + 1}`,
      commerceDomain: "merchant",
      fulfillmentType: "physical",
      unitPriceCents: input.totalAmountCents / input.items.length / quantity,
      quantity,
      lineTotalCents: input.totalAmountCents / input.items.length,
      nonSensitiveSnapshot: { synthetic: true },
    })),
  });
  return order;
}

async function createConfiguredProducts(vendorId: string) {
  const db = getDb();
  const target = await db.product.create({ data: {
    vendorId, name: "Upgrade", slug: `target-${randomUUID()}`,
    priceCents: 20_000, inventory: 5, fulfillmentTypeConfirmed: true,
  } });
  const source = await db.product.create({ data: {
    vendorId, name: "Original", slug: `source-${randomUUID()}`,
    priceCents: 10_000, inventory: 5, fulfillmentTypeConfirmed: true, upsellProductId: target.id,
  } });
  return { source, target };
}

describe("paid-order post-purchase offer access", () => {
  it("uses the immutable discounted order total as credit", async () => {
    const vendor = await createVendor("Discounted");
    const { source, target } = await createConfiguredProducts(vendor.id);
    const order = await createPaidOrder({ vendorId: vendor.id, items: [{ productId: source.id }], totalAmountCents: 7_000 });

    await expect(resolvePaidOrderPostPurchaseOffer(getDb(), {
      vendorId: vendor.id, orderId: order.id, kind: "upsell",
    })).resolves.toMatchObject({ offer: { productId: target.id, amountCents: 13_000 } });
  });

  it("does not change the buyer credit after the source catalogue price changes", async () => {
    const vendor = await createVendor("Catalogue");
    const { source, target } = await createConfiguredProducts(vendor.id);
    const order = await createPaidOrder({ vendorId: vendor.id, items: [{ productId: source.id }], totalAmountCents: 7_000 });
    await getDb().product.update({ where: { id: source.id }, data: { priceCents: 16_000 } });

    await expect(resolvePaidOrderPostPurchaseOffer(getDb(), {
      vendorId: vendor.id, orderId: order.id, kind: "upsell",
    })).resolves.toMatchObject({ offer: { productId: target.id, amountCents: 13_000 } });
  });

  it("rejects a paid order owned by another vendor", async () => {
    const owner = await createVendor("Owner");
    const foreign = await createVendor("Foreign");
    const { source } = await createConfiguredProducts(foreign.id);
    const foreignOrder = await createPaidOrder({ vendorId: foreign.id, items: [{ productId: source.id }], totalAmountCents: 10_000 });

    await expect(resolvePaidOrderPostPurchaseOffer(getDb(), {
      vendorId: owner.id, orderId: foreignOrder.id, kind: "upsell",
    })).resolves.toBeNull();
  });

  it("rejects a paid source order with more than one item", async () => {
    const vendor = await createVendor("Multiitem");
    const { source } = await createConfiguredProducts(vendor.id);
    const order = await createPaidOrder({
      vendorId: vendor.id,
      items: [{ productId: source.id }, { productId: source.id }],
      totalAmountCents: 10_000,
    });

    await expect(resolvePaidOrderPostPurchaseOffer(getDb(), {
      vendorId: vendor.id, orderId: order.id, kind: "upsell",
    })).resolves.toBeNull();
  });

  it("rejects a single source item whose quantity is greater than one", async () => {
    const vendor = await createVendor("Quantity");
    const { source } = await createConfiguredProducts(vendor.id);
    const order = await createPaidOrder({
      vendorId: vendor.id,
      items: [{ productId: source.id, quantity: 2 }],
      totalAmountCents: 20_000,
    });

    await expect(resolvePaidOrderPostPurchaseOffer(getDb(), {
      vendorId: vendor.id, orderId: order.id, kind: "upsell",
    })).resolves.toBeNull();
  });
});
