// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyPageDocument, parsePageDocument, type PageDocument } from "@/lib/funnel-page-document";
import { createLandingPageContent } from "@/lib/landing-page-content";

const mocks = vi.hoisted(() => ({ push: vi.fn(), action: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock("@/app/actions/landing-page-actions", () => ({ landingPageAction: mocks.action }));
// Render the real canvas editor synchronously instead of through next/dynamic.
vi.mock("@/components/landing-pages/workspace-editor", async () => {
  const { FunnelPageEditor } = await import("@/components/landing-pages/funnel-page-editor");
  return {
    WorkspaceEditor: (props: { content: PageDocument; pending: boolean; onDocumentChange: (document: PageDocument) => void; chrome?: never }) => <FunnelPageEditor document={props.content} disabled={props.pending} onChange={props.onDocumentChange} chrome={props.chrome} />,
  };
});

import { LandingPageWorkspace } from "./landing-page-workspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
beforeEach(() => { vi.clearAllMocks(); });

async function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return container;
}
const button = (scope: ParentNode, name: string) => {
  const match = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === name);
  if (!match) throw new Error(`button not found: ${name}`);
  return match;
};
const click = async (element: HTMLElement) => { await act(async () => element.click()); };

function workspace(overrides: { published?: boolean } = {}) {
  const content = createEmptyPageDocument("page_doc", "合成頁面");
  return <LandingPageWorkspace page={{ id: "page-1", name: "合成網站", slug: "synthetic", status: overrides.published ? "published" : "draft", revision: 3, content, formId: null, liveId: null, versions: [] }} forms={[]} lives={[]} csrfName="csrf" csrfToken="synthetic" returnHref="/landing-pages/page-1/operations?step=s1&tab=configuration" managementHref="/landing-pages/page-1/operations" initialPublication={{ available: false, message: "專案尚未發布，公開網址目前無法開啟。", projectHref: "/projects/p1", missing: [{ label: "連結商品", href: "/products" }] }} />;
}

describe("landing page workspace save state", () => {
  it("derives dirty from the saved snapshot, so undoing back to it disables 儲存 again", async () => {
    const container = await mount(workspace());
    expect(button(container, "已儲存").disabled).toBe(true);
    await click(button(container, "區段"));
    expect(button(container, "儲存").disabled).toBe(false);
    await click(button(container, "復原"));
    expect(button(container, "已儲存").disabled).toBe(true);
  });

  it("saves the current content and marks the revision clean", async () => {
    mocks.action.mockResolvedValue({ status: "success", message: "草稿已儲存。", id: "page-1", revision: 4 });
    const container = await mount(workspace());
    await click(button(container, "區段"));
    await click(button(container, "儲存"));
    expect(mocks.action).toHaveBeenCalledOnce();
    const data = mocks.action.mock.calls[0]![1] as FormData;
    expect(data.get("operation")).toBe("save");
    expect(data.get("revision")).toBe("3");
    expect(JSON.parse(String(data.get("content"))).root).toHaveLength(1);
    expect(button(container, "已儲存").disabled).toBe(true);
    expect(container.textContent).toContain("草稿已儲存。");
  });
});

describe("leaving with unsaved changes", () => {
  it("leaves immediately when everything is saved", async () => {
    const container = await mount(workspace());
    await click(button(container, "離開"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.push).toHaveBeenCalledWith("/landing-pages/page-1/operations?step=s1&tab=configuration");
  });

  it("asks before leaving, keeps editing on 取消 and restores focus", async () => {
    const container = await mount(workspace());
    await click(button(container, "區段"));
    const exit = button(container, "離開");
    exit.focus();
    await click(exit);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("這個頁面尚未儲存，要先儲存嗎？");
    expect(document.activeElement).toBe(button(dialog, "儲存後離開"));
    await click(button(dialog, "取消"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(exit);
  });

  it("closes on Escape and keeps Tab focus inside the dialog", async () => {
    const container = await mount(workspace());
    await click(button(container, "區段"));
    await click(button(container, "返回管理頁"));
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const cancel = button(dialog, "取消");
    cancel.focus();
    await act(async () => { cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(button(dialog, "不儲存離開"));
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(cancel);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("discards and leaves on 不儲存離開 without saving", async () => {
    const container = await mount(workspace());
    await click(button(container, "區段"));
    await click(button(container, "離開"));
    await click(button(container.querySelector('[role="dialog"]')!, "不儲存離開"));
    expect(mocks.action).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/landing-pages/page-1/operations?step=s1&tab=configuration");
  });

  it("saves first on 儲存後離開 and leaves only after the save succeeds", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mocks.action.mockReturnValue(new Promise((done) => { resolve = done; }));
    const container = await mount(workspace());
    await click(button(container, "區段"));
    await click(button(container, "離開"));
    await click(button(container.querySelector('[role="dialog"]')!, "儲存後離開"));
    expect(mocks.action).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(button(container.querySelector('[role="dialog"]')!, "儲存中…").disabled).toBe(true);
    await act(async () => { resolve({ status: "success", message: "草稿已儲存。", id: "page-1", revision: 4 }); });
    expect(mocks.push).toHaveBeenCalledWith("/landing-pages/page-1/operations?step=s1&tab=configuration");
  });

  it("stays in the editor when the save before leaving fails", async () => {
    mocks.action.mockResolvedValue({ status: "error", message: "這個頁面已有較新的版本，系統沒有覆蓋它。請重新整理後再試。" });
    const container = await mount(workspace());
    await click(button(container, "區段"));
    await click(button(container, "離開"));
    await click(button(container.querySelector('[role="dialog"]')!, "儲存後離開"));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已有較新的版本");
    expect(button(container, "儲存").disabled).toBe(false);
  });

  it("warns on browser unload only while there are unsaved changes", async () => {
    const container = await mount(workspace());
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await click(button(container, "區段"));
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("opening a legacy page", () => {
  const legacyContent = () => {
    const content = createLandingPageContent("webinar", "form_1");
    // One block whose live-linked countdown needs the merchant's attention.
    content.data.content.push({ type: "Countdown", props: { id: "timer", mode: "live_linked", expiredMessage: "報名已截止", expiredAction: "show_message" } } as never);
    return content;
  };
  const forms = [{ id: "form_1", slug: "webinar-signup", name: "講座報名" }];
  const lives = [
    { id: "live_1", slug: "autumn", title: "秋季直播", status: "scheduled" as const, formId: "form_1", scheduledAt: "2030-05-01T12:00:00.000Z" },
    { id: "live_2", slug: "winter", title: "冬季直播", status: "scheduled" as const, formId: "form_1", scheduledAt: "2030-12-01T12:00:00.000Z" },
  ];
  const chip = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label")?.startsWith("發布狀態："))!;
  const heroLink = (container: HTMLElement) => container.querySelector('[data-funnel-node-id="hero-cta"] a')?.getAttribute("href");
  async function choose(select: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => { setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  function legacyWorkspace(content: unknown = legacyContent(), status: "draft" | "published" = "published") {
    return <LandingPageWorkspace page={{ id: "page1", name: "舊版講座頁", slug: "legacy-webinar", status, revision: 7, content: content as never, formId: "form_1", liveId: "live_1", versions: [{ version: 2 }] }} forms={forms} lives={lives} csrfName="csrf" csrfToken="synthetic" />;
  }

  it("shows the converted page with a notice and the conversion report, and writes nothing", async () => {
    const container = await mount(legacyWorkspace());
    const notice = container.querySelector<HTMLElement>('[aria-label="舊版頁面轉換說明"]')!;
    expect(notice.textContent).toContain("這是舊版頁面，已轉換成新版編輯器格式；儲存後會以新版格式保存。舊版內容在你儲存前不會被改動。");
    expect(notice.textContent).toContain("公開頁在你重新發布之前，仍會顯示舊版內容。");
    expect(notice.textContent).toContain("轉換報告：");
    expect(notice.textContent).toContain("倒數計時");
    expect(notice.textContent).toContain("固定截止時間");
    // The canvas is the structured editor showing the legacy content.
    expect(container.querySelector("[data-funnel-page-editor]")).not.toBeNull();
    expect(container.querySelector('[data-funnel-node-id="hero"]')).not.toBeNull();
    expect(container.textContent).toContain("用一場直播，讓對的人認識你的價值");
    // Stored format differs from what is shown, so saving is offered; nothing was sent.
    expect(button(container, "儲存").disabled).toBe(false);
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("resolves registration buttons from the project forms and follows a re-bound live", async () => {
    const container = await mount(legacyWorkspace());
    expect(heroLink(container)).toBe("/form/webinar-signup?liveId=live_1");
    await click(button(container, "頁面設定"));
    await choose(container.querySelector<HTMLSelectElement>('select[aria-label="活動場次"]')!, "live_2");
    expect(heroLink(container)).toBe("/form/webinar-signup?liveId=live_2");
    await choose(container.querySelector<HTMLSelectElement>('select[aria-label="活動場次"]')!, "");
    expect(heroLink(container)).toBe("/form/webinar-signup");
  });

  it("keeps unpublish, duplicate, delete and version restore available before the first save", async () => {
    mocks.action.mockResolvedValue({ status: "success", message: "已取消發布；歷史版本與草稿都仍保留。", id: "page1", revision: 8 });
    const container = await mount(legacyWorkspace());
    await click(chip(container));
    const region = container.querySelector<HTMLElement>('[aria-label="公開網址狀態"]')!;
    for (const name of ["發布已儲存草稿", "取消發布", "複製頁面", "刪除一頁式網站"]) expect(button(region, name).disabled).toBe(false);
    expect(region.textContent).not.toContain("請先儲存變更再發布或管理。");
    await click(button(region, "取消發布"));
    expect(mocks.action).toHaveBeenCalledOnce();
    expect((mocks.action.mock.calls[0]![1] as FormData).get("operation")).toBe("unpublish");
    // The conversion is still unsaved: leaving still asks first.
    expect(button(container, "儲存").disabled).toBe(false);
  });

  it("blocks those actions again once the merchant really edits the converted page", async () => {
    const container = await mount(legacyWorkspace());
    await click(button(container, "區段"));
    await click(chip(container));
    const region = container.querySelector<HTMLElement>('[aria-label="公開網址狀態"]')!;
    expect(button(region, "取消發布").disabled).toBe(true);
    expect(region.textContent).toContain("請先儲存變更再發布或管理。");
    await click(button(container, "版本紀錄"));
    expect(button(container, "還原此版本為草稿").disabled).toBe(true);
  });

  it("enables version restore for an unedited conversion", async () => {
    const container = await mount(legacyWorkspace());
    await click(button(container, "版本紀錄"));
    expect(button(container, "還原此版本為草稿").disabled).toBe(false);
  });

  it("leaving without saving discards the conversion and keeps the legacy draft", async () => {
    const container = await mount(legacyWorkspace());
    await click(button(container, "離開"));
    await click(button(container.querySelector('[role="dialog"]')!, "不儲存離開"));
    expect(mocks.action).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/landing-pages");
  });

  it("saves the converted PageDocument through the normal save action and then hides the notice", async () => {
    mocks.action.mockResolvedValue({ status: "success", message: "草稿已儲存。", id: "page1", revision: 8 });
    const container = await mount(legacyWorkspace());
    await click(button(container, "儲存"));
    expect(mocks.action).toHaveBeenCalledOnce();
    const data = mocks.action.mock.calls[0]![1] as FormData;
    expect(data.get("operation")).toBe("save");
    expect(data.get("revision")).toBe("7");
    expect(data.get("formId")).toBe("form_1");
    expect(data.get("liveId")).toBe("live_1");
    const saved = parsePageDocument(JSON.parse(String(data.get("content"))));
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe("page1");
    expect(saved!.root.map((node) => node.id)).toEqual(["hero", "benefits", "speaker", "agenda", "faq", "register", "timer"]);
    // Buttons stay bound to the form record; the slug and live are resolved at render time.
    expect(JSON.stringify(saved)).toContain('{"type":"registration","formId":"form_1","useBoundLive":true}');
    expect(JSON.stringify(saved)).not.toContain("webinar-signup");
    expect(container.querySelector('[aria-label="舊版頁面轉換說明"]')).toBeNull();
    expect(button(container, "已儲存").disabled).toBe(true);
  });

  it("refuses to open a legacy page it cannot convert, without touching it", async () => {
    const plans = Array.from({ length: 6 }, (_, index) => ({ name: `方案${index}`, price: "NT$ 1", features: Array.from({ length: 20 }, (_, feature) => `特色${feature}`), label: "標籤", description: "說明", action: { type: "external", href: "https://example.com" } }));
    const oversized = { schemaVersion: 1, data: { root: {}, content: Array.from({ length: 24 }, (_, index) => ({ type: "Pricing", props: { id: `p${index}`, title: "方案", plans } })) } };
    const container = await mount(legacyWorkspace(oversized, "draft"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("無法開啟這個舊版頁面");
    expect(container.querySelector("[data-funnel-page-editor]")).toBeNull();
    await click(button(container, "返回管理頁"));
    expect(mocks.action).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/landing-pages");
  });

  it("still lets the merchant unpublish or delete a page it cannot convert", async () => {
    const plans = Array.from({ length: 6 }, (_, index) => ({ name: `方案${index}`, price: "NT$ 1", features: Array.from({ length: 20 }, (_, feature) => `特色${feature}`), label: "標籤", description: "說明", action: { type: "external", href: "https://example.com" } }));
    const oversized = { schemaVersion: 1, data: { root: {}, content: Array.from({ length: 24 }, (_, index) => ({ type: "Pricing", props: { id: `p${index}`, title: "方案", plans } })) } };
    mocks.action.mockResolvedValueOnce({ status: "success", message: "已取消發布；歷史版本與草稿都仍保留。", id: "page1", revision: 8 });
    const container = await mount(legacyWorkspace(oversized, "published"));
    await click(button(container, "取消發布"));
    expect((mocks.action.mock.calls[0]![1] as FormData).get("operation")).toBe("unpublish");
    expect(container.textContent).toContain("已取消發布");
    expect(container.querySelector("button[disabled]")).toBeNull();
    // Unpublished now: only delete remains, and it asks for confirmation first.
    expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent === "取消發布")).toBe(false);
    const confirm = vi.fn().mockReturnValueOnce(false);
    Object.defineProperty(window, "confirm", { value: confirm, configurable: true, writable: true });
    await click(button(container, "刪除一頁式網站"));
    expect(mocks.action).toHaveBeenCalledOnce();
    confirm.mockReturnValueOnce(true);
    mocks.action.mockResolvedValueOnce({ status: "success", message: "Funnel 與草稿已刪除。", id: "page1" });
    await click(button(container, "刪除一頁式網站"));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect((mocks.action.mock.calls[1]![1] as FormData).get("operation")).toBe("delete");
    expect((mocks.action.mock.calls[1]![1] as FormData).get("revision")).toBe("8");
    expect(mocks.push).toHaveBeenCalledWith("/landing-pages");
    Reflect.deleteProperty(window, "confirm");
  });
});

describe("publication chip", () => {
  it("shows a compact status with the existing diagnosis and a guarded link to the management page", async () => {
    const container = await mount(workspace({ published: true }));
    const chip = button(container, "發布狀態：公開網址無法開啟");
    expect(container.querySelector('[aria-label="公開網址狀態"]')).toBeNull();
    await click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const region = container.querySelector<HTMLElement>('[aria-label="公開網址狀態"]')!;
    expect(region.textContent).toContain("專案尚未發布，公開網址目前無法開啟。");
    expect(region.querySelector('a[href="/products"]')?.textContent).toBe("連結商品");
    expect(region.querySelector('a[href="/projects/p1"]')?.textContent).toBe("前往專案檢查與發布");
    expect(region.textContent).not.toContain("發布已儲存草稿");
    await click(button(region, "前往管理頁發布或管理網站"));
    expect(mocks.push).toHaveBeenCalledWith("/landing-pages/page-1/operations?step=s1&tab=configuration");
  });
});
