import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { createReservedPaymentTransaction, applyPaymentInventoryTransition } from "@/lib/inventory-reservations";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition } from "@/lib/commerce-orders";
import { generatePaymentOrderNumber } from "@/lib/payment-order-number";
import { protectProductDeliveryConfig, validateProductDeliveryDraft } from "@/lib/product-delivery";
import { reconcilePayUniRefund } from "@/lib/payuni-refund-reconciliation";

const db = getDb();
const suffix = randomUUID();

beforeAll(() => {
  process.env.CSRF_SECRET = "synthetic-refund-reconcile-hook-secret-32-bytes";
});

afterAll(async () => {
  // Like the full admin refund fixture, rows stay in the disposable database.
  await db.$disconnect();
});

/** A paid digital order with committed stock, like the full admin refund fixture. */
async function paidDigitalOrder() {
  const vendor = await db.vendor.create({
    data: { name: `Reconcile hook ${suffix}`, slug: `reconcile-hook-${suffix}`, email: `reconcile-hook-${suffix}@example.test`, passwordHash: "synthetic" },
  });
  const vendorId = vendor.id;
  const product = await db.product.create({
    data: {
      vendorId, name: "Synthetic reconcile product", slug: `reconcile-${suffix}`, priceCents: 1_200, currency: "TWD",
      inventory: 3, isActive: true, commerceDomain: "merchant", fulfillmentType: "digital",
    },
  });
  const delivery = validateProductDeliveryDraft({
    fulfillmentType: "digital", isActive: true, title: "Synthetic delivery",
    destinationUrl: "https://delivery.example.com/buyer/content", instructions: "Synthetic", hostConfirmed: true,
  })!;
  const allowlist = await db.vendorDeliveryUrlAllowlist.create({
    data: { vendorId, hostname: delivery.destinationHostname!, pathPrefix: delivery.destinationPathPrefix!, allowQuery: false, status: "active" },
  });
  const configId = randomUUID();
  await db.productDeliveryConfig.create({
    data: {
      id: configId, vendorId, productId: product.id, allowlistId: allowlist.id, revision: 1, status: "active",
      fulfillmentType: "digital", deliveryKind: delivery.deliveryKind, title: delivery.title,
      ...protectProductDeliveryConfig(delivery, { vendorId, productId: product.id, configId, revision: 1 }),
      activatedAt: new Date("2026-09-29T00:00:00.000Z"),
    },
  });
  const orderNumber = generatePaymentOrderNumber();
  const checkoutIdempotencyKey = randomUUID();
  const payment = await createReservedPaymentTransaction({
    vendorId, productId: product.id, checkoutIdempotencyKey,
    transactionData: {
      vendorId, checkoutIdempotencyKey, providerName: "payuni", orderNumber, grossAmountCents: 1_200, netAmountCents: 1_200,
      currency: "TWD", status: "pending", metadata: { productId: product.id },
    },
    createCommerceOrder: async (tx, transaction) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId, productId: product.id, orderNumber, checkoutIdempotencyKey, paymentTransactionId: transaction.id,
        totalAmountCents: 1_200, currency: "TWD", buyer: { name: "Synthetic Buyer", email: "buyer@example.test", phone: "0912345678" }, shipping: null,
      });
    },
  });
  const paidAt = new Date("2026-09-29T01:00:00.000Z");
  const providerTradeNo = `reconcile-trade-${suffix}`;
  await db.$transaction(async (tx) => {
    const paid = await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: "paid", occurredAt: paidAt, providerTradeNo } });
    await applyPaymentInventoryTransition(tx, { transaction: paid, eventType: "paid", trustedCheckoutMetadata: { productId: product.id }, now: paidAt });
    await reconcileCommerceOrderPaymentTransition(tx, { vendorId, paymentTransactionId: paid.id, eventIdentity: `paid-${suffix}`, transition: "paid", occurredAt: paidAt });
  });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId, primaryPaymentTransactionId: payment.id } });
  return { vendorId, product, payment, order, orderNumber, providerTradeNo };
}

describe("PayUni refund reconciliation runs the shared post-refund hook (F-045, review m-5)", () => {
  it("releases stock and voids the queued invoice when an ambiguous full refund is reconciled", async () => {
    const { vendorId, product, payment, order, orderNumber, providerTradeNo } = await paidDigitalOrder();
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).inventory).toBe(2);
    const invoice = await db.electronicInvoice.create({
      data: {
        vendorId, orderId: order.id, invoiceType: "B2C", buyerDisplay: "Synthetic Buyer", requestEncryptedEnvelope: "synthetic-envelope",
        amountCents: 1_200, pretaxAmountCents: 1_143, taxAmountCents: 57, status: "queued",
      },
    });
    // The admin refund reached PayUni with an ambiguous outcome and left this reservation.
    await db.refundRecord.create({
      data: {
        vendorId, paymentTransactionId: payment.id, monthKey: "2026-09", refundAmountCents: 1_200, status: "pending",
        providerEventId: `ambiguous:${randomBytes(16).toString("hex")}`,
      },
    });

    await expect(reconcilePayUniRefund({
      db,
      transactionId: payment.id,
      providerSnapshot: {
        providerTradeNo, orderNumber, grossAmountCents: 1_200, refundedAmountCents: 1_200, remainingRefundableAmountCents: 0, status: "refunded",
      },
      actor: { id: "synthetic-finance-admin", label: "platform_admin" },
      now: new Date("2026-09-30T00:00:00.000Z"),
    })).resolves.toMatchObject({ disposition: "reconciled", refundedAmountCents: 1_200 });

    await expect(db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: payment.id } }))
      .resolves.toMatchObject({ status: "released", releaseReason: "full_refund" });
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).inventory).toBe(3);
    await expect(db.electronicInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({ status: "voided" });
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({ status: "refunded", refundedAmountCents: 1_200 });
  });
});
