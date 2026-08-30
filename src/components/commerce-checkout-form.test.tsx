import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommerceCheckoutForm } from "@/components/commerce-checkout-form";

describe("CommerceCheckoutForm", () => {
  it("renders physical shipping fields, payment boundaries, and accessible pending hooks", () => {
    const html = renderToStaticMarkup(
      <CommerceCheckoutForm
        vendorId="vendor-1"
        productId="product-1"
        productName="實體商品"
        fulfillmentType="physical"
      />,
    );

    expect(html).toContain("聯絡資料");
    expect(html).toContain("收件資料");
    expect(html).toContain('name="addressLine1"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("不會在這裡要求或保存卡號");
    expect(html).toContain('href="/policies/refunds"');
  });

  it("does not collect shipping addresses for digital, service, or course delivery", () => {
    for (const fulfillmentType of ["digital", "service", "course"] as const) {
      const html = renderToStaticMarkup(
        <CommerceCheckoutForm
          vendorId="vendor-1"
          productId="product-1"
          productName="非實體商品"
          fulfillmentType={fulfillmentType}
        />,
      );

      expect(html).not.toContain("收件資料");
      expect(html).not.toContain('name="addressLine1"');
    }
  });

  it("requires a phone for service delivery but keeps it optional for a course", () => {
    const service = renderToStaticMarkup(
      <CommerceCheckoutForm vendorId="v" productId="p" productName="服務" fulfillmentType="service" />,
    );
    const course = renderToStaticMarkup(
      <CommerceCheckoutForm vendorId="v" productId="p" productName="課程" fulfillmentType="course" />,
    );

    expect(service).toMatch(/<input[^>]*required=""[^>]*name="buyerPhone"/u);
    expect(course).toContain("電話（選填）");
  });

  it("renders declarative custom fields without exposing a definition editor", () => {
    const html = renderToStaticMarkup(
      <CommerceCheckoutForm
        vendorId="vendor-1"
        productId="product-1"
        productName="客製商品"
        fulfillmentType="physical"
        customCheckoutFields={[
          { key: "engraving", label: "刻字內容", type: "text", required: true },
          { key: "size", label: "尺寸", type: "select", required: true, options: ["S", "M"] },
        ]}
      />,
    );

    expect(html).toContain("商品自訂資料");
    expect(html).toContain('name="custom_engraving"');
    expect(html).toContain('name="custom_size"');
    expect(html).toContain("刻字內容");
  });
});
