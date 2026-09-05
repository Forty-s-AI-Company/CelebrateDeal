import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/commerce-order-pii", () => ({
  protectCommerceOrderPii: vi.fn(() => ({
    buyerEncrypted: "sealed-buyer",
    shippingEncrypted: "sealed-shipping",
    buyerNameMasked: "王＊＊",
    buyerEmailMasked: "w***@example.com",
    buyerPhoneMasked: "****1234",
    shippingSummaryMasked: "TW · Taipei · Da-an · …",
    checkoutIdentityHash: "opaque-checkout-identity",
  })),
}));
vi.mock("@/lib/commerce-entitlement-access", () => ({
  protectCommerceEntitlementAccess: vi.fn(() => ({
    accessEncryptedEnvelope: "sealed-entitlement-access",
    accessMaskedSummary: "安全授權 · ment-1",
  })),
}));
vi.mock("@/lib/product-delivery", () => ({
  revealProductDeliveryConfig: vi.fn((config: { destinationEncryptedEnvelope: string | null }) => ({
    destinationUrl: config.destinationEncryptedEnvelope ? "https://delivery.example.com/buyer/content" : null,
    instructions: "安全交付說明",
  })),
  parsePublicHttpsDeliveryUrl: vi.fn(() => ({
    url: "https://delivery.example.com/buyer/content",
    hostname: "delivery.example.com",
    pathPrefix: "/buyer/content",
  })),
  protectOrderItemDeliverySnapshot: vi.fn((delivery: { destinationUrl: string | null }) => ({
    destinationEncryptedEnvelope: delivery.destinationUrl ? "sealed-delivery-destination" : null,
    instructionsEncryptedEnvelope: "sealed-delivery-instructions",
  })),
}));

import {
  CommerceOrderConflictError,
  CommerceOrderValidationError,
  createCommerceOrderForCheckout,
  expireCommerceOrderForPayment,
  reconcileCommerceOrderPaymentTransition,
  reconcileCommerceOrderRefund,
  reconcileCommerceOrderRefundForPayment,
} from "./commerce-orders";
import { createCustomCheckoutIdentityHash } from "./commerce-custom-checkout";

const now = new Date("2026-08-08T08:00:00.000Z");

function transaction() {
  return {
    product: { findFirst: vi.fn() },
    commerceOrder: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    commerceOrderItem: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    commerceOrderEvent: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    commerceOrderRefund: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    shippingFulfillment: { create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    commerceEntitlement: { create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    serviceFulfillment: { create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    commerceOrderItemDeliverySnapshot: { create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

function product(fulfillmentType: "physical" | "digital" | "service" | "course") {
  return {
    id: "product-1",
    name: "安全商品",
    slug: "safe-product",
    priceCents: 1_200,
    currency: "TWD",
    imageUrl: "https://example.com/product.png",
    commerceDomain: fulfillmentType === "course" ? "course" : "merchant",
    fulfillmentType,
    courseContentOwnerMembershipId: fulfillmentType === "course" ? "membership-f" : null,
    coursePromoterShareBps: fulfillmentType === "course" ? 2_000 : null,
    coursePolicyVersion: 3,
    deliveryConfig: fulfillmentType === "physical" ? null : {
      id: "delivery-config-1",
      revision: 2,
      status: "active",
      fulfillmentType,
      deliveryKind: fulfillmentType === "digital" ? "digital_link" : fulfillmentType === "course" ? "course_portal" : "service_instructions",
      title: "安全交付",
      destinationEncryptedEnvelope: fulfillmentType === "service" ? null : "sealed-config-destination",
      destinationMaskedSummary: fulfillmentType === "service" ? null : "安全 HTTPS 入口 · delivery.example.com",
      instructionsEncryptedEnvelope: "sealed-config-instructions",
      instructionsMaskedSummary: "已設定 6 字交付說明",
      allowlist: fulfillmentType === "service" ? null : {
        hostname: "delivery.example.com",
        pathPrefix: "/buyer/content",
        allowQuery: false,
        status: "active",
      },
    },
  };
}

function order(status: "pending_payment" | "payment_failed" | "expired" | "cancelled" | "paid" | "partially_refunded" | "refunded" = "paid") {
  return {
    id: "order-1",
    vendorId: "vendor-1",
    status,
    totalAmountCents: 1_200,
    paidAmountCents: status === "pending_payment" || status === "payment_failed" || status === "expired" || status === "cancelled" ? 0 : 1_200,
    refundedAmountCents: status === "partially_refunded" ? 300 : status === "refunded" ? 1_200 : 0,
    primaryPaymentTransactionId: "payment-1",
  };
}

const checkoutInput = {
  vendorId: "vendor-1",
  productId: "product-1",
  orderNumber: "CD-20260808-1",
  checkoutIdempotencyKey: "checkout-1",
  paymentTransactionId: "payment-1",
  totalAmountCents: 1_200,
  currency: "TWD",
  buyer: { name: "王小明", email: "buyer@example.com", phone: "0912345678" },
  shipping: {
    recipientName: "王小明",
    phone: "0912345678",
    countryCode: "TW",
    postalCode: "106",
    administrativeArea: "Taipei",
    locality: "Da-an",
    addressLine1: "秘密路 100 號",
  },
  now,
} as const;

describe("commerce orders database service", () => {
  it("persists a server-authorized voucher as subtotal minus discount while preserving the product line price", async () => {
    const tx = transaction();
    tx.product.findFirst.mockResolvedValue(product("physical"));

    await createCommerceOrderForCheckout(tx as never, {
      ...checkoutInput,
      totalAmountCents: 1_000,
      discountAmountCents: 200,
    });

    expect(tx.commerceOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ subtotalAmountCents: 1_200, totalAmountCents: 1_000 }),
    }));
    expect(tx.commerceOrderItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        unitPriceCents: 1_200,
        lineTotalCents: 1_200,
        nonSensitiveSnapshot: expect.objectContaining({ discountAmountCents: 200 }),
      }),
    }));
  });

  it("rejects browser-shaped discounts that make the order free or do not reconcile", async () => {
    const tx = transaction();
    tx.product.findFirst.mockResolvedValue(product("physical"));
    await expect(createCommerceOrderForCheckout(tx as never, {
      ...checkoutInput,
      totalAmountCents: 0,
      discountAmountCents: 1_200,
    })).rejects.toBeInstanceOf(CommerceOrderValidationError);
    expect(tx.commerceOrder.create).not.toHaveBeenCalled();
  });

  it.each(["physical", "digital", "service", "course"] as const)("creates a sanitized %s fulfillment placeholder", async (fulfillmentType) => {
    const tx = transaction();
    tx.product.findFirst.mockResolvedValue(product(fulfillmentType));

    await createCommerceOrderForCheckout(tx as never, checkoutInput);

    expect(tx.commerceOrder.create).toHaveBeenCalledOnce();
    expect(tx.commerceOrderItem.create).toHaveBeenCalledOnce();
    expect(tx.commerceOrderEvent.create).toHaveBeenCalledOnce();
    expect(tx.shippingFulfillment.create).toHaveBeenCalledTimes(fulfillmentType === "physical" ? 1 : 0);
    expect(tx.commerceEntitlement.create).toHaveBeenCalledTimes(fulfillmentType === "digital" || fulfillmentType === "course" ? 1 : 0);
    expect(tx.serviceFulfillment.create).toHaveBeenCalledTimes(fulfillmentType === "service" ? 1 : 0);
    expect(tx.commerceOrderItemDeliverySnapshot.create).toHaveBeenCalledTimes(fulfillmentType === "physical" ? 0 : 1);
    const prismaCreateCalls = [
      ...tx.commerceOrder.create.mock.calls,
      ...tx.commerceOrderItem.create.mock.calls,
      ...tx.commerceOrderEvent.create.mock.calls,
      ...tx.shippingFulfillment.create.mock.calls,
      ...tx.commerceEntitlement.create.mock.calls,
      ...tx.serviceFulfillment.create.mock.calls,
      ...tx.commerceOrderItemDeliverySnapshot.create.mock.calls,
    ];
    const persisted = JSON.stringify(prismaCreateCalls);
    expect(persisted).not.toContain("buyer@example.com");
    expect(persisted).not.toContain("秘密路");
    expect(persisted).toContain("sealed-buyer");
    if (fulfillmentType === "digital" || fulfillmentType === "course") {
      expect(tx.commerceEntitlement.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          accessEncryptedEnvelope: "sealed-entitlement-access",
          accessMaskedSummary: "安全授權 · ment-1",
        }),
      }));
    }
    if (fulfillmentType === "course") {
      expect(tx.commerceOrderItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        nonSensitiveSnapshot: expect.objectContaining({
          coursePolicySnapshot: { productId: "product-1", contentOwnerMembershipId: "membership-f", promoterShareBps: 2_000, policyVersion: 3 },
        }),
      }) }));
    }
    if (fulfillmentType !== "physical") {
      expect(tx.commerceOrderItemDeliverySnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fulfillmentType,
          destinationEncryptedEnvelope: fulfillmentType === "service" ? null : "sealed-delivery-destination",
          instructionsEncryptedEnvelope: "sealed-delivery-instructions",
          title: "安全交付",
        }),
      });
      const snapshotCreate = tx.commerceOrderItemDeliverySnapshot.create.mock.calls[0]?.[0];
      if (fulfillmentType === "service") {
        expect(snapshotCreate?.data).not.toHaveProperty("allowlistSnapshot");
      } else {
        expect(snapshotCreate?.data).toHaveProperty("allowlistSnapshot", {
          hostname: "delivery.example.com",
          pathPrefix: "/buyer/content",
          allowQuery: false,
        });
      }
      expect(persisted).not.toContain("https://delivery.example.com/buyer/content");
      expect(persisted).not.toContain("安全交付說明");
    }
  });

  it("recomputes the checkout identity from transaction-validated custom answers without persisting plaintext", async () => {
    vi.stubEnv("CSRF_SECRET", "commerce-orders-test-secret-that-is-at-least-32-bytes");
    const tx = transaction();
    const customCheckoutFields = [{ key: "engraving", label: "刻字內容", type: "text" as const, required: true }];
    tx.product.findFirst.mockResolvedValue({ ...product("physical"), customCheckoutFields });

    await createCommerceOrderForCheckout(tx as never, {
      ...checkoutInput,
      customCheckoutAnswers: { engraving: "生日快樂" },
    });

    const orderData = tx.commerceOrder.create.mock.calls[0]?.[0]?.data;
    expect(orderData.checkoutIdentityHash).toBe(createCustomCheckoutIdentityHash({
      vendorId: "vendor-1",
      productId: "product-1",
      basePiiHash: "opaque-checkout-identity",
      definitions: customCheckoutFields,
      answers: { engraving: "生日快樂" },
    }));
    expect(orderData.checkoutIdentityHash).not.toBe("opaque-checkout-identity");
    expect(JSON.stringify(tx.commerceOrder.create.mock.calls)).not.toContain("生日快樂");
    vi.unstubAllEnvs();
  });

  it("fails before creating an order when a non-physical product lacks active delivery configuration", async () => {
    const tx = transaction();
    tx.product.findFirst.mockResolvedValue({ ...product("digital"), deliveryConfig: null });

    await expect(createCommerceOrderForCheckout(tx as never, checkoutInput))
      .rejects.toThrow("Product delivery is not configured");
    expect(tx.commerceOrder.create).not.toHaveBeenCalled();
    expect(tx.commerceOrderItemDeliverySnapshot.create).not.toHaveBeenCalled();
  });

  it("fails before creating an order when the confirmed allowlist no longer matches", async () => {
    const tx = transaction();
    const unsafe = product("course");
    tx.product.findFirst.mockResolvedValue({
      ...unsafe,
      deliveryConfig: {
        ...unsafe.deliveryConfig!,
        allowlist: { hostname: "foreign.example.com", pathPrefix: "/buyer/content", allowQuery: false, status: "active" },
      },
    });

    await expect(createCommerceOrderForCheckout(tx as never, checkoutInput))
      .rejects.toThrow("allowlist does not match");
    expect(tx.commerceOrder.create).not.toHaveBeenCalled();
  });

  it("rejects a product that claims a course domain without course fulfillment", async () => {
    const tx = transaction();
    tx.product.findFirst.mockResolvedValue({ ...product("physical"), commerceDomain: "course" });
    await expect(createCommerceOrderForCheckout(tx as never, checkoutInput)).rejects.toBeInstanceOf(CommerceOrderValidationError);
    expect(tx.commerceOrder.create).not.toHaveBeenCalled();
  });

  it("accepts a late paid event from expired and records only sanitized transition data", async () => {
    const tx = transaction();
    tx.commerceOrder.findFirst.mockResolvedValue(order("expired"));
    tx.commerceOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.commerceOrderItem.findMany.mockResolvedValue([{ id: "digital-item-1" }]);
    tx.commerceEntitlement.updateMany.mockResolvedValue({ count: 1 });

    await expect(reconcileCommerceOrderPaymentTransition(tx as never, {
      vendorId: "vendor-1", paymentTransactionId: "payment-1", eventIdentity: "provider-paid-1", transition: "paid", occurredAt: now,
    })).resolves.toMatchObject({ changed: true, status: "paid" });
    expect(tx.commerceOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "paid", paidAmountCents: 1_200 }),
    }));
    expect(tx.commerceOrderEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sanitizedData: expect.objectContaining({ paymentTransactionId: "payment-1", grantedEntitlementCount: 1 }) }),
    }));
    expect(tx.commerceEntitlement.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "granted", revision: { increment: 1 } }),
    }));
  });

  it("fails closed for cancelled to paid and does not downgrade paid on failed", async () => {
    const cancelledTx = transaction();
    cancelledTx.commerceOrder.findFirst.mockResolvedValue(order("cancelled"));
    await expect(reconcileCommerceOrderPaymentTransition(cancelledTx as never, {
      vendorId: "vendor-1", paymentTransactionId: "payment-1", eventIdentity: "cancelled-paid", transition: "paid",
    })).rejects.toBeInstanceOf(CommerceOrderValidationError);
    expect(cancelledTx.commerceOrder.updateMany).not.toHaveBeenCalled();

    const paidTx = transaction();
    paidTx.commerceOrder.findFirst.mockResolvedValue(order("paid"));
    await expect(reconcileCommerceOrderPaymentTransition(paidTx as never, {
      vendorId: "vendor-1", paymentTransactionId: "payment-1", eventIdentity: "late-failed", transition: "failed",
    })).resolves.toMatchObject({ changed: false, status: "paid" });
    expect(paidTx.commerceOrder.updateMany).not.toHaveBeenCalled();
  });

  it("leaves legacy payment events and paid order expiry untouched", async () => {
    const legacyTx = transaction();
    legacyTx.commerceOrder.findFirst.mockResolvedValue(null);
    await expect(reconcileCommerceOrderPaymentTransition(legacyTx as never, {
      vendorId: "vendor-1", paymentTransactionId: "legacy-payment", eventIdentity: "legacy", transition: "paid",
    })).resolves.toBeNull();

    const paidTx = transaction();
    paidTx.commerceOrder.findFirst.mockResolvedValue(order("paid"));
    await expect(expireCommerceOrderForPayment(paidTx as never, {
      vendorId: "vendor-1", paymentTransactionId: "payment-1", eventIdentity: "expire-paid", occurredAt: now,
    })).resolves.toMatchObject({ changed: false, status: "paid" });
    expect(paidTx.commerceOrder.updateMany).not.toHaveBeenCalled();
  });

  it("treats an identical refund identity as a retry and rejects mismatched immutable data", async () => {
    const retryTx = transaction();
    retryTx.commerceOrderRefund.findUnique.mockResolvedValue({ id: "refund-1", orderId: "order-1", paymentTransactionId: "payment-1", amountCents: 300, refundRecordId: "record-1" });
    await expect(reconcileCommerceOrderRefund(retryTx as never, {
      vendorId: "vendor-1", orderId: "order-1", providerName: "payuni", eventIdentity: "refund-event", amountCents: 300, refundRecordId: "record-1", occurredAt: now,
    })).resolves.toMatchObject({ changed: false, refundId: "refund-1" });
    expect(retryTx.commerceOrder.updateMany).not.toHaveBeenCalled();

    const mismatchTx = transaction();
    mismatchTx.commerceOrderRefund.findUnique.mockResolvedValue({ id: "refund-1", orderId: "order-1", paymentTransactionId: "payment-1", amountCents: 300, refundRecordId: "record-1" });
    await expect(reconcileCommerceOrderRefund(mismatchTx as never, {
      vendorId: "vendor-1", orderId: "order-1", providerName: "payuni", eventIdentity: "refund-event", amountCents: 400, refundRecordId: "record-1", occurredAt: now,
    })).rejects.toBeInstanceOf(CommerceOrderValidationError);

    const crossOrderTx = transaction();
    crossOrderTx.commerceOrderRefund.findUnique.mockResolvedValue({ id: "refund-1", orderId: "another-order", paymentTransactionId: "payment-2", amountCents: 300, refundRecordId: "record-1" });
    await expect(reconcileCommerceOrderRefund(crossOrderTx as never, {
      vendorId: "vendor-1", orderId: "order-1", providerName: "payuni", eventIdentity: "refund-event", amountCents: 300, refundRecordId: "record-1", occurredAt: now,
    })).rejects.toBeInstanceOf(CommerceOrderValidationError);
  });

  it("resolves a canonical order from the trusted payment identity and leaves legacy payments alone", async () => {
    const tx = transaction();
    tx.commerceOrder.findFirst.mockResolvedValueOnce(order("paid"));
    tx.commerceOrder.findUnique.mockResolvedValueOnce(order("paid"));
    tx.commerceOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(reconcileCommerceOrderRefundForPayment(tx as never, {
      vendorId: "vendor-1",
      paymentTransactionId: "payment-1",
      providerName: "payuni",
      eventIdentity: "refund-by-payment",
      amountCents: 300,
      occurredAt: now,
    })).resolves.toMatchObject({ orderId: "order-1", changed: true });

    const legacyTx = transaction();
    legacyTx.commerceOrder.findFirst.mockResolvedValue(null);
    await expect(reconcileCommerceOrderRefundForPayment(legacyTx as never, {
      vendorId: "vendor-1",
      paymentTransactionId: "legacy-payment",
      providerName: "payuni",
      eventIdentity: "legacy-refund",
      amountCents: 300,
      occurredAt: now,
    })).resolves.toBeNull();
  });

  it("rejects over-refunds before the guarded write and surfaces a CAS conflict", async () => {
    const overRefundTx = transaction();
    overRefundTx.commerceOrder.findUnique.mockResolvedValue(order("paid"));
    await expect(reconcileCommerceOrderRefund(overRefundTx as never, {
      vendorId: "vendor-1", orderId: "order-1", providerName: "payuni", eventIdentity: "too-much", amountCents: 1_201, occurredAt: now,
    })).rejects.toBeInstanceOf(Error);
    expect(overRefundTx.commerceOrder.updateMany).not.toHaveBeenCalled();

    const conflictTx = transaction();
    conflictTx.commerceOrder.findUnique.mockResolvedValue(order("paid"));
    conflictTx.commerceOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(reconcileCommerceOrderRefund(conflictTx as never, {
      vendorId: "vendor-1", orderId: "order-1", providerName: "payuni", eventIdentity: "cas-conflict", amountCents: 300, occurredAt: now,
    })).rejects.toBeInstanceOf(CommerceOrderConflictError);
    expect(conflictTx.commerceOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ refundedAmountCents: 0 }),
    }));
  });

  it.each([
    ["entitlement", "commerceEntitlement", ["pending", "granted"], "revoked"],
    ["shipping", "shippingFulfillment", ["pending", "packing"], "cancelled"],
    ["service", "serviceFulfillment", ["pending", "scheduling", "scheduled"], "cancelled"],
  ] as const)("converges %s fulfillment on a full refund", async (_name, delegate, expectedStatuses, expectedStatus) => {
    const tx = transaction();
    tx.commerceOrder.findUnique.mockResolvedValue(order("paid"));
    tx.commerceOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.commerceOrderItem.findMany.mockResolvedValue([{ id: "item-1" }]);
    tx.commerceOrderItemDeliverySnapshot.updateMany.mockResolvedValue({ count: 1 });

    await expect(reconcileCommerceOrderRefund(tx as never, {
      vendorId: "vendor-1", orderId: "order-1", providerName: "payuni", eventIdentity: `full-${delegate}`, amountCents: 1_200, occurredAt: now,
    })).resolves.toMatchObject({ changed: true, status: "refunded" });
    expect(tx[delegate].updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: expectedStatuses } }),
      data: expect.objectContaining({ status: expectedStatus, revision: { increment: 1 } }),
    }));
    expect(tx.commerceOrderItemDeliverySnapshot.updateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", orderId: "order-1", orderItemId: { in: ["item-1"] }, revokedAt: null },
      data: { revokedAt: now },
    });
    if (delegate === "commerceEntitlement") {
      expect(tx.commerceEntitlement.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ accessEncryptedEnvelope: null, accessMaskedSummary: null }),
      }));
    }
  });

  it("moves shipped parcels to refund review and records aggregate convergence evidence", async () => {
    const tx = transaction();
    tx.commerceOrder.findUnique.mockResolvedValue(order("paid"));
    tx.commerceOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.commerceOrderItem.findMany.mockResolvedValue([{ id: "item-1" }]);
    tx.commerceOrderItemDeliverySnapshot.updateMany.mockResolvedValue({ count: 4 });
    tx.commerceEntitlement.updateMany.mockResolvedValue({ count: 2 });
    tx.shippingFulfillment.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    tx.serviceFulfillment.updateMany.mockResolvedValue({ count: 3 });

    await expect(reconcileCommerceOrderRefund(tx as never, {
      vendorId: "vendor-1",
      orderId: "order-1",
      providerName: "payuni",
      eventIdentity: "full-shipped",
      amountCents: 1_200,
      occurredAt: now,
    })).resolves.toMatchObject({ changed: true, status: "refunded" });

    expect(tx.shippingFulfillment.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ status: "shipped" }),
      data: expect.objectContaining({ status: "refund_review", refundReviewAt: now, revision: { increment: 1 } }),
    }));
    expect(tx.commerceOrderEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "refund.processed",
        sanitizedData: expect.objectContaining({
          fulfillmentConvergence: {
            revokedDeliverySnapshotCount: 4,
            revokedEntitlementCount: 2,
            cancelledShippingCount: 1,
            shippingRefundReviewCount: 1,
            cancelledServiceCount: 3,
          },
        }),
      }),
    }));
  });
});
