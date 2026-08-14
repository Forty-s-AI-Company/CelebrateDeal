import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/commerce-entitlement-access", () => ({
  protectCommerceEntitlementAccess: vi.fn(() => ({
    accessEncryptedEnvelope: "sealed-entitlement-access",
    accessMaskedSummary: "安全授權 · ment-1",
  })),
}));
import {
  CommerceFulfillmentConflictError,
  CommerceFulfillmentValidationError,
  grantCommerceEntitlement,
  transitionServiceFulfillment,
  transitionShippingFulfillment,
} from "@/lib/commerce-order-fulfillment";

const now = new Date("2026-08-08T10:00:00.000Z");

function tx() {
  return {
    shippingFulfillment: { findFirst: vi.fn(), updateMany: vi.fn() },
    commerceEntitlement: { findFirst: vi.fn(), updateMany: vi.fn() },
    serviceFulfillment: { findFirst: vi.fn(), updateMany: vi.fn() },
    commerceOrderEvent: { create: vi.fn() },
  };
}

function fulfillment(status: string, orderStatus = "paid") {
  return {
    id: "fulfillment-1",
    vendorId: "vendor-1",
    status,
    revision: 2,
    scheduledAt: null,
    accessEncryptedEnvelope: null,
    accessMaskedSummary: null,
    orderItem: { id: "item-1", orderId: "order-1", order: { status: orderStatus } },
  };
}

describe("commerce order fulfillment", () => {
  it("marks a paid physical order shipped with CAS and a sanitized event", async () => {
    const db = tx();
    db.shippingFulfillment.findFirst.mockResolvedValue(fulfillment("pending"));
    db.shippingFulfillment.updateMany.mockResolvedValue({ count: 1 });

    await expect(transitionShippingFulfillment(db as never, {
      vendorId: "vendor-1",
      fulfillmentId: "fulfillment-1",
      expectedRevision: 2,
      nextStatus: "shipped",
      carrierName: "測試物流",
      trackingNumber: "SECRET-TRACK-1234",
      trackingUrl: "https://carrier.example.test/track/SECRET-TRACK-1234",
      actor: { id: "member-1" },
      now,
    })).resolves.toEqual({ orderId: "order-1", status: "shipped", revision: 3 });

    expect(db.shippingFulfillment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revision: 2, status: "pending" }),
      data: expect.objectContaining({ status: "shipped", carrierName: "測試物流" }),
    }));
    const event = db.commerceOrderEvent.create.mock.calls[0]?.[0];
    expect(event.data.sanitizedData).toMatchObject({ trackingSuffix: "1234", nextStatus: "shipped" });
    expect(JSON.stringify(event.data.sanitizedData)).not.toContain("SECRET-TRACK");
  });

  it("rejects unsafe tracking URLs, stale revisions, and unpaid fulfillment", async () => {
    const unsafe = tx();
    unsafe.shippingFulfillment.findFirst.mockResolvedValue(fulfillment("pending"));
    await expect(transitionShippingFulfillment(unsafe as never, {
      vendorId: "vendor-1", fulfillmentId: "fulfillment-1", expectedRevision: 2,
      nextStatus: "shipped", carrierName: "物流", trackingUrl: "javascript:alert(1)", actor: { id: "member-1" },
    })).rejects.toBeInstanceOf(CommerceFulfillmentValidationError);

    const unpaid = tx();
    unpaid.shippingFulfillment.findFirst.mockResolvedValue(fulfillment("pending", "pending_payment"));
    await expect(transitionShippingFulfillment(unpaid as never, {
      vendorId: "vendor-1", fulfillmentId: "fulfillment-1", expectedRevision: 2,
      nextStatus: "packing", actor: { id: "member-1" },
    })).rejects.toBeInstanceOf(CommerceFulfillmentValidationError);

    const conflict = tx();
    conflict.shippingFulfillment.findFirst.mockResolvedValue(fulfillment("packing"));
    conflict.shippingFulfillment.updateMany.mockResolvedValue({ count: 0 });
    await expect(transitionShippingFulfillment(conflict as never, {
      vendorId: "vendor-1", fulfillmentId: "fulfillment-1", expectedRevision: 2,
      nextStatus: "shipped", carrierName: "物流", actor: { id: "member-1" },
    })).rejects.toBeInstanceOf(CommerceFulfillmentConflictError);

    const refundedShipped = tx();
    refundedShipped.shippingFulfillment.findFirst.mockResolvedValue(fulfillment("shipped", "refunded"));
    await expect(transitionShippingFulfillment(refundedShipped as never, {
      vendorId: "vendor-1", fulfillmentId: "fulfillment-1", expectedRevision: 2,
      nextStatus: "delivered", actor: { id: "member-1" },
    })).rejects.toBeInstanceOf(CommerceFulfillmentValidationError);
    expect(refundedShipped.shippingFulfillment.updateMany).not.toHaveBeenCalled();
  });

  it("lets a refunded order resolve a refund-review shipment as returned", async () => {
    const db = tx();
    db.shippingFulfillment.findFirst.mockResolvedValue(fulfillment("refund_review", "refunded"));
    db.shippingFulfillment.updateMany.mockResolvedValue({ count: 1 });

    await expect(transitionShippingFulfillment(db as never, {
      vendorId: "vendor-1",
      fulfillmentId: "fulfillment-1",
      expectedRevision: 2,
      nextStatus: "returned",
      actor: { id: "member-1" },
      now,
    })).resolves.toEqual({ orderId: "order-1", status: "returned", revision: 3 });

    expect(db.shippingFulfillment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revision: 2, status: "refund_review" }),
      data: expect.objectContaining({ status: "returned", returnedAt: now }),
    }));
    expect(db.commerceOrderEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "fulfillment.shipping.returned",
        sanitizedData: expect.objectContaining({ previousStatus: "refund_review", nextStatus: "returned" }),
      }),
    }));
  });

  it("grants a pending paid entitlement and treats an already granted one as idempotent", async () => {
    const db = tx();
    db.commerceEntitlement.findFirst.mockResolvedValue(fulfillment("pending"));
    db.commerceEntitlement.updateMany.mockResolvedValue({ count: 1 });
    await expect(grantCommerceEntitlement(db as never, {
      vendorId: "vendor-1", entitlementId: "fulfillment-1", expectedRevision: 2,
      actor: { id: "member-1" }, now,
    })).resolves.toMatchObject({ status: "granted", changed: true, revision: 3 });

    const retry = tx();
    retry.commerceEntitlement.findFirst.mockResolvedValue(fulfillment("granted"));
    await expect(grantCommerceEntitlement(retry as never, {
      vendorId: "vendor-1", entitlementId: "fulfillment-1", expectedRevision: 2,
      actor: { id: "member-1" }, now,
    })).resolves.toMatchObject({ status: "granted", changed: false });
    expect(retry.commerceEntitlement.updateMany).not.toHaveBeenCalled();
  });

  it("schedules then completes a paid service using guarded transitions", async () => {
    const scheduledAt = new Date("2026-08-10T02:00:00.000Z");
    const schedule = tx();
    schedule.serviceFulfillment.findFirst.mockResolvedValue(fulfillment("pending"));
    schedule.serviceFulfillment.updateMany.mockResolvedValue({ count: 1 });
    await expect(transitionServiceFulfillment(schedule as never, {
      vendorId: "vendor-1", fulfillmentId: "fulfillment-1", expectedRevision: 2,
      nextStatus: "scheduled", scheduledAt, actor: { id: "member-1" }, now,
    })).resolves.toMatchObject({ status: "scheduled", revision: 3 });

    const complete = tx();
    complete.serviceFulfillment.findFirst.mockResolvedValue({ ...fulfillment("scheduled"), scheduledAt });
    complete.serviceFulfillment.updateMany.mockResolvedValue({ count: 1 });
    await expect(transitionServiceFulfillment(complete as never, {
      vendorId: "vendor-1", fulfillmentId: "fulfillment-1", expectedRevision: 2,
      nextStatus: "completed", actor: { id: "member-1" }, now,
    })).resolves.toMatchObject({ status: "completed" });
  });
});
