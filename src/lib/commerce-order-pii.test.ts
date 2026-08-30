import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommerceOrderPiiValidationError,
  commerceOrderIdentityMatches,
  createCommerceOrderIdentityHash,
  protectCommerceOrderPii,
  revealCommerceOrderPii,
} from "@/lib/commerce-order-pii";

const binding = { vendorId: "vendor-1", orderId: "order-1" };
const input = {
  buyer: {
    name: " 王小明 ",
    email: " BUYER@Example.COM ",
    phone: "+886 912-345-678",
  },
  shipping: {
    recipientName: "王小明",
    phone: "+886 912-345-678",
    countryCode: "tw",
    postalCode: "100",
    administrativeArea: "臺北市",
    locality: "中正區",
    addressLine1: "忠孝西路一段 1 號",
    addressLine2: "10 樓",
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("commerce order PII boundary", () => {
  it("encrypts buyer and shipping details while returning only masked derivatives", () => {
    vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-commerce-order-pii-32-bytes");
    const protectedPii = protectCommerceOrderPii(input, binding);
    const serialized = JSON.stringify(protectedPii);

    expect(protectedPii.buyerEncrypted).toMatch(/^v1\./u);
    expect(protectedPii.shippingEncrypted).toMatch(/^v1\./u);
    expect(serialized).not.toContain("王小明");
    expect(serialized).not.toContain("BUYER@Example.COM");
    expect(serialized).not.toContain("忠孝西路");
    expect(protectedPii).toMatchObject({
      buyerNameMasked: "王＊＊",
      buyerEmailMasked: "b***@example.com",
      buyerPhoneMasked: "****5678",
      shippingSummaryMasked: "TW · 臺北市 · 中正區 · …",
    });

    expect(revealCommerceOrderPii(protectedPii, binding)).toEqual({
      buyer: {
        name: "王小明",
        email: "buyer@example.com",
        phone: "+886 912-345-678",
      },
      shipping: {
        ...input.shipping,
        countryCode: "TW",
      },
    });
  });

  it("binds envelopes to the vendor and order instead of allowing cross-tenant replay", () => {
    vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-commerce-order-pii-32-bytes");
    const protectedPii = protectCommerceOrderPii(input, binding);

    expect(() => revealCommerceOrderPii(protectedPii, { ...binding, vendorId: "vendor-2" }))
      .toThrow("Commerce order PII envelope could not be decrypted.");
    expect(() => revealCommerceOrderPii(protectedPii, { ...binding, orderId: "order-2" }))
      .toThrow("Commerce order PII envelope could not be decrypted.");
  });

  it("creates a stable, tenant-bound identity hash without retaining plaintext", () => {
    vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-commerce-order-pii-32-bytes");
    const hash = createCommerceOrderIdentityHash(input, binding.vendorId);
    const normalizedInput = {
      ...input,
      buyer: { ...input.buyer, name: "王小明", email: "buyer@example.com" },
      shipping: { ...input.shipping, countryCode: "TW" },
    };

    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(hash).not.toContain("buyer");
    expect(createCommerceOrderIdentityHash(normalizedInput, binding.vendorId)).toBe(hash);
    expect(commerceOrderIdentityMatches(normalizedInput, binding.vendorId, hash)).toBe(true);
    expect(createCommerceOrderIdentityHash(input, "vendor-2")).not.toBe(hash);
    expect(commerceOrderIdentityMatches({
      ...input,
      shipping: { ...input.shipping, addressLine1: "另一個地址" },
    }, binding.vendorId, hash)).toBe(false);
  });

  it("rejects malformed or unexpected fields without echoing PII in the error", () => {
    vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-commerce-order-pii-32-bytes");
    const privateValue = "private-address-that-must-not-leak";

    expect(() => protectCommerceOrderPii({
      ...input,
      buyer: { ...input.buyer, email: "not-an-email", unexpected: privateValue },
    }, binding)).toThrow(CommerceOrderPiiValidationError);

    try {
      protectCommerceOrderPii({
        ...input,
        shipping: { ...input.shipping, addressLine1: privateValue, countryCode: "TAIWAN" },
      }, binding);
    } catch (error) {
      expect(String(error)).not.toContain(privateValue);
    }
  });

  it("supports non-shipping orders without manufacturing an address", () => {
    vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-commerce-order-pii-32-bytes");
    const protectedPii = protectCommerceOrderPii({ buyer: input.buyer, shipping: null }, binding);

    expect(protectedPii.shippingEncrypted).toBeNull();
    expect(protectedPii.shippingSummaryMasked).toBeNull();
    expect(revealCommerceOrderPii(protectedPii, binding).shipping).toBeNull();
  });
});
