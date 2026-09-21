import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvoiceCheckoutIdentityHash, protectInvoiceRequest, revealInvoiceRequest } from "@/lib/taiwan-invoice-request";

beforeEach(() => vi.stubEnv("CSRF_SECRET", "test-only-electronic-invoice-secret-material-123456"));
afterEach(() => vi.unstubAllEnvs());

describe("invoice request protection", () => {
  it("encrypts the carrier snapshot with exact tenant/order binding", () => {
    const selection = { type: "personal" as const, carrier: "mobile" as const, carrierNumber: "/ABC1234" };
    const envelope = protectInvoiceRequest(selection, "vendor-1", "order-1");
    expect(envelope).not.toContain("/ABC1234");
    expect(revealInvoiceRequest(envelope, "vendor-1", "order-1")).toEqual(selection);
    expect(() => revealInvoiceRequest(envelope, "vendor-other", "order-1")).toThrow();
  });

  it("binds a checkout idempotency key to the canonical invoice choice", () => {
    const base = "base-checkout-identity";
    const company = createInvoiceCheckoutIdentityHash(base, { type: "company", businessId: "04595257", companyName: "測試公司" });
    const donation = createInvoiceCheckoutIdentityHash(base, { type: "donation", donationCode: "123" });
    expect(company).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(company).not.toBe(donation);
    expect(createInvoiceCheckoutIdentityHash(base, { type: "company", businessId: "04595257", companyName: "測試公司" })).toBe(company);
  });
});
