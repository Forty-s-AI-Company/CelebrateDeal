import { beforeEach, describe, expect, it } from "vitest";
import {
  parsePublicHttpsDeliveryUrl,
  ProductDeliveryValidationError,
  protectOrderItemDeliverySnapshot,
  protectProductDeliveryConfig,
  revealOrderItemDeliverySnapshot,
  revealProductDeliveryConfig,
  validateProductDeliveryDraft,
} from "./product-delivery";

beforeEach(() => {
  process.env.CSRF_SECRET = "g7-48-product-delivery-test-secret-32-bytes";
});

describe("product delivery validation", () => {
  it("accepts a confirmed public HTTPS course portal without query secrets", () => {
    expect(validateProductDeliveryDraft({
      fulfillmentType: "course",
      isActive: true,
      title: "課程內容",
      destinationUrl: "https://courses.example.com/member/intro",
      instructions: "付款後請從此入口開始。",
      hostConfirmed: true,
    })).toMatchObject({
      deliveryKind: "course_portal",
      status: "active",
      destinationHostname: "courses.example.com",
      destinationPathPrefix: "/member/intro",
    });
  });

  it.each([
    "http://courses.example.com/member",
    "https://user:pass@courses.example.com/member",
    "https://courses.example.com/member?token=secret",
    "https://courses.example.com/member#secret",
    "https://127.0.0.1/member",
    "https://[::1]/member",
    "https://portal.local/member",
    "https://localhost/member",
  ])("rejects unsafe delivery URL %s", (value) => {
    expect(() => parsePublicHttpsDeliveryUrl(value)).toThrow(ProductDeliveryValidationError);
  });

  it("lets an inactive product save an incomplete delivery draft", () => {
    expect(validateProductDeliveryDraft({
      fulfillmentType: "digital",
      isActive: false,
      title: "下載教材",
      destinationUrl: null,
      instructions: null,
      hostConfirmed: false,
    })).toMatchObject({ status: "draft", title: "下載教材" });
  });

  it("fails closed when an active non-physical product has no usable delivery", () => {
    expect(() => validateProductDeliveryDraft({
      fulfillmentType: "digital",
      isActive: true,
      title: "下載教材",
      destinationUrl: null,
      instructions: null,
      hostConfirmed: false,
    })).toThrow("require a delivery URL");
    expect(() => validateProductDeliveryDraft({
      fulfillmentType: "service",
      isActive: true,
      title: "一對一諮詢",
      destinationUrl: null,
      instructions: null,
      hostConfirmed: false,
    })).toThrow("require buyer instructions");
  });
});

describe("product delivery envelopes", () => {
  const delivery = {
    fulfillmentType: "digital" as const,
    deliveryKind: "digital_link" as const,
    status: "active" as const,
    title: "下載教材",
    destinationUrl: "https://downloads.example.com/files/guide.pdf",
    destinationHostname: "downloads.example.com",
    destinationPathPrefix: "/files/guide.pdf",
    instructions: "請在七天內下載。",
  };
  const configBinding = { vendorId: "vendor-1", productId: "product-1", configId: "config-1", revision: 2 };
  const snapshotBinding = { vendorId: "vendor-1", orderId: "order-1", orderItemId: "item-1", snapshotId: "snapshot-1" };

  it("encrypts merchant configuration and binds it to vendor, product, config, and revision", () => {
    const protectedConfig = protectProductDeliveryConfig(delivery, configBinding);
    expect(JSON.stringify(protectedConfig)).not.toContain(delivery.destinationUrl);
    expect(JSON.stringify(protectedConfig)).not.toContain(delivery.instructions);
    expect(revealProductDeliveryConfig(protectedConfig, configBinding)).toEqual({
      destinationUrl: delivery.destinationUrl,
      instructions: delivery.instructions,
    });
    expect(() => revealProductDeliveryConfig(protectedConfig, { ...configBinding, productId: "product-foreign" })).toThrow();
  });

  it("re-encrypts immutable order delivery under an order-item binding", () => {
    const protectedSnapshot = protectOrderItemDeliverySnapshot({
      destinationUrl: delivery.destinationUrl,
      instructions: delivery.instructions,
    }, snapshotBinding);
    expect(JSON.stringify(protectedSnapshot)).not.toContain(delivery.destinationUrl);
    expect(revealOrderItemDeliverySnapshot(protectedSnapshot, snapshotBinding)).toEqual({
      destinationUrl: delivery.destinationUrl,
      instructions: delivery.instructions,
    });
    expect(() => revealOrderItemDeliverySnapshot(protectedSnapshot, { ...snapshotBinding, orderItemId: "item-foreign" })).toThrow();
  });
});
