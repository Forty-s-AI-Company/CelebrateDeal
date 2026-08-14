import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  applyPaymentInventoryTransition,
  createReservedPaymentTransaction,
} from "@/lib/inventory-reservations";
import {
  createCommerceOrderForCheckout,
  reconcileCommerceOrderPaymentTransition,
  reconcileCommerceOrderRefund,
} from "@/lib/commerce-orders";
import { transitionShippingFulfillment } from "@/lib/commerce-order-fulfillment";
import { applyPaymentRefundAccounting } from "@/lib/payment-refund-accounting";
import { protectProductDeliveryConfig, validateProductDeliveryDraft } from "@/lib/product-delivery";

const vendorIds: string[] = [];
const buyer = { name: "測試買家", email: "buyer@example.test", phone: "0912345678" };
const shipping = {
  recipientName: "測試買家",
  phone: "0912345678",
  countryCode: "TW",
  postalCode: "100",
  administrativeArea: "台北市",
  locality: "中正區",
  addressLine1: "合成測試路 1 號",
};

beforeAll(() => {
  process.env.CSRF_SECRET = "g7-48-commerce-db-test-secret-32-bytes";
});

async function createVendor() {
  const suffix = randomUUID();
  const vendor = await getDb().vendor.create({
    data: {
      name: `G7 Commerce ${suffix}`,
      slug: `g7-commerce-${suffix}`,
      email: `g7-commerce-${suffix}@example.test`,
      passwordHash: "synthetic-test-hash",
    },
  });
  vendorIds.push(vendor.id);
  return vendor;
}

async function createCheckoutFixture(fulfillmentType: "physical" | "digital") {
  const db = getDb();
  const vendor = await createVendor();
  const product = await db.product.create({
    data: {
      vendorId: vendor.id,
      name: `${fulfillmentType} synthetic product`,
      slug: `${fulfillmentType}-${randomUUID()}`,
      priceCents: 1_200,
      currency: "TWD",
      inventory: 3,
      isActive: true,
      commerceDomain: "merchant",
      fulfillmentType,
    },
  });
  if (fulfillmentType === "digital") {
    const delivery = validateProductDeliveryDraft({
      fulfillmentType,
      isActive: true,
      title: "合成測試下載",
      destinationUrl: "https://delivery.example.com/buyer/content",
      instructions: "付款後請從訂單頁取得內容。",
      hostConfirmed: true,
    })!;
    const allowlist = await db.vendorDeliveryUrlAllowlist.create({
      data: {
        vendorId: vendor.id,
        hostname: delivery.destinationHostname!,
        pathPrefix: delivery.destinationPathPrefix!,
        allowQuery: false,
        status: "active",
      },
    });
    const configId = randomUUID();
    await db.productDeliveryConfig.create({
      data: {
        id: configId,
        vendorId: vendor.id,
        productId: product.id,
        allowlistId: allowlist.id,
        revision: 1,
        status: "active",
        fulfillmentType,
        deliveryKind: delivery.deliveryKind,
        title: delivery.title,
        ...protectProductDeliveryConfig(delivery, {
          vendorId: vendor.id,
          productId: product.id,
          configId,
          revision: 1,
        }),
        activatedAt: new Date("2026-08-08T08:00:00.000Z"),
      },
    });
  }
  const orderNumber = `G7-${randomUUID()}`;
  const checkoutIdempotencyKey = randomUUID();
  const transaction = await createReservedPaymentTransaction({
    vendorId: vendor.id,
    productId: product.id,
    checkoutIdempotencyKey,
    transactionData: {
      vendorId: vendor.id,
      checkoutIdempotencyKey,
      providerName: "demo",
      orderNumber,
      grossAmountCents: product.priceCents,
      netAmountCents: product.priceCents,
      currency: product.currency,
      status: "pending",
      metadata: { productId: product.id },
    },
    createCommerceOrder: async (tx, payment) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId: vendor.id,
        productId: product.id,
        orderNumber,
        checkoutIdempotencyKey,
        paymentTransactionId: payment.id,
        totalAmountCents: product.priceCents,
        currency: product.currency,
        buyer,
        shipping: fulfillmentType === "physical" ? shipping : null,
      });
    },
  });
  return { db, vendor, product, orderNumber, checkoutIdempotencyKey, transaction };
}

async function markPaid(fixture: Awaited<ReturnType<typeof createCheckoutFixture>>, eventIdentity: string) {
  const now = new Date("2026-08-08T11:00:00.000Z");
  await fixture.db.$transaction(async (tx) => {
    const transaction = await tx.paymentTransaction.update({
      where: { id: fixture.transaction.id },
      data: { status: "paid", occurredAt: now },
    });
    await applyPaymentInventoryTransition(tx, {
      transaction,
      eventType: "paid",
      trustedCheckoutMetadata: { productId: fixture.product.id },
      now,
    });
    await reconcileCommerceOrderPaymentTransition(tx, {
      vendorId: fixture.vendor.id,
      paymentTransactionId: transaction.id,
      eventIdentity,
      transition: "paid",
      occurredAt: now,
    });
  });
}

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

describe("G7 commerce order disposable PostgreSQL", () => {
  it("atomically persists payment, inventory, encrypted order snapshot and the correct fulfillment", async () => {
    const fixture = await createCheckoutFixture("physical");
    const order = await fixture.db.commerceOrder.findUniqueOrThrow({
      where: { vendorId_checkoutIdempotencyKey: { vendorId: fixture.vendor.id, checkoutIdempotencyKey: fixture.checkoutIdempotencyKey } },
      include: { items: { include: { shippingFulfillment: true, entitlement: true, serviceFulfillment: true } } },
    });
    expect(order).toMatchObject({ status: "pending_payment", totalAmountCents: 1_200, buyerMaskedName: expect.stringContaining("＊") });
    expect(order.items).toHaveLength(1);
    expect(order.items[0]?.shippingFulfillment).toMatchObject({ status: "pending", revision: 1 });
    expect(order.items[0]?.entitlement).toBeNull();
    expect(JSON.stringify(order)).not.toContain(buyer.email);
    expect(JSON.stringify(order)).not.toContain(shipping.addressLine1);
    expect(await fixture.db.product.findUniqueOrThrow({ where: { id: fixture.product.id } })).toMatchObject({ inventory: 2 });
    expect(await fixture.db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: fixture.transaction.id } })).toMatchObject({ status: "reserved" });
  });

  it("rolls back stock and payment when canonical order creation fails", async () => {
    const db = getDb();
    const vendor = await createVendor();
    const product = await db.product.create({
      data: { vendorId: vendor.id, name: "rollback product", slug: `rollback-${randomUUID()}`, priceCents: 900, inventory: 1 },
    });
    const orderNumber = `ROLLBACK-${randomUUID()}`;
    await expect(createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      transactionData: { vendorId: vendor.id, providerName: "demo", orderNumber, grossAmountCents: 900, netAmountCents: 900, status: "pending" },
      createCommerceOrder: async () => { throw new Error("synthetic-order-write-failure"); },
    })).rejects.toThrow("synthetic-order-write-failure");
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 1 });
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id, orderNumber } })).toBe(0);
    expect(await db.inventoryReservation.count({ where: { vendorId: vendor.id, productId: product.id } })).toBe(0);
    expect(await db.commerceOrder.count({ where: { vendorId: vendor.id, orderNumber } })).toBe(0);
  });

  it("converges a verified payment to a granted digital entitlement exactly once", async () => {
    const fixture = await createCheckoutFixture("digital");
    await markPaid(fixture, "paid-event-1");
    await markPaid(fixture, "paid-event-1");

    const order = await fixture.db.commerceOrder.findFirstOrThrow({
      where: { vendorId: fixture.vendor.id, primaryPaymentTransactionId: fixture.transaction.id },
      include: { items: { include: { entitlement: true, deliverySnapshot: true } }, events: true },
    });
    expect(order).toMatchObject({ status: "paid", paidAmountCents: 1_200 });
    expect(order.items[0]?.entitlement).toMatchObject({ status: "granted", revision: 2, accessEncryptedEnvelope: expect.stringMatching(/^v1\./u) });
    expect(order.items[0]?.deliverySnapshot).toMatchObject({
      deliveryKind: "digital_link",
      destinationEncryptedEnvelope: expect.stringMatching(/^v1\./u),
      destinationMaskedSummary: "安全 HTTPS 入口 · delivery.example.com",
    });
    expect(JSON.stringify(order.items[0]?.deliverySnapshot)).not.toContain("https://delivery.example.com/buyer/content");
    expect(order.events.filter((event) => event.eventType === "payment.paid")).toHaveLength(1);
    expect(await fixture.db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: fixture.transaction.id } })).toMatchObject({ status: "committed" });
  });

  it("revokes a fully refunded digital entitlement and destroys its access capability", async () => {
    const fixture = await createCheckoutFixture("digital");
    await markPaid(fixture, "paid-event-revocation");
    const order = await fixture.db.commerceOrder.findFirstOrThrow({
      where: { vendorId: fixture.vendor.id, primaryPaymentTransactionId: fixture.transaction.id },
      include: { items: { include: { entitlement: true } } },
    });
    const entitlement = order.items[0]?.entitlement;
    expect(entitlement).toMatchObject({ status: "granted", grantedAt: expect.any(Date) });
    await expect(fixture.db.commerceEntitlement.update({
      where: { id: entitlement!.id },
      data: { grantedAt: null },
    })).rejects.toThrow();

    const occurredAt = new Date("2026-08-08T12:30:00.000Z");
    await fixture.db.$transaction((tx) => reconcileCommerceOrderRefund(tx, {
      vendorId: fixture.vendor.id,
      orderId: order.id,
      providerName: "demo",
      eventIdentity: "digital-full-refund",
      amountCents: order.totalAmountCents,
      paymentTransactionId: fixture.transaction.id,
      occurredAt,
    }));

    await expect(fixture.db.commerceEntitlement.findUniqueOrThrow({ where: { id: entitlement!.id } }))
      .resolves.toMatchObject({
        status: "revoked",
        revokedAt: occurredAt,
        accessEncryptedEnvelope: null,
        accessMaskedSummary: null,
      });
  });

  it("reconciles partial and full refunds and cancels unfulfilled physical delivery", async () => {
    const fixture = await createCheckoutFixture("physical");
    await markPaid(fixture, "paid-event-refund");
    const occurredAt = new Date("2026-08-08T12:00:00.000Z");

    const applyRefund = async (amountCents: number, eventIdentity: string, cumulative: number) => fixture.db.$transaction(async (tx) => {
      const refundRecord = await tx.refundRecord.create({
        data: {
          vendorId: fixture.vendor.id,
          paymentTransactionId: fixture.transaction.id,
          providerEventId: eventIdentity,
          monthKey: "2026-08",
          refundAmountCents: amountCents,
          status: "processed",
        },
      });
      await tx.paymentTransaction.update({
        where: { id: fixture.transaction.id },
        data: { status: cumulative === 1_200 ? "refunded" : "partially_refunded", refundedAmountCents: cumulative, refundedAt: occurredAt },
      });
      return applyPaymentRefundAccounting(tx, {
        vendorId: fixture.vendor.id,
        transactionId: fixture.transaction.id,
        orderNumber: fixture.orderNumber,
        providerName: "demo",
        eventIdentity,
        refundRecordId: refundRecord.id,
        refundAmountCents: amountCents,
        netReferenceAmountCents: 1_200 - cumulative,
        isFullRefund: cumulative === 1_200,
        transactionOccurredAt: occurredAt,
        occurredAt,
      });
    });

    await applyRefund(400, "refund-partial", 400);
    expect(await fixture.db.commerceOrder.findFirstOrThrow({ where: { vendorId: fixture.vendor.id, primaryPaymentTransactionId: fixture.transaction.id } })).toMatchObject({ status: "partially_refunded", refundedAmountCents: 400 });
    await applyRefund(800, "refund-full", 1_200);
    const order = await fixture.db.commerceOrder.findFirstOrThrow({
      where: { vendorId: fixture.vendor.id, primaryPaymentTransactionId: fixture.transaction.id },
      include: { items: { include: { shippingFulfillment: true } }, refunds: true },
    });
    expect(order).toMatchObject({ status: "refunded", refundedAmountCents: 1_200 });
    expect(order.items[0]?.shippingFulfillment).toMatchObject({ status: "cancelled", revision: 2 });
    expect(order.refunds).toHaveLength(2);
  });

  it("keeps a shipped full-refund parcel resolvable and auditable", async () => {
    const fixture = await createCheckoutFixture("physical");
    await markPaid(fixture, "paid-event-shipped-refund");
    const shippedAt = new Date("2026-08-08T11:30:00.000Z");
    const refundedAt = new Date("2026-08-08T12:00:00.000Z");
    const returnedAt = new Date("2026-08-08T13:00:00.000Z");
    const initial = await fixture.db.commerceOrder.findFirstOrThrow({
      where: { vendorId: fixture.vendor.id, primaryPaymentTransactionId: fixture.transaction.id },
      include: { items: { include: { shippingFulfillment: true } } },
    });
    const shippingFulfillment = initial.items[0]?.shippingFulfillment;
    expect(shippingFulfillment).not.toBeNull();

    await fixture.db.$transaction((tx) => transitionShippingFulfillment(tx, {
      vendorId: fixture.vendor.id,
      fulfillmentId: shippingFulfillment!.id,
      expectedRevision: 1,
      nextStatus: "shipped",
      carrierName: "合成物流",
      trackingNumber: "SYNTHETIC-1234",
      actor: { id: "synthetic-member" },
      now: shippedAt,
    }));
    await fixture.db.$transaction((tx) => reconcileCommerceOrderRefund(tx, {
      vendorId: fixture.vendor.id,
      orderId: initial.id,
      providerName: "demo",
      eventIdentity: "refund-shipped-full",
      amountCents: 1_200,
      paymentTransactionId: fixture.transaction.id,
      occurredAt: refundedAt,
    }));

    const awaitingResolution = await fixture.db.commerceOrder.findUniqueOrThrow({
      where: { id: initial.id },
      include: { items: { include: { shippingFulfillment: true } }, events: true },
    });
    expect(awaitingResolution).toMatchObject({ status: "refunded", refundedAmountCents: 1_200 });
    expect(awaitingResolution.items[0]?.shippingFulfillment).toMatchObject({
      status: "refund_review",
      revision: 3,
      shippedAt,
      refundReviewAt: refundedAt,
      cancelledAt: null,
    });
    const refundEvent = awaitingResolution.events.find((event) => event.eventType === "refund.processed");
    expect(refundEvent?.sanitizedData).toMatchObject({
      fulfillmentConvergence: expect.objectContaining({ shippingRefundReviewCount: 1 }),
    });

    await fixture.db.$transaction((tx) => transitionShippingFulfillment(tx, {
      vendorId: fixture.vendor.id,
      fulfillmentId: shippingFulfillment!.id,
      expectedRevision: 3,
      nextStatus: "returned",
      actor: { id: "synthetic-member" },
      now: returnedAt,
    }));
    await expect(fixture.db.shippingFulfillment.findUniqueOrThrow({ where: { id: shippingFulfillment!.id } }))
      .resolves.toMatchObject({ status: "returned", revision: 4, returnedAt, shippedAt });
    await expect(fixture.db.commerceOrderEvent.findFirstOrThrow({
      where: { vendorId: fixture.vendor.id, orderId: initial.id, eventType: "fulfillment.shipping.returned" },
    })).resolves.toMatchObject({ occurredAt: returnedAt });
  });

  it("enforces refund totals and fulfillment type invariants in PostgreSQL", async () => {
    const fixture = await createCheckoutFixture("physical");
    await markPaid(fixture, "paid-event-constraints");
    const order = await fixture.db.commerceOrder.findFirstOrThrow({
      where: { vendorId: fixture.vendor.id, primaryPaymentTransactionId: fixture.transaction.id },
      include: { items: true },
    });
    await expect(fixture.db.commerceOrderRefund.create({
      data: {
        vendorId: fixture.vendor.id,
        orderId: order.id,
        paymentTransactionId: fixture.transaction.id,
        providerName: "demo",
        eventIdentity: "over-refund",
        amountCents: 1,
        cumulativeAmountCents: 1_201,
        occurredAt: new Date(),
      },
    })).rejects.toThrow();
    await expect(fixture.db.serviceFulfillment.create({
      data: { vendorId: fixture.vendor.id, orderItemId: order.items[0]!.id, status: "pending" },
    })).rejects.toThrow();
  });
});
