import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  refundPayment: vi.fn(async () => ({ providerEventId: "same-provider-trade" })),
}));

vi.mock("@/lib/payment-providers", () => ({
  getPaymentProvider: () => ({ refundPayment: providerMocks.refundPayment }),
}));

import { getDb } from "@/lib/db";
import { createReservedPaymentTransaction, applyPaymentInventoryTransition } from "@/lib/inventory-reservations";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition } from "@/lib/commerce-orders";
import { protectProductDeliveryConfig, validateProductDeliveryDraft } from "@/lib/product-delivery";
import { executePayUniRefund } from "@/lib/payuni-refund-execution";

const db = getDb();
const suffix = randomUUID();
let vendorId = "";

beforeAll(() => {
  process.env.CSRF_SECRET = "synthetic-refund-full-flow-test-secret-32-bytes";
});

afterAll(async () => {
  // Immutable commission ledger rows live only in this disposable database.
  await db.$disconnect();
});

describe("PayUni repeated provider ID with real order accounting", () => {
  it("records both partial refunds and revokes digital access after the full refund", async () => {
    const vendor = await db.vendor.create({
      data: {
        name: `Synthetic refund ${suffix}`,
        slug: `refund-full-${suffix}`,
        email: `refund-full-${suffix}@example.test`,
        passwordHash: "synthetic",
      },
    });
    vendorId = vendor.id;
    const product = await db.product.create({
      data: {
        vendorId,
        name: "Synthetic digital refund product",
        slug: `digital-${suffix}`,
        priceCents: 1_200,
        currency: "TWD",
        inventory: 3,
        isActive: true,
        commerceDomain: "merchant",
        fulfillmentType: "digital",
      },
    });
    const delivery = validateProductDeliveryDraft({
      fulfillmentType: "digital",
      isActive: true,
      title: "Synthetic delivery",
      destinationUrl: "https://delivery.example.com/buyer/content",
      instructions: "Synthetic",
      hostConfirmed: true,
    })!;
    const allowlist = await db.vendorDeliveryUrlAllowlist.create({
      data: {
        vendorId,
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
        vendorId,
        productId: product.id,
        allowlistId: allowlist.id,
        revision: 1,
        status: "active",
        fulfillmentType: "digital",
        deliveryKind: delivery.deliveryKind,
        title: delivery.title,
        ...protectProductDeliveryConfig(delivery, { vendorId, productId: product.id, configId, revision: 1 }),
        activatedAt: new Date("2026-09-29T00:00:00.000Z"),
      },
    });
    const orderNumber = `REFUND-${suffix}`;
    const checkoutIdempotencyKey = randomUUID();
    const payment = await createReservedPaymentTransaction({
      vendorId,
      productId: product.id,
      checkoutIdempotencyKey,
      transactionData: {
        vendorId,
        checkoutIdempotencyKey,
        providerName: "payuni",
        orderNumber,
        grossAmountCents: 1_200,
        netAmountCents: 1_200,
        currency: "TWD",
        status: "pending",
        metadata: { productId: product.id },
      },
      createCommerceOrder: async (tx, transaction) => {
        await createCommerceOrderForCheckout(tx, {
          vendorId,
          productId: product.id,
          orderNumber,
          checkoutIdempotencyKey,
          paymentTransactionId: transaction.id,
          totalAmountCents: 1_200,
          currency: "TWD",
          buyer: { name: "Synthetic Buyer", email: "buyer@example.test", phone: "0912345678" },
          shipping: null,
        });
      },
    });
    const paidAt = new Date("2026-09-29T01:00:00.000Z");
    await db.$transaction(async (tx) => {
      const paid = await tx.paymentTransaction.update({
        where: { id: payment.id },
        data: { status: "paid", occurredAt: paidAt, providerTradeNo: `same-provider-trade-${suffix}` },
      });
      await applyPaymentInventoryTransition(tx, {
        transaction: paid,
        eventType: "paid",
        trustedCheckoutMetadata: { productId: product.id },
        now: paidAt,
      });
      await reconcileCommerceOrderPaymentTransition(tx, {
        vendorId,
        paymentTransactionId: paid.id,
        eventIdentity: `paid-${suffix}`,
        transition: "paid",
        occurredAt: paidAt,
      });
    });
    const order = await db.commerceOrder.findFirstOrThrow({
      where: { vendorId, primaryPaymentTransactionId: payment.id },
      include: { items: { include: { entitlement: true } } },
    });
    const entitlementId = order.items[0]?.entitlement?.id;
    expect(entitlementId).toBeTruthy();
    expect(order.items[0]?.entitlement?.status).toBe("granted");
    const commission = await db.affiliateCommission.create({
      data: {
        vendorId,
        monthKey: "2026-09",
        sourceType: "webhook",
        sourceId: payment.id,
        deduplicationKey: `synthetic-refund-${suffix}`,
        orderNumber,
        orderAmountCents: 1_200,
        commissionBaseAmountCents: 1_200,
        netReferenceAmountCents: 1_200,
        commissionRateBps: 1_000,
        commissionAmountCents: 120,
      },
    });
    await db.affiliateCommissionLedgerEntry.create({
      data: {
        vendorId,
        affiliateCommissionId: commission.id,
        entryType: "accrual",
        deduplicationKey: `synthetic-accrual-${suffix}`,
        providerName: "payuni",
        eventIdentity: `paid-${suffix}`,
        amountCents: 120,
        occurredAt: paidAt,
      },
    });

    const base = {
      db,
      transactionId: payment.id,
      gatewayFeeRefundCents: 0,
      platformFeeRefundCents: 0,
      reason: "synthetic",
      monthKey: "2026-09",
      actor: { id: "synthetic-actor", label: "synthetic" },
    };
    providerMocks.refundPayment.mockClear();
    expect((await executePayUniRefund({ ...base, refundAmountCents: 400 })).disposition).toBe("completed");
    expect((await executePayUniRefund({ ...base, refundAmountCents: 800 })).disposition).toBe("completed");

    expect(providerMocks.refundPayment).toHaveBeenCalledTimes(2);
    const after = await db.commerceOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { refunds: true, events: true },
    });
    expect(after).toMatchObject({ status: "refunded", refundedAmountCents: 1_200 });
    expect(after.refunds).toHaveLength(2);
    expect(new Set(after.refunds.map((refund) => refund.eventIdentity)).size).toBe(2);
    expect(after.events.filter((event) => event.eventType === "refund.processed")).toHaveLength(2);
    const refundLedger = await db.affiliateCommissionLedgerEntry.findMany({
      where: { vendorId, affiliateCommissionId: commission.id, entryType: "refund" },
    });
    expect(refundLedger.map((entry) => entry.amountCents).sort((a, b) => a - b)).toEqual([-80, -40]);
    expect(new Set(refundLedger.map((entry) => entry.eventIdentity)).size).toBe(2);
    await expect(db.commerceEntitlement.findUniqueOrThrow({ where: { id: entitlementId! } }))
      .resolves.toMatchObject({ status: "revoked", accessEncryptedEnvelope: null, accessMaskedSummary: null });
  });
});
