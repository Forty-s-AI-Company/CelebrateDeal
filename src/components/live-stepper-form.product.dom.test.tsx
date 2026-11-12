// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLiveStudioDraft, LiveStudioDraftPayloadSchema, type LiveStudioDraftEnvelope, type LiveStudioDraftPayload } from "@/lib/live-studio-draft";
import { liveStudioStepIndex } from "@/lib/live-studio-steps";

const mocks = vi.hoisted(() => ({
  upsertLiveAction: vi.fn(async (formData: FormData) => { void formData; }),
  saveLiveStudioDraft: vi.fn(),
  createProductQuickAction: vi.fn(),
}));

vi.mock("@/app/actions", () => ({ upsertLiveAction: mocks.upsertLiveAction }));
vi.mock("@/app/actions/live-resource-quick-create", () => ({
  createRegistrationFormQuickAction: vi.fn(),
  createMessageTemplateQuickAction: vi.fn(),
  createUrlVideoQuickAction: vi.fn(),
  createProductQuickAction: mocks.createProductQuickAction,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/components/media-upload-field", () => ({
  MediaUploadField: ({ defaultUrl, defaultAssetId }: { defaultUrl?: string; defaultAssetId?: string }) => (
    <>
      <input type="hidden" name="heroImageUrl" value={defaultUrl ?? ""} readOnly />
      <input type="hidden" name="heroImageAssetId" value={defaultAssetId ?? ""} readOnly />
    </>
  ),
}));
vi.mock("@/lib/live-studio-draft-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/live-studio-draft-client")>(),
  saveLiveStudioDraft: mocks.saveLiveStudioDraft,
}));

import { LiveStepperForm } from "./live-stepper-form";
import { serializeLiveStudioDraft } from "@/lib/live-studio-draft-client";

type ProductOption = { id: string; name: string; inventory: number };
const existingProduct: ProductOption = { id: "product-existing", name: "既有餐盒", inventory: 5 };
const resources = {
  videos: [],
  forms: [],
  templates: [],
  scripts: [],
  affiliates: [],
  streamMembers: [],
  streamPages: [],
  csrfToken: "test-fixture-csrf-token",
  timeZone: "Asia/Taipei",
};
const salesStep = liveStudioStepIndex("sales");

let container: HTMLDivElement;
let root: Root;

/** A studio opened on 成交, like a merchant who has reached the product step. */
function studio(products: ProductOption[], overrides: { productIds?: string[]; projectId?: string | null; initialDraft?: LiveStudioDraftEnvelope } = {}) {
  const initialValues: LiveStudioDraftPayload = { ...emptyLiveStudioDraft(), activeStep: salesStep, productIds: overrides.productIds ?? [] };
  return (
    <LiveStepperForm
      {...resources}
      products={products}
      initialValues={initialValues}
      initialDraft={overrides.initialDraft}
      projectId={overrides.projectId === undefined ? "project-1" : overrides.projectId}
    />
  );
}

function control<T extends Element = HTMLInputElement>(selector: string, scope: ParentNode = container) {
  const element = scope.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function button(label: string, scope: ParentNode = container) {
  const match = Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`missing button ${label}`);
  return match;
}

function dialog() {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

function checkbox(productId: string) {
  return control<HTMLInputElement>(`input[type="checkbox"][data-live-product-option="${productId}"]`);
}

/** The listed products' checkboxes, in list order. */
function listedProductIds() {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-live-product-option]')).map((input) => input.value);
}

/** The productIds the studio form submits, in submit order. */
function submittedProductIds() {
  return new FormData(control<HTMLFormElement>("form")).getAll("productIds");
}

function announcement() {
  return container.querySelector("[data-live-resource-status]")?.textContent ?? "";
}

async function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
}

/** Lets the studio's 700 ms autosave debounce run, if anything scheduled it. */
async function waitForAutosaveWindow() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
  await settle();
}

async function openDrawer() {
  const trigger = button("新增商品");
  trigger.focus();
  await act(async () => { trigger.click(); });
  return trigger;
}

async function fillDrawer(values: { name?: string; price?: string; inventory?: string } = {}) {
  const drawer = dialog()!;
  await type(control('[name="name"]', drawer), values.name ?? "原型食物餐盒");
  await type(control('[name="price"]', drawer), values.price ?? "1290");
  await type(control('[name="inventory"]', drawer), values.inventory ?? "20");
}

async function submitDrawer() {
  await act(async () => { control<HTMLFormElement>("form", dialog()!).requestSubmit(); });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/lives/new");
  mocks.saveLiveStudioDraft.mockImplementation(async (input: { draftId: string; revision: number | null; payload: LiveStudioDraftPayload }) => ({
    id: input.draftId || "draft-created",
    revision: (input.revision ?? 0) + 1,
    payload: input.payload,
    updatedAt: "2026-11-12T08:05:00.000Z",
    slugTaken: false,
    slugCheckFailed: false,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = "";
});

describe("LiveStepperForm 新增商品 drawer", () => {
  it("creates a product in the drawer and, with nothing ticked yet, ticks it as the pinned product, focuses it and saves the draft", async () => {
    await act(async () => { root.render(studio([existingProduct])); });
    const studioForm = control<HTMLFormElement>("form");
    expect(checkbox(existingProduct.id).checked).toBe(false);
    const trigger = await openDrawer();
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");

    const drawer = dialog()!;
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(drawer.getAttribute("aria-labelledby")!)?.textContent).toBe("新增商品");
    expect(studioForm.contains(drawer)).toBe(false);
    expect(document.activeElement).toBe(control('[name="name"]', drawer));
    // Only the physical type, fixed; the others link to the full editor in a new tab with the project.
    expect(control('[name="fulfillmentType"]', drawer).value).toBe("physical");
    const moreSettings = control<HTMLAnchorElement>('a[href="/products/new?projectId=project-1"]', drawer);
    expect(moreSettings.target).toBe("_blank");
    expect(moreSettings.rel).toBe("noopener");
    expect(moreSettings.textContent).toContain("更多設定");
    expect(control('[name="price"]', drawer).getAttribute("inputmode")).toBe("numeric");
    expect(control('[name="price"]', drawer).type).toBe("text");
    expect(document.getElementById(drawer.getAttribute("aria-describedby")!)?.textContent).toContain("自動勾選為這場直播的置頂（主打）商品");
    expect(button("建立並選取", drawer).getAttribute("type")).toBe("submit");

    await fillDrawer();
    // The drawer's fields never reach the studio's FormData or its autosave.
    const studioData = new FormData(studioForm);
    expect(studioData.has("price")).toBe(false);
    expect(studioData.has("inventory")).toBe(false);

    mocks.createProductQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "product-quick", name: "原型食物餐盒", inventory: 20 } });
    await submitDrawer();
    await waitForAutosaveWindow();

    const sent = mocks.createProductQuickAction.mock.calls[0]![0] as FormData;
    expect(Object.fromEntries(sent.entries())).toEqual({
      _csrf: "test-fixture-csrf-token",
      projectId: "project-1",
      name: "原型食物餐盒",
      price: "1290",
      inventory: "20",
      fulfillmentType: "physical",
    });
    expect(dialog()).toBeNull();
    const created = checkbox("product-quick");
    expect(created.checked).toBe(true);
    expect(checkbox(existingProduct.id).checked).toBe(false);
    expect(document.activeElement).toBe(created);
    expect(announcement()).toBe("已建立並選取商品「原型食物餐盒」，它是這場直播的置頂（主打）商品。");
    expect(created.closest("label")?.textContent).toContain("庫存 20");
    expect(serializeLiveStudioDraft(studioForm, salesStep).productIds).toEqual(["product-quick"]);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ productIds: ["product-quick"] }) }));
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();
  });

  it("with a product already ticked, only lists the new product first and keeps the pinned product", async () => {
    const second: ProductOption = { id: "product-second", name: "第二件商品", inventory: 3 };
    await act(async () => { root.render(studio([existingProduct, second], { productIds: [existingProduct.id, second.id] })); });
    const studioForm = control<HTMLFormElement>("form");
    // The first ticked product in list order is the Live's pinned product.
    expect(serializeLiveStudioDraft(studioForm, salesStep).productIds).toEqual(["product-existing", "product-second"]);
    await openDrawer();
    const drawer = dialog()!;
    const description = document.getElementById(drawer.getAttribute("aria-describedby")!)?.textContent ?? "";
    expect(description).toContain("不會自動勾選");
    expect(description).toContain("第一個就是置頂商品");
    expect(button("建立並加入清單", drawer).getAttribute("type")).toBe("submit");
    expect(Array.from(drawer.querySelectorAll("button")).some((candidate) => candidate.textContent?.trim() === "建立並選取")).toBe(false);

    await fillDrawer();
    mocks.createProductQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "product-quick", name: "原型食物餐盒", inventory: 20 } });
    await submitDrawer();
    await waitForAutosaveWindow();

    expect(dialog()).toBeNull();
    const created = checkbox("product-quick");
    expect(created.checked).toBe(false);
    expect(document.activeElement).toBe(created);
    expect(checkbox(existingProduct.id).checked).toBe(true);
    expect(checkbox(second.id).checked).toBe(true);
    expect(listedProductIds()).toEqual(["product-quick", "product-existing", "product-second"]);
    // The bound products and their order, so the pinned first one, are unchanged; nothing new to save.
    expect(serializeLiveStudioDraft(studioForm, salesStep).productIds).toEqual(["product-existing", "product-second"]);
    expect(mocks.saveLiveStudioDraft).not.toHaveBeenCalled();
    expect(announcement()).toContain("已建立商品「原型食物餐盒」並加入清單最前面，沒有自動勾選，目前的置頂（主打）商品不變");
    expect(announcement()).toContain("勾選後它會排在已勾選商品之後，可以再按「設為置頂」改成置頂商品");

    // Ticking it by hand appends it, as announced: the pinned product stays.
    await act(async () => { created.click(); });
    expect(serializeLiveStudioDraft(studioForm, salesStep).productIds).toEqual(["product-existing", "product-second", "product-quick"]);
    expect(submittedProductIds()).toEqual(["product-existing", "product-second", "product-quick"]);
  });

  it("offers the drawer from the empty state and counts the created product as ready", async () => {
    await act(async () => { root.render(studio([])); });
    expect(control('[data-step-key="sales"]').textContent).toContain("目前沒有可綁定的啟用商品，可以在這裡直接建立");
    expect(container.querySelector('input[name="productIds"]')).toBeNull();
    expect(listedProductIds()).toEqual([]);
    await openDrawer();
    await fillDrawer();
    mocks.createProductQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "product-quick", name: "原型食物餐盒", inventory: 20 } });
    await submitDrawer();

    expect(checkbox("product-quick").checked).toBe(true);
    expect(control('[data-step-key="sales"]').textContent).not.toContain("目前沒有可綁定的啟用商品");
    // The 發布 step's checklist sees the new product as a listed, selected product.
    expect(control('[data-step-key="publish"]').textContent).toContain("原型食物餐盒");
  });

  it("keeps the drawer open with the field messages and never calls the action for local errors", async () => {
    await act(async () => { root.render(studio([])); });
    await openDrawer();
    await fillDrawer({ name: "原型食物餐盒", price: "1290.5", inventory: "0" });
    await submitDrawer();

    expect(mocks.createProductQuickAction).not.toHaveBeenCalled();
    const drawer = dialog()!;
    expect(control('[name="price"]', drawer).getAttribute("aria-invalid")).toBe("true");
    expect(control('[name="inventory"]', drawer).getAttribute("aria-invalid")).toBe("true");
    expect(drawer.textContent).toContain("售價須為新台幣整數元，不含小數點、逗號或符號。");
    expect(drawer.textContent).toContain("可售庫存至少為 1");
    // The error is described by, not part of, the label; focus moves to the first invalid field.
    const price = control('[name="price"]', drawer);
    expect(price.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
    expect(document.activeElement).toBe(price);
  });

  it("shows the server's field errors, keeps the values and does not touch the selection", async () => {
    await act(async () => { root.render(studio([existingProduct], { productIds: [existingProduct.id] })); });
    await openDrawer();
    await fillDrawer();
    mocks.createProductQuickAction.mockResolvedValueOnce({ status: "error", message: "有幾個欄位需要調整；內容仍保留在抽屜中。", fieldErrors: { name: "商品名稱最多 200 字。" } });
    await submitDrawer();
    await waitForAutosaveWindow();

    const drawer = dialog()!;
    expect(drawer.querySelector('[role="alert"]')?.textContent).toContain("有幾個欄位需要調整");
    expect(control('[name="name"]', drawer).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(control('[name="name"]', drawer));
    expect(control('[name="price"]', drawer).value).toBe("1290");
    expect(mocks.saveLiveStudioDraft).not.toHaveBeenCalled();
    expect(checkbox(existingProduct.id).checked).toBe(true);
    expect(listedProductIds()).toEqual([existingProduct.id]);
    expect(submittedProductIds()).toEqual([existingProduct.id]);
  });

  it("says it cannot confirm the create when the action throws, and keeps the drawer open", async () => {
    await act(async () => { root.render(studio([])); });
    await openDrawer();
    await fillDrawer();
    mocks.createProductQuickAction.mockRejectedValueOnce(new Error("network down"));
    await submitDrawer();

    const alert = dialog()!.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain("無法確認是否已建立");
    expect(alert).toContain("重送前可先到「商品」頁確認是否已建立。");
    expect(control<HTMLButtonElement>('button[aria-label="關閉"]', dialog()!).disabled).toBe(false);
  });

  it("does not tick the new product when the selection changed by hand while it was being created", async () => {
    await act(async () => { root.render(studio([existingProduct], { productIds: [existingProduct.id] })); });
    await openDrawer();
    await fillDrawer();
    let finish!: (result: unknown) => void;
    mocks.createProductQuickAction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await submitDrawer();
    expect(control<HTMLButtonElement>('button[aria-label="關閉"]', dialog()!).disabled).toBe(true);

    // A change of the selection that reached the studio while the create ran.
    await act(async () => { checkbox(existingProduct.id).click(); });
    expect(checkbox(existingProduct.id).checked).toBe(false);
    await act(async () => { finish({ status: "success", option: { id: "product-quick", name: "原型食物餐盒", inventory: 20 } }); });
    await settle();

    expect(dialog()).toBeNull();
    expect(checkbox("product-quick").checked).toBe(false);
    expect(checkbox(existingProduct.id).checked).toBe(false);
    expect(announcement()).toContain("你在建立期間改過商品勾選，所以沒有自動勾選");
    expect(document.activeElement).toBe(checkbox("product-quick"));
  });

  it("keeps a product it created when the server props refresh without it", async () => {
    await act(async () => { root.render(studio([])); });
    await openDrawer();
    await fillDrawer();
    mocks.createProductQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "product-quick", name: "原型食物餐盒", inventory: 20 } });
    await submitDrawer();
    const created = checkbox("product-quick");

    await act(async () => { root.render(studio([existingProduct])); });

    expect(checkbox("product-quick")).toBe(created);
    expect(created.checked).toBe(true);
    expect(listedProductIds()).toEqual(["product-quick", "product-existing"]);
    expect(submittedProductIds()).toEqual(["product-quick"]);
  });

  it("does not remount the studio when the create's revalidation brings a newer draft revision", async () => {
    const payload = LiveStudioDraftPayloadSchema.parse({ ...emptyLiveStudioDraft(), title: "週五講座", activeStep: salesStep });
    const envelope = (revision: number): LiveStudioDraftEnvelope => ({ id: "draft-edit", revision, payload, updatedAt: "2026-11-12T08:00:00.000Z" });
    const edit = (revision: number) => (
      <LiveStepperForm {...resources} products={[]} projectId="project-1" initialDraft={envelope(revision)} liveId="live-1" currentStatus="scheduled" />
    );
    await act(async () => { root.render(edit(4)); });
    const studioForm = control<HTMLFormElement>("form");
    await openDrawer();
    await fillDrawer();
    let finish!: (result: unknown) => void;
    mocks.createProductQuickAction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await submitDrawer();

    await act(async () => { root.render(edit(6)); });
    expect(control<HTMLFormElement>("form")).toBe(studioForm);

    await act(async () => { finish({ status: "success", option: { id: "product-quick", name: "原型食物餐盒", inventory: 20 } }); });
    await settle();
    await waitForAutosaveWindow();

    expect(control<HTMLFormElement>("form")).toBe(studioForm);
    expect(checkbox("product-quick").checked).toBe(true);
    // The newer revision is not adopted, so the save reports a conflict instead of overwriting.
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-edit",
      revision: 4,
      payload: expect.objectContaining({ productIds: ["product-quick"] }),
    }));
  });

  it("closes on Escape and the close button, returns focus to the trigger and never opens while the studio submits", async () => {
    await act(async () => { root.render(studio([])); });
    const trigger = await openDrawer();
    await act(async () => {
      control('[name="name"]', dialog()!).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => { trigger.click(); });
    await act(async () => { control<HTMLButtonElement>('button[aria-label="關閉"]', dialog()!).click(); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);

    control<HTMLFormElement>("form").setAttribute("aria-busy", "true");
    await act(async () => { trigger.click(); });
    expect(dialog()).toBeNull();
  });

  it("keeps Tab inside the drawer", async () => {
    await act(async () => { root.render(studio([])); });
    await openDrawer();
    const drawer = dialog()!;
    const focusable = Array.from(drawer.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]):not([type=hidden])"));
    const last = focusable.at(-1)!;
    last.focus();
    await act(async () => { last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(drawer.contains(document.activeElement)).toBe(true);
  });

  it("links to the full product editor without a project when the studio has none", async () => {
    await act(async () => { root.render(studio([], { projectId: null })); });
    const studioLink = control<HTMLAnchorElement>('a[href="/products/new"]');
    expect(studioLink.target).toBe("_blank");
    await openDrawer();
    expect(control<HTMLAnchorElement>('a[href="/products/new"]', dialog()!).target).toBe("_blank");
    expect(dialog()!.querySelector('[name="projectId"]')).toBeNull();
  });
});

describe("LiveStepperForm 商品勾選順序與置頂", () => {
  const productA: ProductOption = { id: "product-a", name: "商品甲", inventory: 4 };
  const productB: ProductOption = { id: "product-b", name: "商品乙", inventory: 6 };
  const productC: ProductOption = { id: "product-c", name: "商品丙", inventory: 8 };
  // The server lists products newest first; the selection order must not follow it.
  const listed = [productA, productB, productC];

  function row(productId: string) {
    return control<HTMLElement>(`[data-live-product-row="${productId}"]`);
  }

  function pinnedRows() {
    return Array.from(container.querySelectorAll("[data-live-product-pinned]")).map((badge) => badge.closest("[data-live-product-row]")!.getAttribute("data-live-product-row"));
  }

  function orderStatus() {
    return control<HTMLElement>("[data-live-product-order-status]").textContent ?? "";
  }

  it("submits the products in the order they were ticked, not in list order, and marks the first one 置頂", async () => {
    await act(async () => { root.render(studio(listed)); });
    const studioForm = control<HTMLFormElement>("form");
    // The visible checkboxes carry no name; only the hidden fields are submitted.
    expect(checkbox(productA.id).hasAttribute("name")).toBe(false);
    expect(submittedProductIds()).toEqual([]);

    await act(async () => { checkbox(productC.id).click(); });
    await act(async () => { checkbox(productA.id).click(); });

    expect(submittedProductIds()).toEqual([productC.id, productA.id]);
    expect(serializeLiveStudioDraft(studioForm, salesStep).productIds).toEqual([productC.id, productA.id]);
    expect(pinnedRows()).toEqual([productC.id]);
    // The checkbox's description says where it stands.
    expect(document.getElementById(checkbox(productC.id).getAttribute("aria-describedby")!)?.textContent).toBe("置頂");
    expect(document.getElementById(checkbox(productA.id).getAttribute("aria-describedby")!)?.textContent).toBe("第 2 個");
    expect(checkbox(productB.id).hasAttribute("aria-describedby")).toBe(false);
    expect(row(productA.id).querySelector("button")?.getAttribute("aria-label")).toBe("設為置頂：商品甲");
    expect(row(productA.id).querySelector("button")?.textContent).toBe("設為置頂");
    expect(row(productB.id).querySelector("button")).toBeNull();
    expect(row(productC.id).querySelector("button")).toBeNull();
    expect(orderStatus()).toBe("");

    // The autosave runs after the hidden fields are in the DOM, so it saves the new order.
    await waitForAutosaveWindow();
    expect(mocks.saveLiveStudioDraft).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ productIds: [productC.id, productA.id] }) }));
  });

  it("設為置頂 moves a ticked product to the front, keeps focus on its row, announces it and saves the order", async () => {
    await act(async () => { root.render(studio(listed, { productIds: [productA.id, productB.id, productC.id] })); });
    expect(pinnedRows()).toEqual([productA.id]);
    const pinC = row(productC.id).querySelector("button")!;
    expect(pinC.getAttribute("type")).toBe("button");
    pinC.focus();

    await act(async () => { pinC.click(); });

    expect(submittedProductIds()).toEqual([productC.id, productA.id, productB.id]);
    expect(pinnedRows()).toEqual([productC.id]);
    expect(document.activeElement).toBe(checkbox(productC.id));
    expect(orderStatus()).toBe("已將「商品丙」設為置頂商品。");
    expect(row(productA.id).querySelector("button")?.getAttribute("aria-label")).toBe("設為置頂：商品甲");
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();

    await waitForAutosaveWindow();
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ productIds: [productC.id, productA.id, productB.id] }) }));
  });

  it("unticking the pinned product makes the second one pinned", async () => {
    await act(async () => { root.render(studio(listed, { productIds: [productB.id, productC.id, productA.id] })); });
    expect(pinnedRows()).toEqual([productB.id]);

    await act(async () => { checkbox(productB.id).click(); });

    expect(checkbox(productB.id).checked).toBe(false);
    expect(submittedProductIds()).toEqual([productC.id, productA.id]);
    expect(pinnedRows()).toEqual([productC.id]);
    expect(orderStatus()).toBe("已取消勾選「商品乙」，「商品丙」成為置頂商品。");
    // Ticking it again appends it; it does not take the pin back.
    await act(async () => { checkbox(productB.id).click(); });
    expect(submittedProductIds()).toEqual([productC.id, productA.id, productB.id]);
    expect(pinnedRows()).toEqual([productC.id]);
  });

  it("restores a saved draft's order, skipping products no longer offered", async () => {
    const payload = LiveStudioDraftPayloadSchema.parse({ ...emptyLiveStudioDraft(), activeStep: salesStep, productIds: ["product-retired", productC.id, productA.id] });
    const draft: LiveStudioDraftEnvelope = { id: "draft-order", revision: 3, payload, updatedAt: "2026-11-12T08:00:00.000Z" };
    await act(async () => { root.render(studio(listed, { initialDraft: draft })); });

    expect(checkbox(productC.id).checked).toBe(true);
    expect(checkbox(productA.id).checked).toBe(true);
    expect(checkbox(productB.id).checked).toBe(false);
    expect(submittedProductIds()).toEqual([productC.id, productA.id]);
    expect(pinnedRows()).toEqual([productC.id]);
    await waitForAutosaveWindow();
    // Restoring alone saves nothing.
    expect(mocks.saveLiveStudioDraft).not.toHaveBeenCalled();
  });

  it("restores a draft saved by the earlier five-step studio in its stored order, so its pinned product does not change", async () => {
    // Older drafts stored the ticked products in list order: the order they would have submitted, first one pinned.
    const { flowVersion, ...current } = emptyLiveStudioDraft();
    void flowVersion;
    const payload = LiveStudioDraftPayloadSchema.parse({ ...current, activeStep: 1, productIds: [productA.id, productC.id] });
    await act(async () => { root.render(studio(listed, { initialDraft: { id: "draft-legacy", revision: 1, payload, updatedAt: "2026-11-01T08:00:00.000Z" } })); });

    expect(submittedProductIds()).toEqual([productA.id, productC.id]);
    expect(pinnedRows()).toEqual([productA.id]);
  });

  describe("hydrate 前（SSR）", () => {
    it("renders the checkboxes and pin buttons disabled, with the server's selection in hidden fields", () => {
      const html = renderToStaticMarkup(studio(listed, { productIds: [productC.id, productA.id] }));
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
      const boxes = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-live-product-option]'));
      expect(boxes.map((input) => input.value)).toEqual([productA.id, productB.id, productC.id]);
      expect(boxes.every((input) => input.hasAttribute("disabled") && !input.hasAttribute("name"))).toBe(true);
      const pinButtons = Array.from(doc.querySelectorAll("[data-live-product-row] button"));
      expect(pinButtons).toHaveLength(1);
      expect(pinButtons.every((candidate) => candidate.hasAttribute("disabled"))).toBe(true);
      expect(Array.from(doc.querySelectorAll<HTMLInputElement>('input[name="productIds"]')).map((input) => [input.type, input.value])).toEqual([["hidden", productC.id], ["hidden", productA.id]]);
      expect(doc.querySelector("[data-live-product-loading]")?.textContent).toBe("頁面載入完成後才能修改商品勾選。");
    });

    it("enables them after hydration and keeps the server's order", async () => {
      const element = studio(listed, { productIds: [productC.id, productA.id] });
      const host = document.createElement("div");
      host.innerHTML = renderToString(element);
      document.body.append(host);
      let hydrated: Root | undefined;
      try {
        await act(async () => { hydrated = hydrateRoot(host, element, { onRecoverableError: () => undefined }); });
        const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-live-product-option]'));
        expect(boxes).toHaveLength(3);
        expect(boxes.some((input) => input.disabled)).toBe(false);
        expect(host.querySelector("[data-live-product-loading]")).toBeNull();
        expect(Array.from(host.querySelectorAll<HTMLButtonElement>("[data-live-product-row] button")).map((candidate) => candidate.disabled)).toEqual([false]);
        expect(new FormData(host.querySelector("form")!).getAll("productIds")).toEqual([productC.id, productA.id]);
      } finally {
        await act(async () => hydrated?.unmount());
        host.remove();
      }
    });
  });
});
