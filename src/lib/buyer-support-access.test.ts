import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUYER_SUPPORT_COOKIE_PREFIX,
  buyerVisibleSupportCaseScopes,
  hashBuyerSupportToken,
  issueBuyerSupportGrant,
  resolveBuyerOrderDetail,
  resolveBuyerOrderItemDelivery,
  resolveBuyerSupportGrants,
  rotateBuyerSupportGrant,
} from "@/lib/buyer-support-access";
import { protectOrderItemDeliverySnapshot } from "@/lib/product-delivery";

beforeEach(() => {
  process.env.CSRF_SECRET = "g7-48-buyer-delivery-test-secret-32-bytes";
});

describe("buyer support order capability", () => {
  it("limits public case queries to an exact order that was created by or shared with the buyer", () => {
    expect(buyerVisibleSupportCaseScopes([
      { id: "grant-1", vendorId: "vendor-1", orderId: "order-1" },
    ])).toEqual([{
      vendorId: "vendor-1",
      orderId: "order-1",
      OR: [
        { createdByBuyerGrantId: "grant-1" },
        { events: { some: { audience: "buyer" } } },
      ],
    }]);
  });

  it("stores only a SHA-256 hash when issuing a per-order cookie", async () => {
    const create = vi.fn(async ({ data }) => ({ cookieKey: data.cookieKey }));
    const db = {
      buyerSupportOrderGrant: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback) => callback({
        buyerSupportOrderGrant: { findUnique: vi.fn().mockResolvedValue(null), create },
      })),
    };
    const cookie = await issueBuyerSupportGrant(db as never, {
      request: new Request("https://example.test/checkout"),
      vendorId: "vendor-1",
      orderId: "order-1",
      now: new Date("2026-08-08T12:00:00.000Z"),
    });
    const stored = create.mock.calls[0][0].data;

    expect(cookie.name).toMatch(new RegExp(`^${BUYER_SUPPORT_COOKIE_PREFIX}[a-f0-9]{32}$`, "u"));
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(stored.tokenHash).toBe(hashBuyerSupportToken(cookie.value));
    expect(JSON.stringify(stored)).not.toContain(cookie.value);
    expect(stored.vendorId).toBe("vendor-1");
    expect(stored.orderId).toBe("order-1");
  });

  it("resolves only an exact cookie-name and token-hash pair", async () => {
    const token = "a".repeat(43);
    const cookieKey = "b".repeat(32);
    const grant = {
      id: "grant-1", cookieKey, tokenHash: hashBuyerSupportToken(token),
      vendorId: "vendor-1", orderId: "order-1", rotationCount: 0,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"), revokedAt: null,
      order: { id: "order-1" },
    };
    const db = { buyerSupportOrderGrant: { findMany: vi.fn().mockResolvedValue([grant]) } };

    await expect(resolveBuyerSupportGrants(db as never, {
      getAll: () => [{ name: `${BUYER_SUPPORT_COOKIE_PREFIX}${cookieKey}`, value: token }],
    }, new Date("2026-08-08T00:00:00.000Z"))).resolves.toEqual([grant]);
    await expect(resolveBuyerSupportGrants(db as never, {
      getAll: () => [{ name: `${BUYER_SUPPORT_COOKIE_PREFIX}${"c".repeat(32)}`, value: token }],
    }, new Date("2026-08-08T00:00:00.000Z"))).resolves.toEqual([]);
    const query = db.buyerSupportOrderGrant.findMany.mock.calls[0]?.[0];
    expect(query.include.order.select.items).toEqual({ orderBy: { lineIndex: "asc" }, take: 1, select: { productId: true } });
    expect(JSON.stringify(query)).not.toContain("buyerEncryptedEnvelope");
  });

  it("rotates with compare-and-swap and never returns the old token", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      buyerSupportOrderGrant: {
        findUnique: vi.fn().mockResolvedValue({
          id: "grant-1", cookieKey: "d".repeat(32), rotationCount: 3,
          revokedAt: null, expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        }),
        updateMany,
      },
    };
    const result = await rotateBuyerSupportGrant(tx as never, {
      grantId: "grant-1", expectedRotationCount: 3,
      now: new Date("2026-08-08T00:00:00.000Z"),
    });

    expect(result.rotationCount).toBe(4);
    expect(result.cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ rotationCount: 3 }),
      data: expect.objectContaining({
        tokenHash: hashBuyerSupportToken(result.cookie.value),
        rotationCount: { increment: 1 },
      }),
    }));
  });

  it("resolves a buyer order through the active exact-order grant using a public-safe projection", async () => {
    const token = "e".repeat(43);
    const cookieKey = "f".repeat(32);
    const grant = {
      id: "grant-1", cookieKey, tokenHash: hashBuyerSupportToken(token),
      vendorId: "vendor-1", orderId: "order-1", rotationCount: 0,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"), revokedAt: null,
      order: { id: "order-1" },
    };
    const findFirst = vi.fn().mockResolvedValue({ id: "order-1", orderNumber: "CD-001" });
    const db = {
      buyerSupportOrderGrant: { findMany: vi.fn().mockResolvedValue([grant]) },
      commerceOrder: { findFirst },
    };

    await expect(resolveBuyerOrderDetail(db as never, {
      getAll: () => [{ name: `${BUYER_SUPPORT_COOKIE_PREFIX}${cookieKey}`, value: token }],
    }, "grant-1", new Date("2026-08-08T00:00:00.000Z"))).resolves.toEqual({
      id: "order-1", orderNumber: "CD-001",
    });

    const query = findFirst.mock.calls[0]?.[0];
    expect(query.where).toEqual(expect.objectContaining({
      id: "order-1",
      vendorId: "vendor-1",
      buyerSupportOrderGrants: { some: expect.objectContaining({ id: "grant-1", revokedAt: null }) },
    }));
    const serializedSelect = JSON.stringify(query.select);
    for (const forbidden of [
      "buyerEncryptedEnvelope", "shippingEncryptedEnvelope", "checkoutIdentityHash",
      "trackingNumber", "trackingUrl", "accessEncryptedEnvelope", "paymentTransactionId",
      "refundRecordId", "sanitizedData", "destinationEncryptedEnvelope", "instructionsEncryptedEnvelope",
    ]) {
      expect(serializedSelect).not.toContain(forbidden);
    }
    expect(serializedSelect).toContain("shippingMaskedSummary");
    expect(serializedSelect).toContain("serviceMaskedSummary");
    expect(serializedSelect).toContain("deliverySnapshot");
    expect(serializedSelect).toContain("destinationMaskedSummary");
  });

  it("reveals an immutable delivery only for the exact active buyer grant and fulfillment", async () => {
    const token = "g".repeat(43);
    const cookieKey = "1".repeat(32);
    const now = new Date("2026-08-08T00:00:00.000Z");
    const binding = { vendorId: "vendor-1", orderId: "order-1", orderItemId: "item-1", snapshotId: "snapshot-1" };
    const encrypted = protectOrderItemDeliverySnapshot({
      destinationUrl: "https://delivery.example.com/buyer/content",
      instructions: "請先下載教材。",
    }, binding);
    const grant = {
      id: "grant-1", cookieKey, tokenHash: hashBuyerSupportToken(token),
      vendorId: "vendor-1", orderId: "order-1", rotationCount: 0,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"), revokedAt: null,
      order: { id: "order-1" },
    };
    const findFirst = vi.fn().mockResolvedValue({
      id: "item-1", vendorId: "vendor-1", orderId: "order-1", productName: "數位教材", fulfillmentType: "digital",
      order: { orderNumber: "CD-001", status: "paid" },
      entitlement: { status: "granted", expiresAt: null, revokedAt: null },
      serviceFulfillment: null,
      deliverySnapshot: {
        id: "snapshot-1", deliveryKind: "digital_link", title: "教材下載",
        ...encrypted,
        allowlistSnapshot: { hostname: "delivery.example.com", pathPrefix: "/buyer/content", allowQuery: false },
        revokedAt: null,
      },
    });
    const db = {
      buyerSupportOrderGrant: { findMany: vi.fn().mockResolvedValue([grant]) },
      commerceOrderItem: { findFirst },
    };

    await expect(resolveBuyerOrderItemDelivery(db as never, {
      getAll: () => [{ name: `${BUYER_SUPPORT_COOKIE_PREFIX}${cookieKey}`, value: token }],
    }, { grantId: "grant-1", itemId: "item-1", now })).resolves.toEqual({
      orderNumber: "CD-001",
      productName: "數位教材",
      deliveryKind: "digital_link",
      title: "教材下載",
      destinationUrl: "https://delivery.example.com/buyer/content",
      instructions: "請先下載教材。",
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "item-1", vendorId: "vendor-1", orderId: "order-1" }),
    }));
  });

  it("fails closed for foreign, expired, refunded, revoked, or tampered delivery access", async () => {
    const token = "h".repeat(43);
    const cookieKey = "2".repeat(32);
    const now = new Date("2026-08-08T00:00:00.000Z");
    const grant = {
      id: "grant-1", cookieKey, tokenHash: hashBuyerSupportToken(token), vendorId: "vendor-1", orderId: "order-1",
      rotationCount: 0, expiresAt: new Date("2027-01-01T00:00:00.000Z"), revokedAt: null, order: { id: "order-1" },
    };
    const cookieSource = { getAll: () => [{ name: `${BUYER_SUPPORT_COOKIE_PREFIX}${cookieKey}`, value: token }] };
    const binding = { vendorId: "vendor-1", orderId: "order-1", orderItemId: "item-1", snapshotId: "snapshot-1" };
    const encrypted = protectOrderItemDeliverySnapshot({ destinationUrl: "https://delivery.example.com/buyer/content", instructions: null }, binding);
    const activeItem = {
      id: "item-1", vendorId: "vendor-1", orderId: "order-1", productName: "數位教材", fulfillmentType: "digital",
      order: { orderNumber: "CD-001", status: "paid" }, entitlement: { status: "granted", expiresAt: null, revokedAt: null },
      serviceFulfillment: null,
      deliverySnapshot: {
        id: "snapshot-1", deliveryKind: "digital_link", title: "教材下載", ...encrypted,
        allowlistSnapshot: { hostname: "evil.example.com", pathPrefix: "/buyer/content", allowQuery: false }, revokedAt: null,
      },
    };

    const foreignDb = { buyerSupportOrderGrant: { findMany: vi.fn().mockResolvedValue([grant]) }, commerceOrderItem: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(resolveBuyerOrderItemDelivery(foreignDb as never, cookieSource, { grantId: "grant-1", itemId: "foreign", now })).resolves.toBeNull();

    const expiredGrant = { ...grant, expiresAt: new Date("2026-08-07T00:00:00.000Z") };
    const expiredFind = vi.fn();
    await expect(resolveBuyerOrderItemDelivery({
      buyerSupportOrderGrant: { findMany: vi.fn().mockResolvedValue([expiredGrant]) }, commerceOrderItem: { findFirst: expiredFind },
    } as never, cookieSource, { grantId: "grant-1", itemId: "item-1", now })).resolves.toBeNull();
    expect(expiredFind).not.toHaveBeenCalled();

    for (const item of [
      { ...activeItem, order: { ...activeItem.order, status: "refunded" } },
      { ...activeItem, deliverySnapshot: { ...activeItem.deliverySnapshot, revokedAt: now } },
      activeItem,
    ]) {
      const db = { buyerSupportOrderGrant: { findMany: vi.fn().mockResolvedValue([grant]) }, commerceOrderItem: { findFirst: vi.fn().mockResolvedValue(item) } };
      await expect(resolveBuyerOrderItemDelivery(db as never, cookieSource, { grantId: "grant-1", itemId: "item-1", now })).resolves.toBeNull();
    }
  });

  it("does not query order details when the requested grant is unavailable", async () => {
    const findFirst = vi.fn();
    const db = {
      buyerSupportOrderGrant: { findMany: vi.fn().mockResolvedValue([]) },
      commerceOrder: { findFirst },
    };

    await expect(resolveBuyerOrderDetail(db as never, { getAll: () => [] }, "foreign-grant"))
      .resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
