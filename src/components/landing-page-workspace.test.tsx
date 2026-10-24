// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyPageDocument, type PageDocument } from "@/lib/funnel-page-document";

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
