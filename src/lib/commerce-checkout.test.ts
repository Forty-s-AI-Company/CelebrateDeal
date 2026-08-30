import { describe, expect, it } from "vitest";
import {
  checkoutErrorMessage,
  checkoutRequiresPhone,
  checkoutRequiresShipping,
  CommerceCheckoutRequestSchema,
  CommerceCheckoutResponseSchema,
  isAllowedCheckoutDestination,
  shouldDiscardCheckoutAdmission,
} from "@/lib/commerce-checkout";

describe("commerce checkout contract", () => {
  it("accepts only a bounded server-validatable request envelope", () => {
    expect(CommerceCheckoutRequestSchema.safeParse({
      vendorId: "vendor-1",
      productId: "product-1",
      idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
      admissionToken: `ca1.${"a".repeat(64)}.${"b".repeat(43)}`,
      buyer: { name: "王小明" },
      shipping: null,
    }).success).toBe(true);
    expect(CommerceCheckoutRequestSchema.safeParse({
      vendorId: "vendor-1",
      productId: "product-1",
      idempotencyKey: "predictable-key",
      admissionToken: "client-created",
      buyer: {},
      forgedProvider: "production",
    }).success).toBe(false);
  });

  it("validates provider actions before the browser consumes them", () => {
    expect(CommerceCheckoutResponseSchema.safeParse({
      ok: true,
      provider: "payuni",
      orderNumber: "CD-001",
      transactionId: "tx-1",
      amountCents: 1_200,
      currency: "TWD",
      formAction: "https://sandbox-api.payuni.com.tw/api/upp",
      formMethod: "POST",
      formPayload: { EncryptInfo: "opaque", HashInfo: "opaque-hash" },
      nextAction: "submit_payuni_upp_form",
      externalRequired: false,
    }).success).toBe(true);
    expect(CommerceCheckoutResponseSchema.safeParse({
      ok: true,
      provider: "payuni",
      orderNumber: "CD-001",
      transactionId: "tx-1",
      amountCents: -1,
      currency: "twd",
      nextAction: "submit",
      externalRequired: false,
    }).success).toBe(false);
  });

  it("shows shipping only for physical goods and requires phone for physical or service orders", () => {
    expect(checkoutRequiresShipping("physical")).toBe(true);
    expect(checkoutRequiresShipping("digital")).toBe(false);
    expect(checkoutRequiresPhone("physical")).toBe(true);
    expect(checkoutRequiresPhone("service")).toBe(true);
    expect(checkoutRequiresPhone("course")).toBe(false);
  });

  it("permits only exact PayUni UPP or same-origin destinations", () => {
    expect(isAllowedCheckoutDestination(
      "https://sandbox-api.payuni.com.tw/api/upp",
      "http://127.0.0.1:31023",
      "payuni",
    )).toBe(true);
    expect(isAllowedCheckoutDestination(
      "https://api.payuni.com.tw/api/upp",
      "https://app.example.test",
      "payuni",
    )).toBe(true);
    expect(isAllowedCheckoutDestination("/checkout/continue", "http://127.0.0.1:31023", "demo")).toBe(true);
    expect(isAllowedCheckoutDestination("https://evil.example/pay", "https://app.example.test", "payuni")).toBe(false);
    expect(isAllowedCheckoutDestination(
      "https://sandbox-api.payuni.com.tw/api/upp?next=evil",
      "https://app.example.test",
      "payuni",
    )).toBe(false);
    expect(isAllowedCheckoutDestination("javascript:alert(1)", "https://app.example.test", "demo")).toBe(false);
  });

  it("keeps errors useful without exposing provider internals", () => {
    expect(checkoutErrorMessage(409)).toContain("重新整理");
    expect(checkoutErrorMessage(425)).toContain("沿用同一筆訂單");
    expect(checkoutErrorMessage(502)).toContain("尚未向你收款");
  });

  it("retains one checkout identity across ambiguous server failures", () => {
    expect(shouldDiscardCheckoutAdmission(500)).toBe(false);
    expect(shouldDiscardCheckoutAdmission(502)).toBe(false);
    expect(shouldDiscardCheckoutAdmission(503)).toBe(false);
    expect(shouldDiscardCheckoutAdmission(425)).toBe(false);
    expect(shouldDiscardCheckoutAdmission(400)).toBe(false);
    expect(shouldDiscardCheckoutAdmission(409)).toBe(true);
  });
});
