// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunnelNode } from "@/lib/funnel-page-document";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import type { FunnelCommerceProduct } from "@/lib/funnel-commerce";
import type { LandingPageActionState } from "@/lib/landing-page-service";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), action: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/app/actions/landing-page-actions", () => ({ landingPageAction: mocks.action }));
// Render the real funnel step editor synchronously instead of through next/dynamic.
vi.mock("@/components/landing-pages/workspace-editor", async () => {
  const { FunnelStepPagesEditor } = await import("@/components/landing-pages/funnel-step-pages-editor");
  return {
    WorkspaceEditor: (props: { content: FunnelStepPages; pending: boolean; commerceProducts: FunnelCommerceProduct[]; onDocumentChange: (content: FunnelStepPages) => void; chrome?: never }) =>
      <FunnelStepPagesEditor state={props.content} disabled={props.pending} commerceProducts={props.commerceProducts} onChange={props.onDocumentChange} chrome={props.chrome} />,
  };
});

import { AUTOSAVE_DELAY_MS, LandingPageWorkspace } from "./landing-page-workspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.useRealTimers();
});

async function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return container;
}
const named = (item: Element) => (item.getAttribute("aria-label") ?? item.textContent?.trim() ?? "");
function button(scope: ParentNode, name: string) {
  const match = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => named(item) === name);
  if (!match) throw new Error(`button not found: ${name}`);
  return match;
}
const toolbar = () => document.querySelector<HTMLElement>('[aria-label="編輯器工具列"]')!;
const drawer = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
async function flush() { await act(async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); await flush(); }
async function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => { setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
}
const operations = () => mocks.action.mock.calls.map((call) => (call[1] as FormData).get("operation"));
const sent = (index: number) => mocks.action.mock.calls[index]![1] as FormData;

const products: FunnelCommerceProduct[] = [
  { id: "product-own", name: "合成主商品", priceCents: 123_400, currency: "TWD", fulfillmentType: "physical" },
  { id: "product-alt", name: "合成替代商品", priceCents: 56_700, currency: "TWD", fulfillmentType: "physical" },
];

function leaf(id: string, type: FunnelNode["type"]): FunnelNode {
  return { schemaVersion: 1, id, type, props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
}
function salesFunnel(commerce?: FunnelStepPages["pages"][string]["commerce"]) {
  const state = createGoalFunnelStepPages({ id: "flow", name: "合成銷售", goal: "sell", domain: "synthetic-sale" })!;
  const order = state.pages.order_form!;
  order.root = [{ ...leaf("section_main", "section"), children: [{ ...leaf("row_main", "row"), children: [{ ...leaf("column_main", "columns_2"), children: [leaf("offer_main", "offer_price"), leaf("pay_main", "payment_button")] }] }] }];
  if (commerce) order.commerce = commerce;
  return state;
}

function workspace(options: { published?: boolean; commerce?: FunnelStepPages["pages"][string]["commerce"]; products?: FunnelCommerceProduct[] } = {}) {
  return <LandingPageWorkspace
    page={{ id: "page-1", name: "合成銷售網站", slug: "synthetic-sale", status: options.published ? "published" : "draft", revision: 3, content: salesFunnel(options.commerce), formId: null, liveId: null, versions: [] }}
    forms={[]} lives={[]} csrfName="csrf" csrfToken="synthetic" commerceProducts={options.products ?? products}
    returnHref="/landing-pages/page-1/operations?step=order_form&tab=configuration" managementHref="/landing-pages/page-1/operations"
    initialPublication={{ available: false, message: "一頁式網站尚未發布，公開網址目前無法開啟。", projectHref: "/projects/p1", missing: [] }} />;
}

/** One canvas edit through the real editor: select the section and move it is not possible, so add an element. */
async function edit(container: HTMLElement) { await click(button(container, "區段")); }
const saveButtonText = () => Array.from(toolbar().querySelectorAll("button")).map(named).find((label) => /儲存/u.test(label));

describe("autosave", () => {
  it("saves once, AUTOSAVE_DELAY_MS after the last edit, through the revision-checked save", async () => {
    vi.useFakeTimers();
    mocks.action.mockResolvedValue({ status: "success", message: "草稿已儲存。", id: "page-1", revision: 4 });
    const container = await mount(workspace());
    expect(saveButtonText()).toBe("已儲存");
    await edit(container);
    expect(saveButtonText()).toBe("儲存");
    expect(document.body.textContent).toContain("停止編輯後會自動儲存");
    await advance(AUTOSAVE_DELAY_MS - 1);
    // A second edit before the delay restarts it: still nothing sent.
    await edit(container);
    await advance(AUTOSAVE_DELAY_MS - 1);
    expect(mocks.action).not.toHaveBeenCalled();
    await advance(1);
    expect(operations()).toEqual(["save"]);
    expect(sent(0).get("revision")).toBe("3");
    expect(JSON.parse(String(sent(0).get("content"))).pages.order_form.root).toHaveLength(3);
    expect(saveButtonText()).toBe("已儲存");
    // Autosave is quiet on success: no bottom notice.
    expect(container.querySelector('p[role="status"].fixed')).toBeNull();
    // Nothing more to save, so no further request; the next save uses the new revision.
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(operations()).toEqual(["save"]);
    await edit(container);
    await advance(AUTOSAVE_DELAY_MS);
    expect(operations()).toEqual(["save", "save"]);
    expect(sent(1).get("revision")).toBe("4");
  });

  it("shows 儲存中… while a save runs and never sends a second save for the same content", async () => {
    vi.useFakeTimers();
    let resolve: (value: LandingPageActionState) => void = () => undefined;
    mocks.action.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const container = await mount(workspace());
    await edit(container);
    await advance(AUTOSAVE_DELAY_MS);
    expect(saveButtonText()).toBe("儲存中…");
    // The canvas stays editable while saving (no focus is taken away).
    expect(button(container, "區段").disabled).toBe(false);
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(operations()).toEqual(["save"]);
    await act(async () => { resolve({ status: "success", message: "草稿已儲存。", id: "page-1", revision: 4 }); });
    await flush();
    expect(saveButtonText()).toBe("已儲存");
  });

  it("marks a failed save, does not retry the same content, and retries on 儲存失敗（重試）", async () => {
    vi.useFakeTimers();
    mocks.action.mockResolvedValueOnce({ status: "error", code: "landing_page_commerce_invalid", message: "已綁定的商品必須屬於目前銷售專案。" });
    const container = await mount(workspace());
    await edit(container);
    await advance(AUTOSAVE_DELAY_MS);
    expect(saveButtonText()).toBe("儲存失敗（重試）");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已綁定的商品必須屬於目前銷售專案");
    await advance(AUTOSAVE_DELAY_MS * 3);
    expect(operations()).toEqual(["save"]);
    mocks.action.mockResolvedValueOnce({ status: "success", message: "草稿已儲存。", id: "page-1", revision: 4 });
    await click(button(toolbar(), "儲存失敗（重試）"));
    await flush();
    expect(operations()).toEqual(["save", "save"]);
    expect(saveButtonText()).toBe("已儲存");
  });

  it("stops autosaving after a revision conflict so a newer stored version is never overwritten", async () => {
    vi.useFakeTimers();
    mocks.action.mockResolvedValue({ status: "error", code: "landing_page_conflict", message: "這個頁面已有較新的版本，系統沒有覆蓋它。請重新整理後再試。" });
    const container = await mount(workspace());
    await edit(container);
    await advance(AUTOSAVE_DELAY_MS);
    expect(saveButtonText()).toBe("儲存失敗（重試）");
    await edit(container);
    await advance(AUTOSAVE_DELAY_MS * 3);
    expect(operations()).toEqual(["save"]);
    expect(saveButtonText()).toBe("儲存失敗（重試）");
  });

  it("keeps the leave reminder until the autosave has stored the edit", async () => {
    vi.useFakeTimers();
    mocks.action.mockResolvedValue({ status: "success", message: "草稿已儲存。", id: "page-1", revision: 4 });
    const container = await mount(workspace());
    const unload = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
    expect(unload()).toBe(false);
    await edit(container);
    expect(unload()).toBe(true);
    await advance(AUTOSAVE_DELAY_MS);
    expect(unload()).toBe(false);
  });

  it("asks before 離開 while the autosave has not run yet", async () => {
    vi.useFakeTimers();
    const container = await mount(workspace());
    await edit(container);
    await click(button(toolbar(), "離開"));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("這個頁面尚未儲存，要先儲存嗎？");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("publish in the editor", () => {
  const checked: LandingPageActionState = { status: "success", message: "發布檢查通過，可以發布。", id: "page-1", publication: { available: false, message: "一頁式網站尚未發布，公開網址目前無法開啟。", projectHref: "/projects/p1", missing: [] } };

  it("labels the primary action 發布 for a draft", async () => {
    await mount(workspace());
    expect(button(toolbar(), "發布").disabled).toBe(false);
  });

  it("labels the primary action 更新發布 for a published page", async () => {
    await mount(workspace({ published: true }));
    expect(button(toolbar(), "更新發布").disabled).toBe(false);
  });

  it("saves unsaved edits first, runs the check, and publishes only after confirmation", async () => {
    mocks.action
      .mockResolvedValueOnce({ status: "success", message: "草稿已儲存。", id: "page-1", revision: 4 })
      .mockResolvedValueOnce(checked)
      .mockResolvedValueOnce({ status: "success", message: "Funnel 版本 v2 已儲存為發布版本。", id: "page-1", revision: 5, version: 2, publication: { available: true, message: "專案與一頁式網站均已發布，公開頁目前可開啟。", projectHref: "/projects/p1", missing: [] } });
    const container = await mount(workspace({ commerce: { schemaVersion: 1, productId: "product-own", formMode: "single" } }));
    await edit(container);
    await click(button(toolbar(), "發布"));
    await flush();
    expect(operations()).toEqual(["save", "check_publish"]);
    expect(sent(1).get("revision")).toBe("4");
    const dialog = drawer()!;
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.textContent).toContain("檢查通過，可以發布。");
    expect(dialog.querySelector('[data-publish-check="儲存草稿"]')?.getAttribute("data-status")).toBe("passed");
    expect(dialog.querySelector('[data-publish-check="發布檢查"]')?.getAttribute("data-status")).toBe("passed");
    expect(dialog.textContent).toContain("一頁式網站尚未發布，公開網址目前無法開啟。");
    expect(button(toolbar(), "發布").disabled).toBe(true);
    await click(button(dialog, "確認發布"));
    await flush();
    expect(operations()).toEqual(["save", "check_publish", "publish"]);
    expect(sent(2).get("revision")).toBe("4");
    expect(drawer()).toBeNull();
    const toast = document.querySelector<HTMLElement>("[data-ui-toast]")!;
    expect(toast.textContent).toContain("已發布版本 v2");
    expect(toast.textContent).toContain(`${window.location.origin}/lp/synthetic-sale`);
    expect(toast.querySelector("a")?.getAttribute("href")).toBe("/lp/synthetic-sale");
    expect(button(toolbar(), "更新發布")).toBeTruthy();
    expect(button(toolbar(), "發布狀態：已發布")).toBeTruthy();
  });

  it("skips the save when nothing changed and never publishes without the check", async () => {
    mocks.action.mockResolvedValueOnce(checked);
    await mount(workspace());
    await click(button(toolbar(), "發布"));
    await flush();
    expect(operations()).toEqual(["check_publish"]);
    await click(button(drawer()!, "取消"));
    expect(drawer()).toBeNull();
    expect(operations()).toEqual(["check_publish"]);
  });

  it("lists a refused check with the server's reason and leads to the in-place product picker", async () => {
    mocks.action.mockResolvedValueOnce({ status: "error", code: "landing_page_commerce_invalid", message: "已綁定的商品必須屬於目前銷售專案，且目前可販售。", publication: { available: false, message: "一頁式網站尚未發布，公開網址目前無法開啟。", projectHref: "/projects/p1", missing: [] } });
    const container = await mount(workspace({ commerce: { schemaVersion: 1, productId: "product-gone", formMode: "single" } }));
    await click(button(toolbar(), "發布"));
    await flush();
    const dialog = drawer()!;
    expect(dialog.textContent).toContain("發布檢查未通過，網站沒有變更。");
    expect(dialog.querySelector('[data-publish-check="發布檢查"]')?.getAttribute("data-status")).toBe("failed");
    expect(dialog.textContent).toContain("已綁定的商品必須屬於目前銷售專案");
    expect(button(dialog, "確認發布").disabled).toBe(true);
    expect(dialog.querySelector('[data-publish-commerce-warning="unavailable"]')).not.toBeNull();
    // The editor's catalog is refreshed so the picker shows current products.
    expect(mocks.refresh).toHaveBeenCalledOnce();
    await click(button(dialog, "重新選擇結帳商品"));
    expect(drawer()).toBeNull();
    expect(container.querySelector('[data-funnel-node-id="offer_main"]')?.getAttribute("data-funnel-selected")).toBe("true");
    const picker = container.querySelector<HTMLElement>('[data-funnel-commerce-quick-bind="unavailable"]')!;
    expect(picker.textContent).toContain("已連結的商品目前無法販售");
    expect(operations()).toEqual(["check_publish"]);
  });

  it("shows the scoped diagnosis links for a refused independent publication and allows a re-check", async () => {
    mocks.action
      .mockResolvedValueOnce({ status: "error", code: "landing_page_independent_publish_limit", message: "免費帳號最多可同時有 3 個…", publication: { available: false, message: "一頁式網站尚未發布。", projectHref: "/projects/p1", missing: [{ label: "升級付費方案", href: "/billing/plans" }] } })
      .mockResolvedValueOnce(checked);
    await mount(workspace());
    await click(button(toolbar(), "發布"));
    await flush();
    const dialog = drawer()!;
    expect(dialog.querySelector('a[href="/billing/plans"]')?.textContent).toBe("升級付費方案");
    await click(button(dialog, "重新檢查"));
    await flush();
    expect(operations()).toEqual(["check_publish", "check_publish"]);
    expect(button(drawer()!, "確認發布").disabled).toBe(false);
  });

  it("does not publish when the save before publishing fails", async () => {
    mocks.action.mockResolvedValueOnce({ status: "error", code: "landing_page_conflict", message: "這個頁面已有較新的版本，系統沒有覆蓋它。請重新整理後再試。" });
    const container = await mount(workspace());
    await edit(container);
    await click(button(toolbar(), "發布"));
    await flush();
    const dialog = drawer()!;
    expect(dialog.querySelector('[data-publish-check="儲存草稿"]')?.getAttribute("data-status")).toBe("failed");
    expect(dialog.textContent).toContain("已有較新的版本");
    expect(button(dialog, "重新載入最新版本")).toBeTruthy();
    expect(button(dialog, "確認發布").disabled).toBe(true);
    expect(operations()).toEqual(["save"]);
  });

  it("reports a publish refused after a passing check without closing the drawer", async () => {
    mocks.action
      .mockResolvedValueOnce(checked)
      .mockResolvedValueOnce({ status: "error", code: "landing_page_live_form_mismatch", message: "所有報名按鈕都必須使用該場次的報名表。" });
    const container = await mount(workspace());
    await click(button(toolbar(), "發布"));
    await flush();
    await click(button(drawer()!, "確認發布"));
    await flush();
    const dialog = drawer()!;
    expect(dialog.textContent).toContain("所有報名按鈕都必須使用該場次的報名表");
    await click(button(dialog, "開啟頁面設定"));
    expect(drawer()).toBeNull();
    expect(container.querySelector("[data-funnel-page-settings]")).not.toBeNull();
    expect(button(toolbar(), "發布")).toBeTruthy();
  });
});

describe("binding a product in place", () => {
  it("offers only the server's catalog on an unbound checkout element and stores the reference like 頁面設定", async () => {
    vi.useFakeTimers();
    mocks.action.mockResolvedValue({ status: "success", message: "草稿已儲存。", id: "page-1", revision: 4 });
    const container = await mount(workspace());
    await click(container.querySelector<HTMLElement>('[data-funnel-node-id="offer_main"]')!);
    const picker = container.querySelector<HTMLElement>('[data-funnel-commerce-quick-bind="unbound"]')!;
    expect(picker.textContent).toContain("這個頁面還沒有連結商品");
    const select = picker.querySelector("select")!;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "product-own", "product-alt"]);
    expect(select.textContent).toContain("合成主商品 — ");
    expect(select.textContent).toContain("1,234");
    await choose(select, "product-alt");
    expect(container.querySelector('[data-funnel-commerce-quick-bind="bound"]')).not.toBeNull();
    // The canvas shows the catalog price, not anything typed into the document.
    expect(container.querySelector('[data-funnel-node-id="offer_main"]')?.textContent).toContain("567");
    await advance(AUTOSAVE_DELAY_MS);
    const content = JSON.parse(String(sent(0).get("content"))) as FunnelStepPages;
    expect(content.pages.order_form!.commerce).toEqual({ schemaVersion: 1, productId: "product-alt", formMode: "single" });
    expect(JSON.stringify(content)).not.toContain("56700");
    // Same data as 頁面設定 › 商品與結帳.
    await click(button(container, "加購、結帳版面與同意條款在頁面設定"));
    const pageSettingsProduct = Array.from(container.querySelectorAll<HTMLSelectElement>("[data-funnel-page-settings] label select")).find((select) => select.parentElement?.textContent?.startsWith("本步驟商品"));
    expect(pageSettingsProduct?.value).toBe("product-alt");
  });

  it("shows the server's refusal when a save carries a product outside this vendor's catalog", async () => {
    vi.useFakeTimers();
    mocks.action.mockResolvedValueOnce({ status: "error", code: "landing_page_commerce_invalid", message: "已綁定的商品必須屬於目前銷售專案，且目前可販售、有庫存、已確認交付設定。" });
    // A crafted catalog entry (e.g. another tenant's id) reaches the server only as a reference; the server refuses it.
    const container = await mount(workspace({ products: [...products, { id: "foreign-product", name: "其他商家商品", priceCents: 1, currency: "TWD", fulfillmentType: "physical" }] }));
    await click(container.querySelector<HTMLElement>('[data-funnel-node-id="pay_main"]')!);
    await choose(container.querySelector<HTMLSelectElement>("[data-funnel-commerce-quick-bind] select")!, "foreign-product");
    await advance(AUTOSAVE_DELAY_MS);
    expect(JSON.parse(String(sent(0).get("content"))).pages.order_form.commerce.productId).toBe("foreign-product");
    expect(saveButtonText()).toBe("儲存失敗（重試）");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已綁定的商品必須屬於目前銷售專案");
  });

  it("explains that only order-form steps bind products", async () => {
    const state = salesFunnel();
    state.activeStepId = "thank_you";
    state.pages.thank_you!.root = [{ ...leaf("section_thanks", "section"), children: [{ ...leaf("row_thanks", "row"), children: [{ ...leaf("column_thanks", "columns_2"), children: [leaf("offer_thanks", "offer_price")] }] }] }];
    const container = await mount(<LandingPageWorkspace page={{ id: "page-1", name: "合成銷售網站", slug: "synthetic-sale", status: "draft", revision: 3, content: state, formId: null, liveId: null, versions: [] }} forms={[]} lives={[]} csrfName="csrf" csrfToken="synthetic" commerceProducts={products} managementHref="/landing-pages/page-1/operations" />);
    await click(container.querySelector<HTMLElement>('[data-funnel-node-id="offer_thanks"]')!);
    expect(container.querySelector('[data-funnel-commerce-quick-bind="disabled"]')?.textContent).toContain("只在「訂單表單」步驟連結商品");
    expect(container.querySelector("[data-funnel-commerce-quick-bind] select")).toBeNull();
  });
});
