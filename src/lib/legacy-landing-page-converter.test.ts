import { describe, expect, it } from "vitest";

import { parsePageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { createLandingPageContent, parseLandingPageContent, type LandingPageContent, type LandingPageLiveReference } from "@/lib/landing-page-content";
import { registrationFormIdsInContent } from "@/lib/public-landing-page-eligibility";
import { convertLegacyLandingPage, convertParsedLegacyLandingPage, legacyVideoEmbedUrl, type LegacyConversionOptions } from "@/lib/legacy-landing-page-converter";

const forms = [{ id: "form_1", slug: "webinar-signup", name: "講座報名" }];
const live: LandingPageLiveReference = { id: "live_1", slug: "autumn-live", title: "秋季直播", status: "scheduled", formId: "form_1", scheduledAt: "2030-05-01T12:00:00.000Z" };

function legacy(content: unknown[], root: Record<string, unknown> = {}): LandingPageContent {
  const parsed = parseLandingPageContent({ schemaVersion: 1, data: { root: { props: root }, content } });
  if (!parsed) throw new Error("fixture is not valid legacy content");
  return parsed;
}

function convert(content: LandingPageContent, options: LegacyConversionOptions = {}) {
  const result = convertParsedLegacyLandingPage(content, { id: "page_1", forms, ...options });
  if (!result.ok) throw new Error(`conversion failed: ${result.reason}`);
  return result;
}

function all(nodes: FunnelNode[]): FunnelNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}
const byId = (document: PageDocument, id: string) => all(document.root).find((node) => node.id === id);
const ofType = (nodes: FunnelNode[], type: FunnelNode["type"]) => all(nodes).filter((node) => node.type === type);
const section = (document: PageDocument, id: string) => {
  const found = document.root.find((node) => node.id === id);
  if (!found) throw new Error(`section ${id} not found`);
  return found;
};
const rowOf = (sectionNode: FunnelNode) => sectionNode.children![0]!;

/** Every user-visible string in a legacy tree, for the "nothing silently dropped" property. */
function legacyStrings(value: unknown, keys = new Set(["text", "title", "description", "eyebrow", "label", "ctaLabel", "name", "role", "bio", "question", "answer", "quote", "price", "time", "caption", "alt", "src", "imageUrl", "href"])): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => legacyStrings(item, keys));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (typeof item === "string" && keys.has(key) && item.trim()) return [item];
    if (key === "features" && Array.isArray(item)) return item.filter((feature): feature is string => typeof feature === "string");
    return legacyStrings(item, keys);
  });
}

const everyBlock = legacy([
  { type: "Heading", props: { id: "heading", text: "主標題", level: "h1" } },
  { type: "Text", props: { id: "text", text: "第一行\n第二行" } },
  { type: "Image", props: { id: "image", src: "/images/cover.png", alt: "封面", caption: "圖說" } },
  { type: "Video", props: { id: "video_file", src: "https://cdn.example.com/intro.mp4", title: "介紹影片" } },
  { type: "Video", props: { id: "video_youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "YouTube 影片" } },
  { type: "Button", props: { id: "button_external", label: "外部連結", action: { type: "external", href: "https://example.com/more" } } },
  { type: "Button", props: { id: "button_anchor", label: "前往報名區", action: { type: "anchor", targetId: "register" } } },
  { type: "Button", props: { id: "button_form", label: "填寫報名表", action: { type: "registration", formId: "form_1" } } },
  { type: "Section", props: { id: "section", anchorId: "register", children: [{ type: "Text", props: { id: "section_text", text: "區段內文" } }] } },
  { type: "Columns", props: { id: "columns", columns: "two", first: [{ type: "Text", props: { id: "left", text: "左欄" } }], second: [{ type: "Text", props: { id: "right", text: "右欄" } }, { type: "Image", props: { id: "right_image", src: "/r.png", alt: "右圖" } }] } },
  { type: "Hero", props: { id: "hero", eyebrow: "免費講座", title: "主視覺標題", description: "主視覺說明", imageUrl: "https://cdn.example.com/hero.jpg", ctaLabel: "立即報名", ctaAction: { type: "registration", formId: "form_1" } } },
  { type: "Speaker", props: { id: "speaker", name: "王老師", role: "顧問", bio: "十年經驗", imageUrl: "/speaker.png" } },
  { type: "Benefits", props: { id: "benefits", title: "你會獲得", items: [{ title: "亮點一", description: "說明一" }, { title: "亮點二" }] } },
  { type: "Agenda", props: { id: "agenda", title: "流程", items: [{ time: "19:00", title: "開場", description: "暖身" }, { title: "分享" }] } },
  { type: "Carousel", props: { id: "carousel", title: "精彩畫面", slides: [{ imageUrl: "/s1.png", alt: "第一張", title: "現場", description: "滿座" }, { imageUrl: "/s2.png", alt: "第二張" }] } },
  { type: "Pricing", props: { id: "pricing", title: "方案", plans: [{ name: "標準", price: "NT$ 990", description: "入門", features: ["回放", "講義"], label: "熱門", action: { type: "external", href: "https://example.com/buy" } }, { name: "進階", price: "NT$ 1,990" }] } },
  { type: "Countdown", props: { id: "countdown", title: "報名倒數", mode: "fixed_date", targetAt: "2030-01-01T00:00:00+08:00", ctaLabel: "保留席次", ctaAction: { type: "anchor", targetId: "register" }, expiredMessage: "報名已截止" } },
  { type: "Testimonials", props: { id: "testimonials", title: "學員心得", items: [{ quote: "很實用", name: "小美", role: "學員", imageUrl: "/a.png" }, { quote: "收穫滿滿", name: "阿明" }] } },
  { type: "FAQ", props: { id: "faq", title: "常見問題", items: [{ question: "有回放嗎？", answer: "有，七天內可看。" }] } },
  { type: "CTA", props: { id: "cta", title: "準備好了嗎？", description: "現在加入", ctaLabel: "我要報名", ctaAction: { type: "external", href: "https://example.com/join" } } },
], { title: "全部區塊", description: "SEO 描述", shareImage: "https://cdn.example.com/share.png" });

describe("convertLegacyLandingPage: webinar template", () => {
  const template = createLandingPageContent("webinar", "form_1");
  const result = convert(template, { live });

  it("produces a document that passes parsePageDocument with every legacy block as its own section", () => {
    expect(parsePageDocument(result.document)).toEqual(result.document);
    expect(result.document.id).toBe("page_1");
    expect(result.document.name).toBe("線上講座報名頁");
    expect(result.document.settings.seo).toMatchObject({ title: "線上講座報名頁", description: "線上講座報名頁" });
    expect(result.document.root.map((node) => node.id)).toEqual(["hero", "benefits", "speaker", "agenda", "faq", "register"]);
    expect(result.document.root.every((node) => node.type === "section" && node.children?.[0]?.type === "row")).toBe(true);
  });

  it("keeps every visible string of the template", () => {
    const serialized = JSON.stringify(result.document);
    for (const value of legacyStrings(template.data.content)) expect(serialized).toContain(JSON.stringify(value).slice(1, -1));
  });

  it("turns registration actions into the same hosted-form link, carrying the bound live", () => {
    const buttons = ofType(result.document.root, "button");
    expect(buttons.map((node) => node.props.label)).toEqual(["立即保留席次", "立即報名"]);
    for (const node of buttons) expect(node.actions).toEqual([{ type: "open_url", href: "/form/webinar-signup?liveId=live_1", newTab: false }]);
    // Bindings live in links, not in legacy action objects the server would re-validate as registrations.
    expect(registrationFormIdsInContent(result.document).size).toBe(0);
  });

  it("omits liveId when the bound live uses a different form, like the legacy renderer", () => {
    const other = convert(template, { live: { ...live, formId: "form_other" } });
    expect(ofType(other.document.root, "button")[0]!.actions).toEqual([{ type: "open_url", href: "/form/webinar-signup", newTab: false }]);
  });

  it("is deterministic and keeps node ids stable across runs", () => {
    const again = convert(createLandingPageContent("webinar", "form_1"), { live });
    expect(again).toEqual(result);
    expect(JSON.stringify(again.document)).toBe(JSON.stringify(result.document));
  });

  it("reports nothing that the template does not need", () => {
    expect(result.issues).toEqual([]);
  });

  it("converts the blank template to an empty document", () => {
    const blank = convert(createLandingPageContent("blank"));
    expect(blank.document.root).toEqual([]);
    expect(blank.issues).toEqual([]);
    expect(parsePageDocument(blank.document)).not.toBeNull();
  });
});

describe("convertLegacyLandingPage: every legacy block type", () => {
  const result = convert(everyBlock, { live });
  const document = result.document;
  const issueFor = (blockId: string) => result.issues.filter((issue) => issue.blockId === blockId).map((issue) => issue.message).join("\n");

  it("validates and preserves every visible string", () => {
    expect(parsePageDocument(document)).toEqual(document);
    const serialized = JSON.stringify(document);
    for (const value of legacyStrings(everyBlock.data.content)) expect(serialized).toContain(JSON.stringify(value).slice(1, -1));
    expect(document.settings.seo).toMatchObject({ title: "全部區塊", description: "SEO 描述", socialImage: "https://cdn.example.com/share.png" });
  });

  it("maps basic elements", () => {
    expect(rowOf(section(document, "heading")).children).toEqual([expect.objectContaining({ id: "heading-headline", type: "headline", props: { text: "主標題", level: "h1" } })]);
    expect(byId(document, "text-text")).toMatchObject({ type: "text", props: { text: "第一行\n第二行" } });
    expect(byId(document, "image-image")).toMatchObject({ type: "image", props: { src: "/images/cover.png", alt: "封面", caption: "圖說" }, style: { imageWidth: 100 } });
    expect(byId(document, "video_file-video")).toMatchObject({ type: "video", props: { src: "https://cdn.example.com/intro.mp4", title: "介紹影片" } });
  });

  it("maps every button action", () => {
    expect(byId(document, "button_external-button")?.actions).toEqual([{ type: "open_url", href: "https://example.com/more", newTab: false }]);
    expect(byId(document, "button_anchor-button")?.actions).toEqual([{ type: "open_url", href: "#register", newTab: false }]);
    expect(byId(document, "button_form-button")?.actions).toEqual([{ type: "open_url", href: "/form/webinar-signup?liveId=live_1", newTab: false }]);
    expect(byId(document, "button_form-button")?.style).toMatchObject({ backgroundColor: "#1d4ed8", color: "#ffffff" });
  });

  it("keeps YouTube videos as a visible link and reports the missing embed", () => {
    const row = rowOf(section(document, "video_youtube"));
    expect(row.children!.map((node) => node.type)).toEqual(["headline", "button"]);
    expect(row.children![1]!.actions).toEqual([{ type: "open_url", href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", newTab: true }]);
    expect(issueFor("video_youtube")).toContain("YouTube／Vimeo");
  });

  it("keeps the section anchor as an HTML id", () => {
    expect(section(document, "section").attributes).toEqual({ id: "register" });
    expect(rowOf(section(document, "section")).children?.[0]).toMatchObject({ id: "section_text", type: "text" });
  });

  it("turns columns into a grid with one cell per column", () => {
    const grid = rowOf(section(document, "columns")).children![0]!;
    expect(grid).toMatchObject({ id: "columns-grid", type: "columns_2", props: { gap: 24 } });
    expect(grid.children!.map((node) => node.type)).toEqual(["text", "content_box"]);
    expect(grid.children![1]!.children!.map((node) => node.id)).toEqual(["right", "right_image"]);
  });

  it("maps the conversion blocks to editable elements", () => {
    const hero = rowOf(section(document, "hero"));
    expect(hero.style).toMatchObject({ backgroundColor: "#1e3a8a", color: "#ffffff", borderRadius: 24 });
    expect(hero.children!.map((node) => node.type)).toEqual(["text", "headline", "text", "button", "image"]);
    expect(hero.children![1]).toMatchObject({ props: { text: "主視覺標題", level: "h1" }, style: { color: "#ffffff" } });
    expect(issueFor("hero")).toContain("背景圖片");

    expect(ofType([section(document, "speaker")], "image")[0]).toMatchObject({ props: { src: "/speaker.png", alt: "王老師照片" } });
    expect(ofType([section(document, "benefits")], "columns_2")[0]!.children).toHaveLength(2);
    expect(ofType([section(document, "agenda")], "headline").map((node) => node.props.text)).toEqual(["流程", "開場", "分享"]);
    expect(ofType([section(document, "carousel")], "columns_3")[0]!.children).toHaveLength(2);
    expect(issueFor("carousel")).toContain("輪播");

    const pricing = section(document, "pricing");
    expect(ofType([pricing], "columns_3")[0]!.children).toHaveLength(2);
    expect(ofType([pricing], "bulleted_list")[0]!.props.items).toEqual(["回放", "講義"]);
    expect(ofType([pricing], "button")).toEqual([expect.objectContaining({ props: { label: "選擇此方案" }, actions: [{ type: "open_url", href: "https://example.com/buy", newTab: false }] })]);

    expect(ofType([section(document, "testimonials")], "text").map((node) => node.props.text)).toEqual(["「很實用」", "「收穫滿滿」"]);
    expect(ofType([section(document, "faq")], "faq")[0]).toMatchObject({ props: { items: [{ question: "有回放嗎？", answer: "有，七天內可看。" }] }, children: [] });
    expect(ofType([section(document, "cta")], "button")[0]!.style).toMatchObject({ backgroundColor: "#ffffff", color: "#1e3a8a" });
  });

  it("maps a fixed countdown and reports its expiry behaviour", () => {
    const timer = ofType([section(document, "countdown")], "countdown")[0]!;
    expect(timer.props).toMatchObject({ targetDate: "2030-01-01T00:00:00+08:00", expiredMessage: "報名已截止", expiredAction: "show_message" });
    expect(ofType([section(document, "countdown")], "button")[0]!.actions).toEqual([{ type: "open_url", href: "#register", newTab: false }]);
    expect(issueFor("countdown")).toContain("報名已截止");
  });
});

describe("convertLegacyLandingPage: bindings and settings", () => {
  it("binds live-linked countdowns to the bound live's start time, and reports when no live is bound", () => {
    const content = legacy([{ type: "Countdown", props: { id: "timer", mode: "live_linked", expiredMessage: "結束", expiredAction: "hide_cta" } }]);
    const linked = convert(content, { live });
    expect(ofType(linked.document.root, "countdown")[0]!.props.targetDate).toBe("2030-05-01T12:00:00.000Z");
    expect(linked.issues.map((issue) => issue.message).join()).toContain("固定截止時間");
    const unbound = convert(content);
    expect(ofType(unbound.document.root, "countdown")[0]!.props.targetDate).toBeUndefined();
    expect(unbound.issues.map((issue) => issue.message).join()).toContain("沒有綁定直播");
    expect(unbound.issues.map((issue) => issue.message).join()).toContain("隱藏報名按鈕");
  });

  it("never invents a link for a registration form outside the merchant's project", () => {
    const result = convert(legacy([{ type: "Button", props: { id: "cta", label: "報名", action: { type: "registration", formId: "foreign_form" } } }]));
    expect(ofType(result.document.root, "button")[0]!.actions).toEqual([{ type: "none" }]);
    expect(result.issues).toEqual([expect.objectContaining({ blockId: "cta", blockLabel: "按鈕", message: expect.stringContaining("報名表已停用") })]);
  });

  it("reports a CTA label that had no action instead of creating a dead button", () => {
    const result = convert(legacy([{ type: "CTA", props: { id: "cta", title: "標題", ctaLabel: "孤兒按鈕" } }]));
    expect(ofType(result.document.root, "button")).toEqual([]);
    expect(result.issues[0]!.message).toContain("孤兒按鈕");
  });

  it("moves block styles to the section row and text size to the text node", () => {
    const result = convert(legacy([
      { type: "Heading", props: { id: "title", text: "標題", level: "h2", style: { backgroundColor: "#ffeedd", color: "#112233", textAlign: "center", padding: "lg", maxWidth: "md", borderRadius: "lg", fontSize: "4xl", fontWeight: "black", mobile: { hidden: true, padding: "sm", fontSize: "xl" } } } },
    ]));
    const sectionNode = section(result.document, "title");
    const row = rowOf(sectionNode);
    expect(row.style).toMatchObject({ backgroundColor: "#ffeedd", color: "#112233", textAlign: "center", padding: 32, borderRadius: 16, width: "min(100%, 768px)", margin: "0px auto" });
    expect(row.overrides.mobile?.style).toEqual({ padding: 12 });
    expect(sectionNode.overrides.mobile?.visible).toBe(false);
    expect(row.children![0]).toMatchObject({ type: "headline", style: { fontSize: 36 }, overrides: { mobile: { style: { fontSize: 20 } } } });
    expect(result.issues).toEqual([expect.objectContaining({ blockId: "title", message: expect.stringContaining("字重") })]);
  });

  it("maps page-level settings and reports page styles without an equivalent", () => {
    const result = convert(legacy([], { title: "頁面", style: { backgroundColor: "#fafafa", color: "#222222", textAlign: "center", maxWidth: "lg" } }), { name: "商家命名" });
    expect(result.document.name).toBe("商家命名");
    expect(result.document.settings.background.color).toBe("#fafafa");
    expect(result.document.settings.typography).toMatchObject({ textColor: "#222222", alignment: "center" });
    expect(result.issues).toEqual([expect.objectContaining({ blockId: "page", blockType: "Page", message: expect.stringContaining("頁面最大寬度") })]);
  });
});

describe("convertLegacyLandingPage: nesting", () => {
  it("flattens unstyled nested sections and wraps styled ones in a content box", () => {
    const result = convert(legacy([{ type: "Section", props: { id: "outer", children: [
      { type: "Section", props: { id: "plain", children: [{ type: "FAQ", props: { id: "faq", items: [{ question: "Q", answer: "A" }] } }] } },
      { type: "Section", props: { id: "styled", anchorId: "more", style: { backgroundColor: "#eeeeee" }, children: [
        { type: "FAQ", props: { id: "inner_faq", title: "巢狀問答", items: [{ question: "Q2", answer: "A2" }] } },
        { type: "Countdown", props: { id: "inner_timer", mode: "fixed_date", targetAt: "2030-01-01T00:00:00+08:00", expiredMessage: "結束" } },
      ] } },
    ] } }]));
    const row = rowOf(section(result.document, "outer"));
    // The unstyled section's FAQ stays a real FAQ element directly in the row.
    expect(row.children!.map((node) => node.type)).toEqual(["faq", "content_box"]);
    const styled = row.children![1]!;
    expect(styled).toMatchObject({ id: "styled", attributes: { id: "more" }, style: { backgroundColor: "#eeeeee" } });
    expect(ofType([styled], "faq")).toEqual([]);
    expect(ofType([styled], "countdown")).toEqual([]);
    expect(JSON.stringify(styled)).toContain("Q2");
    expect(JSON.stringify(styled)).toContain("截止時間：2030-01-01T00:00:00+08:00");
    const messages = result.issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain("可展開的問答元件");
    expect(messages).toContain("倒數元件");
  });

  it("stacks nested columns, keeps never-shown slots hidden, and reports ratios", () => {
    const result = convert(legacy([{ type: "Columns", props: { id: "outer", columns: "two", ratio: "wideFirst",
      first: [{ type: "Columns", props: { id: "inner", columns: "two", first: [{ type: "Text", props: { id: "a", text: "A" } }], second: [{ type: "Text", props: { id: "b", text: "B" } }] } }],
      second: [],
      third: [{ type: "Text", props: { id: "hidden_text", text: "原本不顯示" } }] } }]));
    const row = rowOf(section(result.document, "outer"));
    expect(row.children!.map((node) => node.type)).toEqual(["columns_2", "content_box"]);
    expect(row.children![1]).toMatchObject({ visible: false });
    expect(byId(result.document, "hidden_text")).toMatchObject({ props: { text: "原本不顯示" } });
    expect(ofType(row.children!, "columns_2")).toHaveLength(1);
    const messages = result.issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain("兩欄寬度比例");
    expect(messages).toContain("上下排列");
    expect(messages).toContain("第 3 欄");
    expect(parsePageDocument(result.document)).not.toBeNull();
  });

  it("keeps the dark hero card when nested, and never leaves white text on the plain page", () => {
    const result = convert(legacy([{ type: "Section", props: { id: "outer", children: [
      { type: "Hero", props: { id: "nested_hero", eyebrow: "眉標", title: "巢狀主視覺", ctaLabel: "報名", ctaAction: { type: "anchor", targetId: "x" } } },
      { type: "Section", props: { id: "box", style: { padding: "md" }, children: [
        { type: "Hero", props: { id: "boxed_hero", eyebrow: "眉標二", title: "盒內主視覺", ctaLabel: "報名二", ctaAction: { type: "anchor", targetId: "x" } } },
        { type: "Button", props: { id: "boxed_button", label: "盒內按鈕", action: { type: "anchor", targetId: "x" }, style: { backgroundColor: "#000000", textAlign: "center" } } },
      ] } },
    ] } }]));
    const card = byId(result.document, "nested_hero")!;
    expect(card).toMatchObject({ type: "content_box", style: { backgroundColor: "#1e3a8a", color: "#ffffff" } });
    expect(ofType([card], "headline")[0]!.style.color).toBe("#ffffff");
    // A content box cannot hold another box: the hero is unwrapped, so it uses the plain palette.
    const boxed = byId(result.document, "box")!;
    const boxedTitle = boxed.children!.find((node) => node.id === "boxed_hero-title")!;
    expect(boxedTitle.style.color).toBeUndefined();
    expect(boxed.children!.find((node) => node.id === "boxed_hero-cta")!.style).toMatchObject({ backgroundColor: "#1d4ed8", color: "#ffffff" });
    expect(byId(result.document, "boxed_button")).toMatchObject({ type: "button", style: { textAlign: "center", backgroundColor: "#1d4ed8" } });
    expect(result.issues.filter((issue) => issue.blockId === "boxed_button").map((issue) => issue.message).join()).toContain("巢狀位置");
    expect(parsePageDocument(result.document)).not.toBeNull();
  });

  it("removes a duplicated anchor and reports it", () => {
    const result = convert(legacy([
      { type: "Section", props: { id: "first", anchorId: "register", children: [] } },
      { type: "Section", props: { id: "second", anchorId: "register", children: [] } },
    ]));
    expect(section(result.document, "first").attributes).toEqual({ id: "register" });
    expect(section(result.document, "second").attributes).toEqual({});
    expect(result.issues).toEqual([expect.objectContaining({ blockId: "second", message: expect.stringContaining("錨點「register」") })]);
  });
});

describe("convertLegacyLandingPage: ids and invalid input", () => {
  it("derives unique ids even when legacy ids look like derived ones", () => {
    const longId = "x".repeat(100);
    const result = convert(legacy([
      { type: "Text", props: { id: "a", text: "一" } },
      { type: "Text", props: { id: "a-row", text: "二" } },
      { type: "Text", props: { id: "a-text", text: "三" } },
      { type: "Hero", props: { id: longId, title: "長 ID" } },
    ]));
    const ids = all(result.document.root).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length <= 100 && /^[A-Za-z0-9_-]+$/u.test(id))).toBe(true);
    expect(ids).toEqual(expect.arrayContaining(["a", "a-row", "a-text", longId]));
  });

  it("fails closed on content that is not valid legacy content", () => {
    expect(convertLegacyLandingPage(null)).toEqual({ ok: false, reason: "invalid_legacy_content" });
    expect(convertLegacyLandingPage({ schemaVersion: 1, data: { root: {}, content: [{ type: "Marquee", props: { id: "m" } }] } })).toEqual({ ok: false, reason: "invalid_legacy_content" });
    expect(convertLegacyLandingPage({ schemaVersion: 2, data: { root: {}, content: [] } })).toEqual({ ok: false, reason: "invalid_legacy_content" });
  });

  it("keeps an unknown block visible as a placeholder instead of dropping it", () => {
    const forged = { schemaVersion: 1, data: { root: {}, content: [{ type: "Marquee", props: { id: "marquee" } }] } } as unknown as LandingPageContent;
    const result = convert(forged);
    expect(JSON.stringify(result.document)).toContain("無法轉換的舊版區塊（Marquee）");
    expect(result.issues).toEqual([expect.objectContaining({ blockId: "marquee", message: expect.stringContaining("Marquee") })]);
  });

  it("returns conversion_invalid instead of an unsafe document when limits are exceeded", () => {
    const plans = Array.from({ length: 6 }, (_, index) => ({ name: `方案${index}`, price: "NT$ 1", features: Array.from({ length: 20 }, (_, feature) => `特色${feature}`), label: "標籤", description: "說明", action: { type: "external", href: "https://example.com" } }));
    const content = { schemaVersion: 1, data: { root: {}, content: Array.from({ length: 24 }, (_, index) => ({ type: "Pricing", props: { id: `p${index}`, title: "方案", plans } })) } } as const;
    expect(convertLegacyLandingPage(content)).toEqual({ ok: false, reason: "conversion_invalid" });
  });

  it("recognises the same embeddable video hosts as the legacy renderer", () => {
    expect(legacyVideoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(legacyVideoEmbedUrl("https://vimeo.com/123456789")).toBe("https://player.vimeo.com/video/123456789");
    expect(legacyVideoEmbedUrl("https://cdn.example.com/a.mp4")).toBeNull();
  });
});
