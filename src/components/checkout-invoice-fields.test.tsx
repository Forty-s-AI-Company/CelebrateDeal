import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckoutInvoiceFields, invoiceFieldError } from "@/components/checkout-invoice-fields";

describe("CheckoutInvoiceFields", () => {
  it("renders personal, company, donation and carrier choices", () => {
    const html = renderToStaticMarkup(<CheckoutInvoiceFields />);
    expect(html).toContain('name="invoiceType"');
    expect(html).toContain('value="personal"');
    expect(html).toContain('value="company"');
    expect(html).toContain('value="donation"');
    expect(html).toContain('value="mobile"');
    expect(html).toContain('value="citizen_certificate"');
    expect(html).toContain('role="alert"');
  });

  it("returns immediate errors for invalid switched-field values", () => {
    expect(invoiceFieldError({ type: "personal", carrier: "mobile", carrierNumber: "/abc1234" })).toBe("手機條碼格式不正確。");
    expect(invoiceFieldError({ type: "personal", carrier: "mobile", carrierNumber: "/ABC1234" })).toBeNull();
    expect(invoiceFieldError({ type: "company", businessId: "12345678", companyName: "公司" })).toContain("統一編號");
    expect(invoiceFieldError({ type: "company", businessId: "04595257", companyName: "" })).toContain("抬頭");
    expect(invoiceFieldError({ type: "donation", donationCode: "123" })).toBeNull();
  });
});
