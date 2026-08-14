import { afterEach, describe, expect, it } from "vitest";
import { issueCheckoutAdmission, verifyCheckoutAdmission } from "@/lib/checkout-admission";
import { getDb } from "@/lib/db";
import {
  CheckoutIdempotencyConflictError,
  createReservedPaymentTransaction,
} from "@/lib/inventory-reservations";

const createdVendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

describe("checkout admission disposable PostgreSQL invariants", () => {
  it("binds one server-issued checkout identity to one durable reservation under concurrency", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const db = getDb();
    const vendor = await db.vendor.create({
      data: {
        name: `Admission Vendor ${suffix}`,
        slug: `admission-vendor-${suffix}`,
        email: `admission-${suffix}@example.test`,
        passwordHash: "disposable-test-only",
      },
    });
    createdVendorIds.push(vendor.id);
    const product = await db.product.create({
      data: {
        vendorId: vendor.id,
        name: `Admission Product ${suffix}`,
        slug: `admission-product-${suffix}`,
        priceCents: 1_200,
        inventory: 2,
        fulfillmentType: "physical",
        fulfillmentTypeConfirmed: true,
      },
    });

    const issued = issueCheckoutAdmission({
      vendorId: vendor.id,
      productId: product.id,
      productRevision: product.revision,
    });
    const binding = verifyCheckoutAdmission({
      admissionToken: issued.admissionToken,
      sessionToken: issued.sessionToken,
    });
    expect(binding).toMatchObject({
      vendorId: vendor.id,
      productId: product.id,
      productRevision: product.revision,
      idempotencyKey: issued.idempotencyKey,
    });
    if (!binding) throw new Error("Expected a valid checkout admission binding.");

    const reserve = (lane: string) => createReservedPaymentTransaction({
      vendorId: binding.vendorId,
      productId: binding.productId,
      expectedProductRevision: binding.productRevision,
      checkoutIdempotencyKey: binding.idempotencyKey,
      transactionData: {
        vendorId: binding.vendorId,
        checkoutIdempotencyKey: binding.idempotencyKey,
        providerName: "demo",
        orderNumber: `ADMISSION-${suffix}-${lane}`,
        grossAmountCents: product.priceCents,
        netAmountCents: product.priceCents,
        currency: product.currency,
        status: "pending",
        metadata: { productId: product.id },
      },
    });
    const attempts = await Promise.allSettled([reserve("a"), reserve("b")]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.any(CheckoutIdempotencyConflictError),
    });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({
      inventory: 1,
      revision: product.revision + 1,
    });
    expect(await db.paymentTransaction.count({
      where: { vendorId: vendor.id, checkoutIdempotencyKey: binding.idempotencyKey },
    })).toBe(1);
    expect(await db.inventoryReservation.count({ where: { productId: product.id } })).toBe(1);
  });
});
