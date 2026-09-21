import { describe, expect, it } from "vitest";
import {
  isValidCitizenDigitalCertificate,
  isValidDonationCode,
  isValidMobileBarcode,
  isValidTaiwanBusinessId,
  parseCheckoutInvoiceSelection,
  validateCheckoutInvoiceSelection,
} from "@/lib/taiwan-invoice-validator";

describe("Taiwan invoice validators", () => {
  it.each(["04595257", "53212539", "27922479", "22099131"])("accepts valid business id %s", (value) => {
    expect(isValidTaiwanBusinessId(value)).toBe(true);
  });

  it.each(["04595258", "12345678", "27922478", "1234567", "ABCDEFGH"])("rejects invalid business id %s", (value) => {
    expect(isValidTaiwanBusinessId(value)).toBe(false);
  });

  it("supports the seventh-digit-seven exception", () => {
    expect(isValidTaiwanBusinessId("10458575")).toBe(true);
  });

  it.each(["/ABC1234", "/12.+-_A", "/0000000"])("accepts valid mobile barcode %s", (value) => {
    expect(isValidMobileBarcode(value)).toBe(true);
  });

  it.each(["ABC12345", "/abc1234", "/ABC123", "/ABC12345", "/ABC 234"])("rejects invalid mobile barcode %s", (value) => {
    expect(isValidMobileBarcode(value)).toBe(false);
  });

  it("validates citizen certificates and donation codes at their boundaries", () => {
    expect(isValidCitizenDigitalCertificate("AB12345678901234")).toBe(true);
    expect(isValidCitizenDigitalCertificate("Ab12345678901234")).toBe(false);
    expect(isValidDonationCode("123")).toBe(true);
    expect(isValidDonationCode("1234567")).toBe(true);
    expect(isValidDonationCode("12")).toBe(false);
    expect(isValidDonationCode("12345678")).toBe(false);
  });

  it("returns checkout-ready field messages", () => {
    expect(validateCheckoutInvoiceSelection({ type: "company", businessId: "12345678", companyName: "測試公司" })).toContain("統一編號");
    expect(validateCheckoutInvoiceSelection({ type: "donation", donationCode: "12" })).toContain("捐贈碼");
    expect(validateCheckoutInvoiceSelection({ type: "company", businessId: "04595257", companyName: "   " })).toContain("發票抬頭");
    expect(validateCheckoutInvoiceSelection({ type: "personal", carrier: "mobile", carrierNumber: "bad" })).toContain("手機條碼");
    expect(validateCheckoutInvoiceSelection({ type: "personal", carrier: "citizen_certificate", carrierNumber: "bad" })).toContain("自然人憑證");
    expect(validateCheckoutInvoiceSelection({ type: "personal", carrier: "member" })).toBeNull();
  });

  it("parses only validated invoice selections", () => {
    expect(parseCheckoutInvoiceSelection(null)).toBeNull();
    expect(parseCheckoutInvoiceSelection([])).toBeNull();
    expect(parseCheckoutInvoiceSelection({ type: "company", businessId: "04595257", companyName: " 測試公司 " }))
      .toEqual({ type: "company", businessId: "04595257", companyName: "測試公司" });
    expect(parseCheckoutInvoiceSelection({ type: "donation", donationCode: "123" }))
      .toEqual({ type: "donation", donationCode: "123" });
    expect(parseCheckoutInvoiceSelection({ type: "personal", carrier: "member" }))
      .toEqual({ type: "personal", carrier: "member" });
    expect(parseCheckoutInvoiceSelection({ type: "personal", carrier: "mobile", carrierNumber: "/ABC1234" }))
      .toEqual({ type: "personal", carrier: "mobile", carrierNumber: "/ABC1234" });
    expect(parseCheckoutInvoiceSelection({ type: "personal", carrier: "citizen_certificate", carrierNumber: "AB12345678901234" }))
      .toEqual({ type: "personal", carrier: "citizen_certificate", carrierNumber: "AB12345678901234" });
    expect(parseCheckoutInvoiceSelection({ type: "personal", carrier: "mobile", carrierNumber: "bad" })).toBeNull();
    expect(parseCheckoutInvoiceSelection({ type: "unknown" })).toBeNull();
  });
});
