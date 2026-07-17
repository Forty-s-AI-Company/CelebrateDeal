import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamFunnelPublicPage } from "./team-funnel-public-page";

describe("TeamFunnelPublicPage", () => {
  it("renders structured content as escaped text and exposes accessible partner links", () => {
    const html = renderToStaticMarkup(<TeamFunnelPublicPage view={{
      state: "ready",
      page: {
        slug: "partner-b",
        headline: "活動標題",
        subheadline: null,
        body: [{ type: "paragraph", text: "<script>alert(1)</script>" }],
        cta: { label: "報名", href: "/form/register-b?ref=B" },
        partner: { name: "B 夥伴", email: "b@example.test", referralCode: "B" },
        webinar: {
          title: "A 的講座", startsAt: "2026-07-17T10:00:00.000Z",
          playbackHref: "/live/a", registrationHref: "/form/register-b?ref=B",
        },
        productSlots: [{ slotKey: "main_product", offerLabel: "B 的方案", url: "https://shop.example.test/b" }],
      },
    }} />);

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('href="mailto:b@example.test"');
    expect(html).toContain('href="/form/register-b?ref=B"');
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders a clear safe state when a required resource is missing", () => {
    const html = renderToStaticMarkup(<TeamFunnelPublicPage view={{ state: "missing_slot" }} />);
    expect(html).toContain("推薦內容尚未完成");
    expect(html).toContain('role="status"');
  });

  it("renders an explicit empty state when the optional activity description is absent", () => {
    const html = renderToStaticMarkup(<TeamFunnelPublicPage view={{
      state: "ready",
      page: {
        slug: "partner-b",
        headline: "活動標題",
        subheadline: null,
        body: [],
        cta: { label: "報名", href: "/form/register-b?ref=B" },
        partner: { name: "B 夥伴", email: null, referralCode: "B" },
        webinar: {
          title: "A 的講座", startsAt: "2026-07-17T10:00:00.000Z",
          playbackHref: "/live/a", registrationHref: "/form/register-b?ref=B",
        },
        productSlots: [{ slotKey: "main_product", offerLabel: "B 的方案", url: "https://shop.example.test/b" }],
      },
    }} />);

    expect(html).toContain("活動說明即將更新。");
    expect(html).toContain('aria-label="活動說明"');
  });
});
