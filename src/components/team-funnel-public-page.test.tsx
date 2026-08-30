import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamFunnelPublicPage } from "./team-funnel-public-page";

describe("TeamFunnelPublicPage", () => {
  it("renders structured content as escaped text and exposes accessible partner links", () => {
    const html = renderToStaticMarkup(<TeamFunnelPublicPage view={{
      state: "ready",
      page: {
        vendorId: "vendor-1",
        slug: "partner-b",
        headline: "活動標題",
        subheadline: null,
        body: [{ type: "paragraph", text: "<script>alert(1)</script>" }],
        cta: { label: "報名", href: "#registration-heading" },
        partner: { name: "B 夥伴", email: "b@example.test", referralCode: "B" },
        webinar: {
          id: "live-a", title: "A 的講座", startsAt: "2026-07-17T10:00:00.000Z",
          playbackHref: "/live/a", registrationHref: "#registration-heading",
          registration: { formId: "form-a", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }], submitLabel: "送出報名", successMessage: "已收到資料" },
        },
        productSlots: [{ slotKey: "main_product", offerLabel: "B 的方案", url: "https://shop.example.test/b", checkoutMode: "external" }],
      },
    }} />);

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('href="mailto:b@example.test"');
    expect(html).toContain('href="#registration-heading"');
    expect(html).toContain("外部連結只記錄推薦點擊");
    expect(html).toContain("外部連結");
    expect(html).toContain('rel="noreferrer"');
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders a clear safe state when a required resource is missing", () => {
    const html = renderToStaticMarkup(<TeamFunnelPublicPage view={{ state: "missing_slot" }} />);
    expect(html).toContain("推薦內容尚未完成");
    expect(html).toContain('role="status"');
    expect(html).toContain('href="/"');
    expect(html).toContain("返回首頁");
  });

  it.each([
    ["not_found", "找不到此公開頁"],
    ["unpublished", "此頁尚未公開"],
    ["disabled", "此頁目前無法使用"],
    ["inactive_partner", "此頁目前無法使用"],
    ["missing_webinar", "活動資訊尚未完成"],
    ["missing_slot", "推薦內容尚未完成"],
  ] as const)("keeps %s unavailable state actionable and announced", (state, heading) => {
    const html = renderToStaticMarkup(<TeamFunnelPublicPage view={{ state }} />);
    expect(html).toContain(heading);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('href="/"');
    expect(html).toContain("min-h-11");
  });

  it("renders an explicit empty state when the optional activity description is absent", () => {
    const html = renderToStaticMarkup(<TeamFunnelPublicPage view={{
      state: "ready",
      page: {
        vendorId: "vendor-1",
        slug: "partner-b",
        headline: "活動標題",
        subheadline: null,
        body: [],
        cta: { label: "報名", href: "#registration-heading" },
        partner: { name: "B 夥伴", email: null, referralCode: "B" },
        webinar: {
          id: "live-a", title: "A 的講座", startsAt: "2026-07-17T10:00:00.000Z",
          playbackHref: "/live/a", registrationHref: "#registration-heading",
          registration: { formId: "form-a", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }], submitLabel: "送出報名", successMessage: "已收到資料" },
        },
        productSlots: [{ slotKey: "main_product", offerLabel: "B 的方案", url: "https://shop.example.test/b", checkoutMode: "external" }],
      },
    }} />);

    expect(html).toContain("活動說明即將更新。");
    expect(html).toContain('aria-label="活動說明"');
  });

  it("renders a non-submittable recovery state when the resolved form schema is unavailable", () => {
    const html = renderToStaticMarkup(<TeamFunnelPublicPage view={{
      state: "ready",
      page: {
        vendorId: "vendor-1",
        slug: "partner-b",
        headline: "活動標題",
        subheadline: null,
        body: [],
        cta: { label: "報名", href: "#registration-heading" },
        partner: { name: "B 夥伴", email: null, referralCode: null },
        webinar: {
          id: "live-a",
          title: "A 的講座",
          startsAt: "2026-07-17T10:00:00.000Z",
          playbackHref: "/live/a",
          registrationHref: "#registration-heading",
          registration: null,
        },
        productSlots: [{ slotKey: "main_product", offerLabel: "方案", url: "https://shop.example.test/b", checkoutMode: "external" }],
      },
    }} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("暫停接收資料");
    expect(html).not.toContain('name="formId"');
  });

  it("labels platform products and explains the tracked order path", () => {
    const html = renderToStaticMarkup(<TeamFunnelPublicPage view={{
      state: "ready",
      page: {
        vendorId: "vendor-1",
        slug: "partner-b",
        headline: "活動標題",
        subheadline: null,
        body: [],
        cta: { label: "報名", href: "#registration-heading" },
        partner: { name: "B 夥伴", email: null, referralCode: "B" },
        webinar: {
          id: "live-a",
          title: "A 的講座",
          startsAt: "2026-07-17T10:00:00.000Z",
          playbackHref: "/live/a",
          registrationHref: "#registration-heading",
          registration: null,
        },
        productSlots: [{ slotKey: "main_product", offerLabel: "平台方案", url: "/checkout/vendor-1/product-a", checkoutMode: "platform" }],
      },
    }} />);

    expect(html).toContain("平台內商品會建立可追蹤訂單");
    expect(html).toContain("平台安全結帳");
    expect(html).toContain('href="/checkout/vendor-1/product-a"');
    expect(html).not.toContain("外部連結只記錄推薦點擊");
  });
});
