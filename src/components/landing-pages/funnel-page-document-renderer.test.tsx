import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";

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
