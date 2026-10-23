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

  // 財政部財政資訊中心公告（2023-04-01 起檢查邏輯由 10 的倍數改為 5 的倍數）的官方測試統編。
  it.each(["04595252", "10458570"])("accepts official post-2023 business id %s", (value) => {
    expect(isValidTaiwanBusinessId(value)).toBe(true);
  });

  // 官方說明文件的第七碼為 7 範例：Z1 或 Z2 任一可整除即有效。
  it.each(["10458574", "10458575"])("accepts official seventh-digit-seven example %s", (value) => {
    expect(isValidTaiwanBusinessId(value)).toBe(true);
  });

  // 合成向量（非真實統編）：只滿足新規則，加權總和 % 10 !== 0。
  it("accepts a synthetic seventh-digit-seven id that satisfies only the new rule", () => {
    expect(isValidTaiwanBusinessId("10458579")).toBe(true); // 第七碼為 7，總和 34、+1 = 35；舊規則無效
  });

  it.each(["04595253", "10458571", "10458572", "0459525", "045952520", "0459525A", ""])(
    "still rejects invalid business id %s",
    (value) => {
      expect(isValidTaiwanBusinessId(value)).toBe(false);
    },
  );

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
