// @vitest-environment happy-dom
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/product-server-actions", () => ({ upsertProductAction: vi.fn() }));
vi.mock("@/components/media-upload-field", () => ({ MediaUploadField: () => <div data-testid="media-upload" /> }));

import { ProductFormClient, type ProductFormProduct } from "./product-form-client";
import { bpsToPercentText, SHARE_PERCENT_INPUT_PATTERN } from "@/lib/product-share-percent";
import { upsertProductAction } from "@/app/actions/product-server-actions";
import { PRODUCT_FORM_SECTIONS, sectionOfField } from "./product-form-sections";

let container: HTMLDivElement;
let root: Root;

type ObserverRecord = { callback: IntersectionObserverCallback; targets: Element[]; disconnected: boolean };
let observers: ObserverRecord[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  observers = [];
  class FakeObserver {
    record: ObserverRecord;
    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, targets: [], disconnected: false };
      observers.push(this.record);
    }
    observe(target: Element) { this.record.targets.push(target); }
    unobserve() {}
    disconnect() { this.record.disconnected = true; }
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const courseProduct: ProductFormProduct = {
  id: "p1", revision: 1, name: "課程", slug: "course", description: null, priceCents: 100_000, compareAtCents: null,
  currency: "TWD", imageUrl: null, imageAssetId: null, checkoutUrl: null, inventory: 5, isActive: false,
  commerceDomain: "course", fulfillmentType: "course", fulfillmentTypeConfirmed: true,
  courseContentOwnerMembershipId: "m1", coursePromoterShareBps: 2050,
  deliveryTitle: "", deliveryUrl: "", deliveryInstructions: "", deliveryHostConfirmed: false,
};

async function render(props: Partial<Parameters<typeof ProductFormClient>[0]> = {}) {
  await act(async () => {
    root.render(<ProductFormClient csrfToken="synthetic-csrf" memberships={[{ id: "m1", teamName: "團隊", memberName: "成員" }]} {...props} />);
  });
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const percentInput = () => container.querySelector<HTMLInputElement>('[data-field-name="coursePromoterShareBps"]')!;
const hiddenBps = () => container.querySelector<HTMLInputElement>('input[type="hidden"][name="coursePromoterShareBps"]')!;
const submittedBps = () => new FormData(container.querySelector("form")!).get("coursePromoterShareBps");

describe("商品表單段落", () => {
  it("依序渲染五個段落，每段是由 h2 命名的 section，並附一句說明", async () => {
    await render();
    const sections = [...container.querySelectorAll("section")];
    expect(sections.map((section) => section.id)).toEqual(PRODUCT_FORM_SECTIONS.map((section) => `product-section-${section.key}`));
    for (const [index, section] of sections.entries()) {
      const heading = section.querySelector("h2")!;
      expect(heading.textContent).toBe(PRODUCT_FORM_SECTIONS[index]!.label);
      expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
      expect(heading.getAttribute("tabindex")).toBe("-1");
      expect(heading.nextElementSibling?.tagName).toBe("P");
      expect(heading.nextElementSibling?.textContent?.length).toBeGreaterThan(5);
    }
    expect(container.querySelectorAll("h1, h3")).toHaveLength(0);
  });

  it("把每個欄位放進語意對應的段落", async () => {
    await render({ product: courseProduct });
    const sectionOf = (selector: string) => container.querySelector(selector)!.closest("section")!.id;
    expect(sectionOf('[name="name"]')).toBe("product-section-basic");
    expect(sectionOf('[name="description"]')).toBe("product-section-basic");
    expect(sectionOf('[name="price"]')).toBe("product-section-pricing");
    expect(sectionOf('[name="inventory"]')).toBe("product-section-pricing");
    expect(sectionOf('[name="fulfillmentType"]')).toBe("product-section-delivery");
    expect(sectionOf('[data-field-name="coursePromoterShareBps"]')).toBe("product-section-delivery");
    expect(sectionOf('[name="customCheckoutFields"]')).toBe("product-section-checkout");
    expect(sectionOf('[name="upsellProductId"]')).toBe("product-section-checkout");
    expect(sectionOf('[name="checkoutUrl"]')).toBe("product-section-advanced");
    expect(sectionOf('[name="isActive"]')).toBe("product-section-advanced");
    for (const name of ["name", "slug", "price", "compareAt", "inventory", "courseContentOwnerMembershipId", "coursePromoterShareBps", "deliveryTitle", "deliveryUrl", "deliveryInstructions", "deliveryHostConfirmed", "checkoutUrl", "imageUrl", "currency", "description"]) {
      expect(PRODUCT_FORM_SECTIONS.map((section) => section.key)).toContain(sectionOfField(name));
    }
  });

  it("桌機側邊與手機選單各有一份錨點連結，指向各段落", async () => {
    await render();
    const desktop = container.querySelector('nav[aria-label="商品表單段落"]')!;
    const mobile = container.querySelector('nav[aria-label="商品表單段落（手機）"]')!;
    for (const nav of [desktop, mobile]) {
      const links = [...nav.querySelectorAll("a")];
      expect(links.map((link) => link.getAttribute("href"))).toEqual(PRODUCT_FORM_SECTIONS.map((section) => `#product-section-${section.key}`));
      expect(links.map((link) => link.textContent?.replace(/^\d/u, ""))).toEqual(PRODUCT_FORM_SECTIONS.map((section) => section.label));
    }
    expect(mobile.closest("details")?.className).toContain("lg:hidden");
    expect(desktop.className).toContain("hidden");
    expect(desktop.className).toContain("lg:block");
  });

  it("預設第一段 aria-current；點擊後切換、移動焦點到段落標題並捲動，手機選單收合", async () => {
    await render();
    const desktop = container.querySelector('nav[aria-label="商品表單段落"]')!;
    const current = (nav: Element) => [...nav.querySelectorAll("a[aria-current]")].map((link) => link.getAttribute("data-section-link"));
    expect(current(desktop)).toEqual(["basic"]);
    expect(desktop.querySelector("a[aria-current]")?.getAttribute("aria-current")).toBe("location");

    const details = container.querySelector("details")!;
    details.open = true;
    const link = desktop.querySelector<HTMLAnchorElement>('a[data-section-link="delivery"]')!;
    await act(async () => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

    expect(current(desktop)).toEqual(["delivery"]);
    expect(document.activeElement).toBe(document.getElementById("product-section-delivery-title"));
    expect(document.getElementById("product-section-delivery")!.scrollIntoView).toHaveBeenCalled();
    expect(details.open).toBe(false);
  });

  it("IntersectionObserver 回報可見段落時更新 aria-current，取畫面順序中第一個", async () => {
    await render();
    expect(observers).toHaveLength(1);
    const [observer] = observers;
    expect(observer!.targets.map((target) => target.id)).toEqual(PRODUCT_FORM_SECTIONS.map((section) => `product-section-${section.key}`));
    const entry = (key: string, isIntersecting: boolean) => ({ target: document.getElementById(`product-section-${key}`)!, isIntersecting }) as unknown as IntersectionObserverEntry;
    const currentKeys = () => [...container.querySelectorAll('nav[aria-label="商品表單段落"] a[aria-current]')].map((link) => link.getAttribute("data-section-link"));

    await act(async () => { observer!.callback([entry("pricing", true)], {} as IntersectionObserver); });
    expect(currentKeys()).toEqual(["pricing"]);
    await act(async () => { observer!.callback([entry("checkout", true)], {} as IntersectionObserver); });
    expect(currentKeys()).toEqual(["pricing"]);
    await act(async () => { observer!.callback([entry("pricing", false)], {} as IntersectionObserver); });
    expect(currentKeys()).toEqual(["checkout"]);
  });

  it("卸載時中斷 IntersectionObserver", async () => {
    await render();
    await act(async () => { root.unmount(); });
    expect(observers[0]!.disconnected).toBe(true);
    root = createRoot(container);
  });
});

describe("分潤比例百分比", () => {
  it("以百分比顯示既有的萬分比值，且畫面不出現「萬分比」", async () => {
    await render({ product: courseProduct });
    expect(percentInput().value).toBe("20.5");
    expect(hiddenBps().value).toBe("2050");
    expect(container.textContent).not.toContain("萬分比");
    expect(container.querySelector("label")?.parentElement?.innerHTML).not.toContain("Bps");
    expect(percentInput().getAttribute("name")).toBeNull();
    expect(percentInput().type).toBe("text");
    expect(percentInput().inputMode).toBe("decimal");
    expect(percentInput().readOnly).toBe(false);
    // 原生驗證擋下科學記號與超過兩位小數，放行 .5、前導零與一般數字
    const nativePattern = new RegExp(`^(?:${percentInput().getAttribute("pattern")})$`, "u");
    expect(percentInput().getAttribute("pattern")).toBe(SHARE_PERCENT_INPUT_PATTERN);
    for (const ok of ["20", "20.5", ".5", "0020", "99.99"]) expect(nativePattern.test(ok), ok).toBe(true);
    for (const bad of ["1e3", "2e1", "20.005", "-5", "20.", "1,5"]) expect(nativePattern.test(bad), bad).toBe(false);
    expect(container.textContent).toContain("課程推廣者分潤比例（%）");
  });

  it("新商品選課程後欄位為空，送出值為空字串", async () => {
    await render();
    const select = container.querySelector<HTMLSelectElement>('select[name="fulfillmentType"]')!;
    expect(container.querySelector('[data-field-name="coursePromoterShareBps"]')).toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "course");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(percentInput().value).toBe("");
    expect(submittedBps()).toBe("");
  });

  it("不是課程時不送出分潤欄位", async () => {
    await render({ product: { ...courseProduct, fulfillmentType: "digital", commerceDomain: "merchant", coursePromoterShareBps: null } });
    expect(submittedBps()).toBeNull();
  });

  it.each([
    // 最小、最大、整數、小數、浮點數陷阱（0.29 * 100、1.1 * 100、20.1 * 100）
    [".5", "50"], ["0020", "2000"], ["00.5", "50"], ["2e1", "invalid:2e1"], ["1000", "invalid:1000"], ["20.", "invalid:20."],
    ["0.01", "1"], ["0.1", "10"], ["0.29", "29"], ["1.1", "110"], ["20.1", "2010"], ["12.34", "1234"],
    ["20", "2000"], ["50", "5000"], ["99.99", "9999"], ["99.9", "9990"], ["1", "100"],
    // 超出伺服器 1–9999 的整數照換算送出，由伺服器回報範圍錯誤
    ["0", "0"], ["0.00", "0"], ["100", "10000"],
    // 無法無損換算：不進位也不截斷
    ["20.005", "invalid:20.005"], ["0.001", "invalid:0.001"], ["1e3", "invalid:1e3"], ["-5", "invalid:-5"],
    ["", ""],
  ])("輸入 %j%% 時送出 coursePromoterShareBps=%j", async (typed, expected) => {
    await render({ product: courseProduct });
    await typeInto(percentInput(), typed);
    expect(submittedBps()).toBe(expected);
  });

  it("送出伺服器的原值也能原樣讀回（1 到 9999 全部可往返）", async () => {
    for (const bps of [1, 9, 10, 99, 100, 101, 1234, 2000, 2050, 5000, 9990, 9999]) {
      await act(async () => { root.unmount(); });
      root = createRoot(container);
      await render({ product: { ...courseProduct, coursePromoterShareBps: bps } });
      expect(percentInput().value).toBe(bpsToPercentText(String(bps)));
      expect(submittedBps()).toBe(String(bps));
    }
  });
});

function mockFailedResponse(fieldErrors: Record<string, string>) {
  const calls: FormData[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(init.body as FormData);
    return new Response(JSON.stringify({ error: "invalid_product", fieldErrors }), { status: 400, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

async function submit() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}


describe("hydrate 前的分潤比例欄位（SSR）", () => {
  it("百分比輸入框為 readOnly 並顯示原值，隱藏欄位送出原 bps，且說明載入完成後才能修改", () => {
    const html = renderToStaticMarkup(<ProductFormClient csrfToken="synthetic-csrf" product={courseProduct} memberships={[{ id: "m1", teamName: "團隊", memberName: "成員" }]} />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const visible = doc.querySelector<HTMLInputElement>('[data-field-name="coursePromoterShareBps"]')!;
    expect(visible.hasAttribute("readonly")).toBe(true);
    expect(visible.getAttribute("value")).toBe("20.5");
    expect(visible.hasAttribute("name")).toBe(false);
    const hidden = doc.querySelector<HTMLInputElement>('input[type="hidden"][name="coursePromoterShareBps"]')!;
    expect(hidden.getAttribute("value")).toBe("2050");
    expect(doc.querySelector("[data-share-loading]")?.textContent).toBe("頁面載入完成後才能修改。");
  });

  it("hydrate 後解除唯讀並移除說明", async () => {
    await render({ product: courseProduct });
    expect(percentInput().readOnly).toBe(false);
    expect(container.querySelector("[data-share-loading]")).toBeNull();
  });
});

describe("伺服器退回的草稿", () => {
  it("remount 時從 invalid: 草稿回填使用者輸入的原文並顯示錯誤，送出值仍是伺服器必拒的值", async () => {
    const draft = {
      name: "課程", slug: "course", description: "", price: "1000", compareAt: "", currency: "TWD", inventory: "5",
      fulfillmentType: "course", courseContentOwnerMembershipId: "m1", coursePromoterShareBps: "invalid:20.005",
      deliveryTitle: "", deliveryUrl: "", deliveryInstructions: "", deliveryHostConfirmed: false,
      imageUrl: "", imageAssetId: "", checkoutUrl: "", isActive: false, customCheckoutFields: [],
    };
    vi.mocked(upsertProductAction).mockResolvedValueOnce({
      version: 1, error: "invalid_course_policy", draft,
      fieldErrors: { coursePromoterShareBps: "分潤比例須為 1 到 9999 的整數（萬分比）。" },
    });
    await render({ product: courseProduct, nativeAction: "" });
    await typeInto(percentInput(), "30");
    expect(hiddenBps().value).toBe("3000");
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(upsertProductAction).toHaveBeenCalled();
    expect(percentInput().value).toBe("20.005");
    expect(hiddenBps().value).toBe("invalid:20.005");
    expect(percentInput().getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("[data-form-error-summary]")?.textContent).toContain("分潤比例須介於 0.01% 到 99.99%");
  });
});

describe("送出失敗的錯誤摘要", () => {
  it("只替換含「萬分比」的伺服器分潤訊息，其他訊息原樣顯示", async () => {
    mockFailedResponse({ coursePromoterShareBps: "請填寫分潤比例。" });
    await render({ product: courseProduct });
    await submit();
    const summary = container.querySelector("[data-form-error-summary]")!.textContent;
    expect(summary).toContain("請填寫分潤比例。");
    expect(summary).not.toContain("0.01% 到 99.99%，最多兩位小數。");
  });

  it("未知的欄位名稱不進選擇器，改聚焦第一段標題", async () => {
    mockFailedResponse({ 'x"], [name': "怪欄位錯誤" });
    await render();
    await submit();
    const link = container.querySelector<HTMLAnchorElement>("a[data-field-link]")!;
    await act(async () => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(document.getElementById("product-section-basic-title"));
  });

  it("摘要連結指向對應段落；點擊後焦點跳到欄位並更新目前段落", async () => {
    const calls = mockFailedResponse({
      name: "請填寫商品名稱。",
      inventory: "請填寫可售庫存。",
      coursePromoterShareBps: "分潤比例須為 1 到 9999 的整數（萬分比）。",
      checkoutUrl: "外部結帳網址不正確。",
    });
    await render({ product: courseProduct });
    await typeInto(percentInput(), "20.5");
    await submit();

    expect(calls[0]!.get("coursePromoterShareBps")).toBe("2050");
    const summary = container.querySelector("[data-form-error-summary]")!;
    const links = [...summary.querySelectorAll<HTMLAnchorElement>("a[data-field-link]")];
    expect(Object.fromEntries(links.map((link) => [link.dataset.fieldLink, link.getAttribute("href")]))).toEqual({
      name: "#product-section-basic",
      inventory: "#product-section-pricing",
      coursePromoterShareBps: "#product-section-delivery",
      checkoutUrl: "#product-section-advanced",
    });
    // 伺服器訊息的「萬分比」改成百分比說法
    expect(summary.textContent).not.toContain("萬分比");
    expect(summary.textContent).toContain("分潤比例須介於 0.01% 到 99.99%，最多兩位小數。");
    expect(percentInput().getAttribute("aria-invalid")).toBe("true");

    const click = async (name: string) => {
      const link = container.querySelector<HTMLAnchorElement>(`a[data-field-link="${name}"]`)!;
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      await act(async () => { link.dispatchEvent(event); });
      return event;
    };
    const currentKey = () => container.querySelector('nav[aria-label="商品表單段落"] a[aria-current]')?.getAttribute("data-section-link");

    const event = await click("inventory");
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('[name="inventory"]'));
    expect(currentKey()).toBe("pricing");

    await click("coursePromoterShareBps");
    expect(document.activeElement).toBe(percentInput());
    expect(currentKey()).toBe("delivery");

    await click("checkoutUrl");
    expect(document.activeElement).toBe(container.querySelector('[name="checkoutUrl"]'));
    expect(currentKey()).toBe("advanced");
  });

  it("沒有可聚焦欄位的錯誤（固定幣別）改為聚焦所在段落標題", async () => {
    mockFailedResponse({ currency: "平台目前只支援新台幣。" });
    await render();
    await submit();
    const link = container.querySelector<HTMLAnchorElement>('a[data-field-link="currency"]')!;
    expect(link.getAttribute("href")).toBe("#product-section-pricing");
    await act(async () => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(document.getElementById("product-section-pricing-title"));
  });

  it("送出失敗後焦點先到第一個無效欄位", async () => {
    mockFailedResponse({ slug: "網址已被使用。", price: "售價須為整數。" });
    await render();
    await submit();
    expect(document.activeElement).toBe(container.querySelector('[name="slug"]'));
  });
});
