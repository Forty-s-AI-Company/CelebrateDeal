import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { FunnelPageDocumentRenderer, funnelBackgroundImageValue } from "@/components/landing-pages/funnel-page-document-renderer";
import { FUNNEL_BLOCK_REGISTRY, instantiateBlock } from "@/lib/funnel-block-library";
import { RegistrationRetryProvider } from "@/components/registration-retry-context";

function node(type: FunnelNode["type"], id: string, extra: Partial<FunnelNode> | FunnelNode[] = {}): FunnelNode {
  const details = Array.isArray(extra) ? { children: extra } : extra;
  return { schemaVersion: 1, id, type, props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...details };
}

function documentWith(nodes: FunnelNode[]): PageDocument {
  return {
    ...createEmptyPageDocument("renderer-test", "渲染測試"),
    root: [node("section", "section", [node("row", "row", nodes)])],
  };
}

describe("FunnelPageDocumentRenderer", () => {
  it("keeps a renderer snapshot signature for every registered commercial block variant", () => {
    const signatures = Object.values(FUNNEL_BLOCK_REGISTRY).map((template) => {
      const block = instantiateBlock(template.id);
      const page = { ...createEmptyPageDocument(`renderer-${template.id}`, template.label), root: [block] };
      const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} mode="editor" />);
      return {
        id: template.id,
        category: template.category,
        sections: (html.match(/data-funnel-node-type="section"/gu) ?? []).length,
        editableNodes: (html.match(/data-funnel-node-id=/gu) ?? []).length,
        hasHorizontalOverflowGuard: html.includes("min-w-0"),
      };
    });
    expect(signatures).toMatchSnapshot();
  });

  it("renders the supported Section/Row/Column/Element hierarchy with safe attributes", () => {
    const page = documentWith([
      node("columns_2", "columns", { children: [node("text", "text", { props: { text: "歡迎來到 CelebrateDeal" }, attributes: { id: "hero-copy", "data-testid": "copy" } })] }),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} mode="editor" selectedNodeId="text" />);
    expect(html).toContain("歡迎來到 CelebrateDeal");
    expect(html).toContain('data-funnel-node-id="text"');
    expect(html).toContain('data-funnel-selected="true"');
    expect(html).toContain('id="hero-copy"');
    expect(html).toContain('data-testid="copy"');
  });

  it("applies base plus mobile overrides without duplicating the page tree", () => {
    const text = node("text", "responsive-text", { props: { text: "響應式內容" }, style: { fontSize: 40, padding: 24 }, overrides: { mobile: { style: { fontSize: 18, padding: 8 }, visible: true } } });
    const page = documentWith([text]);
    const desktop = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} viewport="desktop" />);
    const mobile = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} viewport="mobile" />);
    expect(desktop).toContain("font-size:40px");
    expect(desktop).toContain("padding:24px");
    expect(mobile).toContain("font-size:18px");
    expect(mobile).toContain("padding:8px");
    expect(mobile.match(/響應式內容/g)).toHaveLength(1);
  });

  it("never executes raw HTML, payment, or reCAPTCHA nodes and exposes their capability state", () => {
    const page = documentWith([
      node("raw_html", "raw", { props: { html: "<script>window.pwned=true</script>" } }),
      node("payment_button", "payment"),
      node("recaptcha", "captcha"),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("window.pwned");
    expect(html).toContain("原始 HTML 已在 sandbox 隔離預覽");
    expect(html).toContain('sandbox=""');
    expect(html).toContain("尚未連結商品與付款方式");
    expect(html).toContain("reCAPTCHA");
    expect(html).toContain("server verification 與網域設定");
  });

  it("allows only validated HTTPS or same-site action hrefs", () => {
    const page = documentWith([
      node("button", "safe-button", { props: { label: "安全連結" }, actions: [{ type: "open_url", href: "https://example.com/offer", newTab: true }] }),
      node("button", "unsafe-button", { props: { label: "不安全連結", action: { type: "open_url", href: "javascript:alert(1)", newTab: false } } }),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).toContain('href="https://example.com/offer"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('disabled=""');
  });

  it("keeps validated Popup and form button actions executable without rendering unsafe code", () => {
    const page = documentWith([
      node("button", "popup-button", { props: { label: "開啟優惠" }, actions: [{ type: "show_popup", popupId: "popup_offer" }] }),
      node("button", "submit-button", { props: { label: "送出" }, actions: [{ type: "submit_form", formId: "lead_form" }] }),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).toContain("開啟優惠");
    expect(html).toContain('type="button"');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("script");
  });

  it("renders a validated next_step action as a same-Funnel public route", () => {
    const page = documentWith([node("button", "next", { props: { label: "下一步" }, actions: [{ type: "next_step", stepId: "thanks" }] })]);
    page.flow = {
      schemaVersion: 1,
      id: "flow",
      name: "名單 Funnel",
      goal: "audience",
      domain: "spring-list",
      currency: "TWD",
      capabilities: { webinar: { status: "unverified", reason: "尚未驗證" } },
      steps: [
        { schemaVersion: 1, id: "lead", name: "名單頁", path: "opt-in", type: "opt_in_page", template: { source: "blank" }, isSystem: false },
        { schemaVersion: 1, id: "thanks", name: "感謝頁", path: "thank-you", type: "opt_in_thank_you_page", template: { source: "blank" }, isSystem: false },
        { schemaVersion: 1, id: "inactive", name: "停用頁", path: "inactive", type: "inactive_page", template: { source: "system" }, isSystem: true },
      ],
    };
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).toContain('href="/lp/spring-list/thank-you"');
    expect(html).not.toContain('disabled=""');
  });

  it("renders safe media and form elements without external submission", () => {
    const page = documentWith([
      node("video", "video", { props: { src: "https://cdn.example.com/demo.mp4", poster: "/poster.jpg" } }),
      node("audio", "audio", { props: { src: "/audio.mp3" } }),
      node("form", "form", { props: { title: "聯絡我們" }, children: [
        node("form_input", "email", { props: { label: "Email", inputType: "email", required: true } }),
        node("checkbox", "consent", { props: { label: "我同意接收通知" } }),
      ] }),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).toContain("video");
    expect(html).toContain('src="https://cdn.example.com/demo.mp4"');
    expect(html).toContain('src="/audio.mp3"');
    expect(html).toContain("聯絡我們");
    expect(html).toContain('type="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain("我同意接收通知");
    expect(html).not.toContain("action=");
  });

  it("公開頁只使用伺服器驗證過的 Registration Form 欄位", () => {
    const page = documentWith([node("form", "authored-form", { children: [node("form_input", "forged", { props: { name: "admin", label: "不可信欄位" } })] })]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} submission={{ landingPageId: "page-1", form: { id: "form-1", submitLabel: "加入名單", successMessage: "收到", fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ] } }} />);
    expect(html).toContain('name="name"');
    expect(html).toContain('name="email"');
    expect(html).toContain("加入名單");
    expect(html).not.toContain('name="admin"');
  });

  it("公開頁未綁定 Registration Form 時明確停用，不顯示假送出流程", () => {
    const page = documentWith([node("form", "unbound-form", { children: [node("button", "submit", { actions: [{ type: "submit_form", formId: "unbound-form" }] })] })]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} publicSurface />);
    expect(html).toContain("尚未綁定可公開使用的報名表");
    expect(html).not.toContain('type="submit"');
  });

  it("公開 Calendar 只採用 server-resolved event metadata", () => {
    const page = documentWith([node("calendar", "calendar", { props: { eventId: "event-1", title: "偽造標題", timezone: "UTC" } })]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} publicSurface consultation={{ csrfToken: "synthetic-csrf", events: [{ id: "event-1", title: "可信諮詢", description: "由服務端解析", timezone: "Asia/Taipei", durationMinutes: 45, intakeFormFields: [] }] }} />);
    expect(html).toContain("可信諮詢");
    expect(html).toContain("Asia/Taipei");
    expect(html).toContain("45 分鐘");
    expect(html).not.toContain("偽造標題");
  });

  it("公開 Survey 僅能綁定既有表單欄位並一起收集必要 identity", () => {
    const page = documentWith([node("survey", "survey", { props: { name: "preference", question: "偏好時段", options: ["上午", "下午"], required: true } })]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} publicSurface submission={{ landingPageId: "page-1", form: { id: "form-1", submitLabel: "送出", successMessage: "已保存", fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "preference", label: "偏好", type: "text", required: true },
    ] } }} />);
    expect(html).toContain("偏好時段");
    expect(html).toContain('name="preference"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="email"');
    expect(html).not.toContain("未授權");
  });

  it("renders interactive content with explicit unavailable states", () => {
    const page = documentWith([
      node("carousel", "carousel", { props: { ariaLabel: "案例輪播" }, children: [] }),
      node("calendar", "calendar", { props: {} }),
      node("survey", "survey", { props: { question: "偏好的時段？", options: ["上午", "下午"] } }),
      node("countdown", "countdown", { props: { targetDate: "2030-01-01T00:00:00.000Z" } }),
      node("menu", "menu", { props: { items: [{ label: "首頁", href: "/" }, { label: "不安全", href: "javascript:alert(1)" }] } }),
      node("x_share_button", "share", { props: { url: "https://celebratedeal.example/page" } }),
      node("faq", "faq", { props: { question: "如何開始？" }, children: [node("text", "answer", { props: { text: "填寫表單即可。" } })] }),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).toContain('data-funnel-carousel="true"');
    expect(html).toContain("尚未綁定行事曆事件");
    expect(html).toContain("偏好的時段？");
    expect(html).toContain("2030");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("分享到 X");
    expect(html).toContain("如何開始？");
    expect(html).toContain("填寫表單即可。");
  });

  it("never renders unsafe media URLs or executes raw HTML", () => {
    const page = documentWith([
      node("video", "unsafe-video", { props: { src: "javascript:alert(1)" } }),
      node("audio", "unsafe-audio", { props: { src: "data:audio/wav;base64,ZmFrZQ==" } }),
      node("raw_html", "raw", { props: { html: "<img src=x onerror=alert(1)>" } }),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:audio");
    expect(html).not.toContain("onerror");
    expect(html).toContain("影片網址不安全或尚未設定");
    expect(html).toContain("音訊網址不安全或尚未設定");
  });
});

it("posts the boundary's validated ref/share attribution in the native funnel form fallback", () => {
  const page = documentWith([node("form", "lead-form", { children: [node("form_input", "lead-email", { props: { name: "email", label: "Email" } })] })]);
  const fields = [{ key: "name", label: "姓名", type: "text" as const, required: true }, { key: "email", label: "Email", type: "email" as const, required: true }];
  const render = (attribution?: { referralCode?: string; shareCode?: string }) => renderToStaticMarkup(<RegistrationRetryProvider value={{ formId: "form-1", sourcePath: "/lp/campaign", draft: null, failed: false, attribution }}>
    <FunnelPageDocumentRenderer document={page} submission={{ landingPageId: "page-1", funnelStepId: "opt_in", form: { id: "form-1", submitLabel: "送出", successMessage: "收到", fields } }} />
  </RegistrationRetryProvider>);
  const html = render({ referralCode: "synthetic-ref", shareCode: `tls1.${"b".repeat(32)}` });
  expect(html).toContain('name="referralCode" value="synthetic-ref"');
  expect(html).toContain(`name="shareCode" value="tls1.${"b".repeat(32)}"`);
  // The funnel page itself stays the landingPageId; attribution never overrides it.
  expect(html).toContain('name="landingPageId" value="page-1"');
  expect(render()).toContain('name="referralCode" value=""');
});

function surfaceStyle(html: string, nodeId: string): string {
  return new RegExp(`data-funnel-node-id="${nodeId}"[^>]*?style="([^"]*)"`, "u").exec(html)?.[1] ?? "";
}

describe("FunnelPageDocumentRenderer typography (R3)", () => {
  const heading = (id: string, level: string, extra: Partial<FunnelNode> = {}) => node("headline", id, { props: { text: `標題 ${level}`, level }, ...extra });

  it("gives H1–H4 a clear size hierarchy on desktop and scales down on mobile", () => {
    const page = documentWith([heading("h1", "h1"), heading("h2", "h2"), heading("h3", "h3"), heading("h4", "h4"), node("text", "body", { props: { text: "內文" } })]);
    const desktop = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} viewport="desktop" />);
    const mobile = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} viewport="mobile" />);
    expect(surfaceStyle(desktop, "h1")).toContain("font-size:48px");
    expect(surfaceStyle(desktop, "h1")).toContain("font-weight:800");
    expect(surfaceStyle(desktop, "h2")).toContain("font-size:36px");
    expect(surfaceStyle(desktop, "h3")).toContain("font-size:24px");
    expect(surfaceStyle(desktop, "h4")).toContain("font-size:20px");
    expect(surfaceStyle(desktop, "body")).toContain("font-size:16px");
    expect(surfaceStyle(mobile, "h1")).toContain("font-size:32px");
    expect(surfaceStyle(mobile, "h2")).toContain("font-size:26px");
    expect(desktop).toContain("<h1");
  });

  it("lets explicit node styles and device overrides win over the defaults", () => {
    const page = documentWith([heading("custom", "h1", { style: { fontSize: 30, color: "#be185d", lineHeight: 1.1 }, overrides: { mobile: { style: { fontSize: 22 } } } })]);
    const desktop = surfaceStyle(renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} viewport="desktop" />), "custom");
    const mobile = surfaceStyle(renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} viewport="mobile" />), "custom");
    expect(desktop).toContain("font-size:30px");
    expect(desktop).not.toContain("font-size:48px");
    expect(desktop).toContain("color:#be185d");
    expect(desktop).toContain("line-height:1.1");
    expect(desktop).toContain("font-weight:800");
    expect(mobile).toContain("font-size:22px");
  });

  it("applies 頁面設定 typography (size, fonts, colours) to body and headings", () => {
    const page = documentWith([heading("h1", "h1"), node("text", "lead", { props: { text: "引言", textStyle: "lead" } })]);
    page.settings.typography = { ...page.settings.typography, bodySize: 18, bodyFont: "sans-tc", headingFont: "serif-tc", headingColor: "#1e3a8a", textColor: "#334155" };
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    const root = /data-funnel-renderer="[^"]*"[^>]*style="([^"]*)"/u.exec(html)?.[1] ?? "";
    expect(root).toContain("font-size:18px");
    expect(root).toContain("color:#334155");
    expect(root).toContain("Noto Sans TC");
    expect(surfaceStyle(html, "h1")).toContain("font-size:54px");
    expect(surfaceStyle(html, "h1")).toContain("color:#1e3a8a");
    expect(surfaceStyle(html, "h1")).toContain("Noto Serif TC");
    expect(surfaceStyle(html, "lead")).toContain("font-size:22.5px");
  });

  it("renders identical content styles in editor and preview modes", () => {
    const page = documentWith([heading("h1", "h1"), node("button", "cta", { props: { label: "報名" } })]);
    const editor = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} mode="editor" />);
    const preview = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} mode="preview" />);
    expect(surfaceStyle(editor, "h1")).toBe(surfaceStyle(preview, "h1"));
    const control = (html: string) => /<button[^>]*style="([^"]*)"/u.exec(html)?.[1];
    expect(control(editor)).toBe(control(preview));
  });

  it("puts a button's colours on the control, not on its wrapper", () => {
    const page = documentWith([node("button", "cta", { props: { label: "報名" }, style: { backgroundColor: "#1d4ed8", color: "#ffffff", borderRadius: 12, width: 100 } })]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    const control = /<button[^>]*style="([^"]*)"/u.exec(html)?.[1] ?? "";
    expect(control).toContain("background-color:#1d4ed8");
    expect(control).toContain("color:#ffffff");
    expect(control).toContain("width:100%");
    expect(surfaceStyle(html, "cta")).not.toContain("background-color");
    expect(surfaceStyle(html, "cta")).toContain("width:100%");
  });

  it("lays out a horizontal row and honours row max width and column gap", () => {
    const page: PageDocument = { ...createEmptyPageDocument("layout", "版面"), root: [node("section", "s", [node("row", "r", { props: { maxWidth: 960, gap: 12 }, style: { direction: "row" }, children: [node("text", "a"), node("columns_2", "c", { props: { gap: 40 }, children: [node("text", "b")] })] })])] };
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).toMatch(/max-width:960px;margin-inline:auto;flex-direction:row/u);
    expect(html).toContain("gap:40px");
    expect(surfaceStyle(html, "r")).not.toContain("flex-direction");
  });

  it("renders a page background image only from safe URLs", () => {
    expect(funnelBackgroundImageValue("/images/bg.png")).toBe('url("/images/bg.png")');
    expect(funnelBackgroundImageValue("https://cdn.example.com/bg.png")).toBe('url("https://cdn.example.com/bg.png")');
    expect(funnelBackgroundImageValue('https://cdn.example.com/a.png");color:red;("')).toBeUndefined();
    expect(funnelBackgroundImageValue("javascript:alert(1)")).toBeUndefined();
    expect(funnelBackgroundImageValue("http://insecure.example.com/a.png")).toBeUndefined();
    const page = documentWith([node("text", "t")]);
    page.settings.background = { color: "white", imageUrl: "/images/bg.png", blur: 4 };
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).toContain("data-funnel-background");
    expect(html).toContain("blur(4px)");
  });

  it("can render without a main landmark for thumbnails", () => {
    const page = documentWith([node("text", "t")]);
    expect(renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} landmark={false} />)).not.toContain("<main");
    expect(renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />)).toContain("<main");
  });

  it("still renders a document saved before R3", () => {
    const legacy = {
      schemaVersion: 1, id: "legacy_page", name: "舊頁面", revision: 3, popups: [],
      settings: { typography: { bodyFont: "微軟正黑體", headingFont: "system-ui", bodySize: 16, bodyLineHeight: 1.5, linkColor: "#2563eb", textColor: "#0f172a", alignment: "left" }, language: "zh-TW", background: { color: "white", blur: 0 }, seo: { hideFromSearch: false }, tracking: { status: "disabled", reason: "追蹤碼與自訂程式碼需經安全整合後才可啟用", upgradeRequired: false }, affiliate: { status: "disabled", reason: "聯盟徽章尚未連接可驗證的方案資料", upgradeRequired: false } },
      root: [node("section", "s", { style: { padding: 56 }, children: [node("row", "r", { props: { maxWidth: 1120 }, children: [
        node("content_box", "box", { style: { padding: 24, borderRadius: 12 }, children: [heading("old_h1", "h1"), node("text", "old_text", { props: { text: "舊內容" } })] }),
        node("button", "old_button", { props: { label: "舊按鈕" }, style: { borderRadius: 8 }, actions: [{ type: "open_url", href: "#top", newTab: false }] }),
      ] })] })],
    } as unknown as PageDocument;
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={legacy} />);
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("舊內容");
    expect(surfaceStyle(html, "old_h1")).toContain("font-size:48px");
    expect(html).toContain("font-family:微軟正黑體");
    expect(/<a[^>]*style="([^"]*)"/u.exec(html)?.[1]).toContain("border-radius:8px");
  });
});

