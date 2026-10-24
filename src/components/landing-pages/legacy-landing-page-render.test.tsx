import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LandingPageRenderer } from "@/components/landing-pages/landing-page-renderer";
import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { FunnelRegistrationLinkProvider } from "@/components/landing-pages/funnel-registration-links";
import type { FunnelRegistrationLinks } from "@/lib/funnel-registration-action";
import { createLandingPageContent, parseLandingPageContent } from "@/lib/landing-page-content";
import { convertParsedLegacyLandingPage } from "@/lib/legacy-landing-page-converter";

const forms = [{ id: "form_1", slug: "webinar-signup", name: "講座報名" }];
const live = { id: "live_1", slug: "autumn-live", title: "秋季直播", status: "scheduled" as const, formId: "form_1", scheduledAt: "2030-05-01T12:00:00.000Z" };

/** Every legacy block type, so the legacy public renderer's output is pinned. */
const everyBlock = parseLandingPageContent({ schemaVersion: 1, data: { root: { props: { title: "舊版頁面", style: { backgroundColor: "#fafafa" } } }, content: [
  { type: "Heading", props: { id: "heading", text: "主標題", level: "h1", style: { textAlign: "center", fontSize: "4xl", mobile: { hidden: true } } } },
  { type: "Text", props: { id: "text", text: "第一行\n第二行" } },
  { type: "Image", props: { id: "image", src: "/images/cover.png", alt: "封面", caption: "圖說" } },
  { type: "Video", props: { id: "video", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "YouTube 影片" } },
  { type: "Button", props: { id: "button", label: "填寫報名表", action: { type: "registration", formId: "form_1" } } },
  { type: "Section", props: { id: "section", anchorId: "register", children: [{ type: "Text", props: { id: "section_text", text: "區段內文" } }] } },
  { type: "Columns", props: { id: "columns", columns: "two", ratio: "wideFirst", first: [{ type: "Text", props: { id: "left", text: "左欄" } }], second: [{ type: "Text", props: { id: "right", text: "右欄" } }] } },
  { type: "Speaker", props: { id: "speaker", name: "王老師", role: "顧問", bio: "十年經驗", imageUrl: "/speaker.png" } },
  { type: "Benefits", props: { id: "benefits", title: "你會獲得", items: [{ title: "亮點一", description: "說明一" }] } },
  { type: "Agenda", props: { id: "agenda", title: "流程", items: [{ time: "19:00", title: "開場" }] } },
  { type: "Carousel", props: { id: "carousel", title: "精彩畫面", slides: [{ imageUrl: "/s1.png", alt: "第一張", title: "現場" }] } },
  { type: "Pricing", props: { id: "pricing", title: "方案", plans: [{ name: "標準", price: "NT$ 990", features: ["回放"], label: "熱門", action: { type: "external", href: "https://example.com/buy" } }] } },
  { type: "Countdown", props: { id: "countdown", title: "報名倒數", mode: "fixed_date", targetAt: "2030-01-01T00:00:00+08:00", ctaLabel: "保留席次", ctaAction: { type: "anchor", targetId: "register" }, expiredMessage: "報名已截止" } },
  { type: "Testimonials", props: { id: "testimonials", title: "學員心得", items: [{ quote: "很實用", name: "小美", role: "學員" }] } },
  { type: "FAQ", props: { id: "faq", title: "常見問題", items: [{ question: "有回放嗎？", answer: "有。" }] } },
  { type: "CTA", props: { id: "cta", title: "準備好了嗎？", ctaLabel: "我要報名", ctaAction: { type: "external", href: "https://example.com/join" } } },
] } });

describe("legacy public renderer (published legacy versions keep rendering until republished)", () => {
  // The countdown renders the remaining time; pin the clock so the snapshot is stable.
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2029-12-30T00:00:00.000Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders the webinar template exactly as before", () => {
    const html = renderToStaticMarkup(<LandingPageRenderer content={createLandingPageContent("webinar", "form_1")} context={{ pageId: "page_1", forms, live }} />);
    expect(html).toContain('href="/form/webinar-signup?liveId=live_1&amp;lp=page_1"');
    expect(html).toMatchSnapshot();
  });

  it("renders every legacy block type exactly as before", () => {
    if (!everyBlock) throw new Error("fixture is not valid legacy content");
    expect(renderToStaticMarkup(<LandingPageRenderer content={everyBlock} context={{ pageId: "page_1", forms, live }} />)).toMatchSnapshot();
  });
});

describe("converted legacy page in the new renderer", () => {
  const links = { pageId: "page_1", forms, live };
  const render = (document: PageDocument, value: FunnelRegistrationLinks = links) => renderToStaticMarkup(<FunnelRegistrationLinkProvider value={value}><FunnelPageDocumentRenderer document={document} mode="preview" publicSurface /></FunnelRegistrationLinkProvider>);
  const converted = () => {
    const result = convertParsedLegacyLandingPage(createLandingPageContent("webinar", "form_1"), { id: "page_1", forms, live });
    if (!result.ok) throw new Error(result.reason);
    return result.document;
  };
  const button = (id: string, action: FunnelNode["actions"][number]): FunnelNode => ({ schemaVersion: 1, id, type: "button", props: { label: id }, style: {}, overrides: {}, visible: true, actions: [action], attributes: {} });
  const page = (nodes: FunnelNode[]): PageDocument => ({ ...createEmptyPageDocument("links", "連結"), root: [{ schemaVersion: 1, id: "s", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "r", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: nodes }] }] });

  it("renders the converted webinar template with the legacy registration destination and attribution", () => {
    const html = render(converted());
    expect(html).toContain("<h1");
    expect(html).toContain("用一場直播，讓對的人認識你的價值");
    expect(html.match(/href="\/form\/webinar-signup\?liveId=live_1&amp;lp=page_1"/gu)).toHaveLength(2);
  });

  it("follows a renamed form slug and a re-bound live, because neither is stored in the document", () => {
    const html = render(converted(), { pageId: "page_1", forms: [{ id: "form_1", slug: "renamed-signup" }], live: { id: "live_2", formId: "form_1" } });
    expect(html.match(/href="\/form\/renamed-signup\?liveId=live_2&amp;lp=page_1"/gu)).toHaveLength(2);
    expect(html).not.toContain("webinar-signup");
    expect(html).not.toContain("live_1");
  });

  it("omits the live when it uses another form or the button opts out, and disables a form the server did not provide", () => {
    const document = page([
      button("bound", { type: "registration", formId: "form_1", useBoundLive: true }),
      button("unbound", { type: "registration", formId: "form_1", useBoundLive: false }),
      button("foreign", { type: "registration", formId: "form_other_vendor", useBoundLive: true }),
    ]);
    expect(render(document, { ...links, live: { id: "live_9", formId: "form_2" } })).toContain('href="/form/webinar-signup?lp=page_1">bound</a>');
    const html = render(document);
    expect(html).toContain('href="/form/webinar-signup?liveId=live_1&amp;lp=page_1">bound</a>');
    expect(html).toContain('href="/form/webinar-signup?lp=page_1">unbound</a>');
    expect(html).toMatch(/<button type="button" disabled="" aria-disabled="true" title="這個報名表已停用或不屬於此專案"[^>]*>foreign<\/button>/u);
    expect(html).not.toContain("form_other_vendor");
    // Without the server context (no provider) nothing is linked.
    expect(renderToStaticMarkup(<FunnelPageDocumentRenderer document={document} mode="preview" />)).not.toContain("/form/");
  });

  it("renders existing open_url links, including /form/ links, exactly as before", () => {
    const document = page([
      button("form-link", { type: "open_url", href: "/form/legacy-slug", newTab: false }),
      button("external", { type: "open_url", href: "https://example.com/form/x", newTab: true }),
      button("anchor", { type: "open_url", href: "#register", newTab: false }),
    ]);
    const html = render(document);
    expect(html).toContain('<a href="/form/legacy-slug" class="transition-[filter] hover:brightness-95 focus-visible:outline-offset-2"');
    expect(html).toContain('href="https://example.com/form/x" target="_blank" rel="noreferrer"');
    expect(html).toContain('href="#register"');
    expect(html).not.toContain("lp=page_1");
    // Identical with or without registration context.
    expect(renderToStaticMarkup(<FunnelPageDocumentRenderer document={document} mode="preview" publicSurface />)).toBe(html);
  });
});