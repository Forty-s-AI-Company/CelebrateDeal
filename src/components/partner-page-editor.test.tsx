import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  actionStates: [] as Array<{ status: "idle" | "success" | "error"; message: string } | undefined>,
  pending: [] as boolean[],
  effects: [] as Array<{ deps: unknown[] | undefined; cleanup?: (() => void) | undefined }>,
  timers: [] as Array<{ id: number; delay: number; callback: () => void }>,
  clearedTimerIds: [] as number[],
  nextTimerId: 1,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: (_action: unknown, initial: unknown) => {
      const index = hookState.cursor++;
      return [hookState.actionStates[index] ?? initial, vi.fn(), hookState.pending[index] ?? false] as const;
    },
    useState: (initial: unknown) => {
      const index = hookState.cursor++;
      if (hookState.values[index] === undefined) hookState.values[index] = initial;
      const setValue = (next: unknown) => {
        hookState.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(hookState.values[index]) : next;
      };
      return [hookState.values[index], setValue] as const;
    },
    useEffect: (effect: () => (() => void) | undefined, deps?: unknown[]) => {
      const index = hookState.cursor++;
      const previous = hookState.effects[index];
      const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((value, position) => !Object.is(value, previous.deps?.[position]));
      if (!changed) return;
      previous?.cleanup?.();
      hookState.effects[index] = { deps, cleanup: effect() };
    },
  };
});

import { PartnerPageEditor } from "./partner-page-editor";

const action = async () => ({ status: "idle" as const, message: "" });

type ElementNode = { type: unknown; props: Record<string, unknown> };
function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}
function findElements(node: unknown, predicate: (element: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!isElementNode(node)) return [];
  return [...(predicate(node) ? [node] : []), ...findElements(node.props.children, predicate)];
}
function textContent(node: unknown): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isElementNode(node) ? textContent(node.props.children) : "";
}

const basePage: Parameters<typeof PartnerPageEditor>[0]["page"] = {
  id: "page-1", teamId: "team-1", slug: "partner-webinar", headline: "A 的主標題", subheadline: "副標題", body: "內容說明", ctaLabel: "立即報名", ctaUrl: "https://example.test/apply",
  source: { name: "夏季模板", ownerName: "A 領隊", version: 2, webinar: "八月 webinar" }, lockedFields: ["HEADLINE", "PRODUCT_SLOTS"], partner: { name: "夥伴帳號", email: "partner@example.com" }, isPublished: false,
  slots: ["main_product", "bundle_product", "join_member", "consultation"].map((key) => ({ key, productId: null, overrideUrl: null, available: true })),
};
const products = [{ id: "product-1", name: "主打課程" }, { id: "product-2", name: "組合課程" }];
const editorProps = { csrfToken: "csrf-test-token", saveAction: action, publishAction: action, products };

function renderEditor(overrides: Partial<typeof basePage> = {}) {
  hookState.cursor = 0;
  return PartnerPageEditor({ ...editorProps, page: { ...basePage, ...overrides } });
}

const globalRecord = globalThis as unknown as Record<string, unknown>;
let previousWindowDescriptor: PropertyDescriptor | undefined;
let previousNavigatorDescriptor: PropertyDescriptor | undefined;
function installBrowserStubs({ origin = "https://partner.example", clipboard }: { origin?: string; clipboard?: { writeText: ReturnType<typeof vi.fn> } } = {}) {
  previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalRecord.window = {
    location: { origin },
    setTimeout: (callback: () => void, delay: number) => {
      const id = hookState.nextTimerId++;
      hookState.timers.push({ id, delay, callback });
      return id;
    },
    clearTimeout: (id: number) => hookState.clearedTimerIds.push(id),
  };
  globalRecord.navigator = clipboard ? { clipboard } : {};
}
function restoreBrowserStubs() {
  if (previousWindowDescriptor) Object.defineProperty(globalThis, "window", previousWindowDescriptor);
  else delete globalRecord.window;
  if (previousNavigatorDescriptor) Object.defineProperty(globalThis, "navigator", previousNavigatorDescriptor);
  else delete globalRecord.navigator;
  previousWindowDescriptor = undefined;
  previousNavigatorDescriptor = undefined;
}

beforeEach(() => {
  hookState.cursor = 0;
  hookState.values = [];
  hookState.actionStates = [];
  hookState.pending = [];
  hookState.effects = [];
  hookState.timers = [];
  hookState.clearedTimerIds = [];
  hookState.nextTimerId = 1;
});
afterEach(restoreBrowserStubs);

describe("PartnerPageEditor", () => {
  it("renders account-derived contact data as read-only and excludes it from the save form", () => {
    const html = renderToStaticMarkup(<PartnerPageEditor csrfToken="csrf-test-token" saveAction={action} publishAction={action} products={[{ id: "product-1", name: "主打課程" }]} page={{
      id: "page-1", teamId: "team-1", slug: "partner-webinar", headline: "A 的主標題", subheadline: null, body: null, ctaLabel: "立即報名", ctaUrl: null,
      source: { name: "夏季模板", ownerName: "A 領隊", version: 2, webinar: "八月 webinar" }, lockedFields: ["HEADLINE", "PRODUCT_SLOTS"], partner: { name: "夥伴帳號", email: "partner@example.com" }, isPublished: false,
      slots: ["main_product", "bundle_product", "join_member", "consultation"].map((key) => ({ key, productId: null, overrideUrl: null, available: true })),
    }} />);
    expect(html).toContain("由 A 領隊 的模板版本鎖定");
    expect(html).toContain('disabled=""');
    expect(html).toContain('name="headline"');
    expect(html).toContain("帳號聯絡資料");
    expect(html).toContain("夥伴帳號");
    expect(html).toContain("partner@example.com");
    expect(html).not.toContain('name="partnerName"');
    expect(html).not.toContain('name="partnerEmail"');
    expect(html).not.toContain("公開 Email");
    expect(html).toContain("主打商品");
    expect(html).toContain("組合商品");
    expect(html).toContain("加入會員");
    expect(html).toContain("諮詢預約");
    expect(html).toContain("預覽");
    expect(html).toContain("複製公開 URL");
    expect(html).toContain("發布公開頁");
  });

  it("renders published state, source webinar fallback, and safe partner fallbacks", () => {
    const html = renderToStaticMarkup(<PartnerPageEditor csrfToken="csrf-test-token" saveAction={action} publishAction={action} products={products} page={{ ...basePage, source: { ...basePage.source, webinar: null }, partner: { name: "", email: "" }, isPublished: true }} />);
    expect(html).toContain("未綁定");
    expect(html).toContain("已發布");
    expect(html).toContain('name="publish" value="false"');
    expect(html).toContain('href="/p/partner-webinar"');
    expect(html).toContain("尚未設定");
    expect(html).not.toContain("發布公開頁");
    expect(html).toContain("停止公開");
    expect(html).not.toContain('name="partnerName"');
    expect(html).not.toContain('name="partnerEmail"');
  });

  it("enforces locked field and product-slot boundaries while preserving editable controls", () => {
    const availablePage = { ...basePage, lockedFields: [], slots: [{ key: "main_product", productId: "product-1", overrideUrl: null, available: true }, { key: "bundle_product", productId: null, overrideUrl: null, available: false }] };
    const tree = renderEditor(availablePage);
    const inputs = findElements(tree, (element) => element.type === "input");
    const headline = inputs.find((element) => element.props.name === "headline");
    const ctaUrl = inputs.find((element) => element.props.name === "ctaUrl");
    const selects = findElements(tree, (element) => element.type === "select");
    expect(headline?.props.disabled).toBe(false);
    expect(headline?.props.required).toBe(true);
    expect(ctaUrl?.props.type).toBe("url");
    expect(selects.find((element) => element.props.name === "product_main_product")?.props.disabled).toBe(false);
    expect(selects.find((element) => element.props.name === "product_bundle_product")?.props.disabled).toBe(true);
    expect(textContent(tree)).toContain("A 的模板未提供此商品槽。");

    const lockedTree = renderEditor({ lockedFields: ["PRODUCT_SLOTS", "HEADLINE"], slots: [] });
    expect(findElements(lockedTree, (element) => element.props.name === "headline")[0].props.disabled).toBe(true);
    expect(findElements(lockedTree, (element) => element.type === "select").every((element) => element.props.disabled === true)).toBe(true);
    expect(findElements(lockedTree, (element) => typeof element.type === "function" && element.props.label === "商品槽")).toHaveLength(1);
  });

  it("toggles preview and renders complete content plus deterministic empty fallbacks", () => {
    let tree = renderEditor();
    const previewButton = findElements(tree, (element) => element.type === "button" && textContent(element) === "預覽")[0];
    expect(previewButton.props["aria-expanded"]).toBe(false);
    expect(findElements(tree, (element) => element.props["aria-label"] === "夥伴頁預覽")).toHaveLength(0);
    (previewButton.props.onClick as () => void)();
    tree = renderEditor();
    expect(findElements(tree, (element) => element.type === "button" && textContent(element).includes("關閉預覽"))[0].props["aria-expanded"]).toBe(true);
    const preview = findElements(tree, (element) => element.props["aria-label"] === "夥伴頁預覽")[0];
    expect(textContent(preview)).toContain("A 的主標題副標題內容說明立即報名聯絡夥伴：夥伴帳號 · partner@example.com");

    const closeButton = findElements(tree, (element) => element.type === "button" && textContent(element).includes("關閉預覽"))[0];
    (closeButton.props.onClick as () => void)();
    tree = renderEditor();
    expect(findElements(tree, (element) => element.props["aria-label"] === "夥伴頁預覽")).toHaveLength(0);

    tree = renderEditor({ headline: "", subheadline: null, body: null, ctaLabel: "", partner: { name: "", email: "" } });
    (findElements(tree, (element) => element.type === "button" && textContent(element) === "預覽")[0].props.onClick as () => void)();
    tree = renderEditor({ headline: "", subheadline: null, body: null, ctaLabel: "", partner: { name: "", email: "" } });
    expect(textContent(findElements(tree, (element) => element.props["aria-label"] === "夥伴頁預覽")[0])).toContain("尚未填寫主標題尚未填寫 CTA聯絡夥伴：尚未填寫名稱");
  });

  it("copies the SSR path or same-origin URL and exposes copied lifecycle cleanup", async () => {
    expect(renderToStaticMarkup(<PartnerPageEditor csrfToken="csrf-test-token" saveAction={action} publishAction={action} products={products} page={basePage} />)).toContain("/p/partner-webinar");
    const writeText = vi.fn(async (url: string) => { void url; });
    installBrowserStubs({ origin: "https://partner.example", clipboard: { writeText } });
    let tree = renderEditor();
    const copyButton = findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製公開 URL"))[0];
    await (copyButton.props.onClick as () => Promise<void>)();
    expect(writeText).toHaveBeenCalledWith("https://partner.example/p/partner-webinar");
    tree = renderEditor();
    expect(textContent(findElements(tree, (element) => element.type === "button" && textContent(element).includes("已複製"))[0])).toBe("已複製");
    expect(hookState.timers.map((timer) => timer.delay)).toEqual([1800]);
    hookState.timers[0].callback();
    tree = renderEditor();
    expect(hookState.clearedTimerIds).toEqual([1]);
    expect(textContent(findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製公開 URL"))[0])).toBe("複製公開 URL");

    restoreBrowserStubs();
    installBrowserStubs();
    tree = renderEditor();
    await (findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製公開 URL"))[0].props.onClick as () => Promise<void>)();
    tree = renderEditor();
    expect(textContent(findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製失敗"))[0])).toBe("複製失敗，重試");
    expect(textContent(findElements(tree, (element) => element.props.role === "alert")[0])).toContain("瀏覽器無法複製公開網址");

    restoreBrowserStubs();
    installBrowserStubs({ clipboard: { writeText: vi.fn(async () => { throw new Error("synthetic clipboard denial"); }) } });
    tree = renderEditor();
    await (findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製"))[0].props.onClick as () => Promise<void>)();
    tree = renderEditor();
    expect(textContent(findElements(tree, (element) => element.props.role === "alert")[0])).toContain("允許剪貼簿權限後重試");
  });

  it("renders action success/error semantics and pending labels without weakening boundaries", () => {
    hookState.actionStates = [{ status: "success", message: "內容已儲存" }, { status: "idle", message: "" }];
    let tree = renderEditor();
    expect(findElements(tree, (element) => element.props.role === "status")[0].props.className).toContain("emerald");
    expect(textContent(findElements(tree, (element) => element.props.role === "status")[0])).toBe("內容已儲存");
    hookState.actionStates = [{ status: "error", message: "儲存失敗" }, { status: "error", message: "發布失敗" }];
    hookState.pending = [false, true];
    tree = renderEditor();
    expect(findElements(tree, (element) => element.props.role === "alert")).toHaveLength(2);
    expect(findElements(tree, (element) => element.props.role === "alert")[0].props.className).toContain("red");
    expect(findElements(tree, (element) => element.props.role === "alert")[0].props["aria-live"]).toBe("assertive");
    const publishButton = findElements(tree, (element) => element.type === "button" && textContent(element).includes("更新中"))[0];
    expect(publishButton.props.disabled).toBe(true);
    expect(publishButton.props["aria-disabled"]).toBe(true);
    expect(publishButton.props["aria-busy"]).toBe(true);
    expect(textContent(publishButton)).toBe("更新中…");
    const busyForms = findElements(tree, (element) => element.type === "form" && element.props["aria-busy"] === true);
    expect(busyForms).toHaveLength(1);
    expect(findElements(tree, (element) => element.props.role === "status" && element.props.className === "sr-only").map(textContent).join(" ")).toContain("正在發布夥伴頁");
  });

  it("requires confirmation before a published page is taken offline", () => {
    installBrowserStubs();
    const confirm = vi.fn(() => false);
    (globalRecord.window as { confirm?: typeof confirm }).confirm = confirm;
    const tree = renderEditor({ isPublished: true });
    const publishForm = findElements(tree, (element) => (
      element.type === "form" && findElements(element, (child) => child.props.name === "publish").length > 0
    ))[0];
    const blocked = { preventDefault: vi.fn() };

    (publishForm.props.onSubmit as (event: typeof blocked) => void)(blocked);

    expect(confirm).toHaveBeenCalledWith("確定要停止公開這個夥伴頁？公開網址會立即停止顯示。");
    expect(blocked.preventDefault).toHaveBeenCalledOnce();

    confirm.mockReturnValue(true);
    const allowed = { preventDefault: vi.fn() };
    (publishForm.props.onSubmit as (event: typeof allowed) => void)(allowed);
    expect(allowed.preventDefault).not.toHaveBeenCalled();
  });
});
