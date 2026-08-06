import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Product } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useState: <Value,>(initialValue: Value) => {
      const index = hookState.cursor++;
      if (hookState.values.length === index) hookState.values.push(initialValue);

      const setValue = (nextValue: Value | ((currentValue: Value) => Value)) => {
        const currentValue = hookState.values[index] as Value;
        hookState.values[index] = typeof nextValue === "function"
          ? (nextValue as (currentValue: Value) => Value)(currentValue)
          : nextValue;
      };

      return [hookState.values[index] as Value, setValue];
    },
    useRef: <Value,>(initialValue: Value) => {
      const index = hookState.cursor++;
      if (!hookState.refs[index]) hookState.refs[index] = { current: initialValue };
      return hookState.refs[index] as { current: Value };
    },
  };
});

vi.mock("@/app/actions", () => ({ upsertLiveAction: vi.fn() }));

import { LiveStepperForm } from "./live-stepper-form";

type ElementNode = {
  type: unknown;
  props: Record<string, unknown>;
};

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

function findElement(value: unknown, predicate: (element: ElementNode) => boolean): ElementNode | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const matchingChild = findElement(child, predicate);
      if (matchingChild) return matchingChild;
    }
    return undefined;
  }

  if (!isElementNode(value)) return undefined;
  if (predicate(value)) return value;
  return findElement(value.props.children, predicate);
}

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  return isElementNode(value) ? textContent(value.props.children) : "";
}

const products: Product[] = [
  {
    id: "test-fixture-product-1",
    vendorId: "test-fixture-vendor-1",
    name: "亮白精華組",
    slug: "test-fixture-brightening-serum",
    description: null,
    priceCents: 128000,
    compareAtCents: null,
    currency: "TWD",
    imageUrl: null,
    checkoutUrl: null,
    inventory: 12,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "test-fixture-product-2",
    vendorId: "test-fixture-vendor-1",
    name: "保濕修護霜",
    slug: "test-fixture-repair-cream",
    description: null,
    priceCents: 98000,
    compareAtCents: null,
    currency: "TWD",
    imageUrl: null,
    checkoutUrl: null,
    inventory: 8,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "test-fixture-product-3",
    vendorId: "test-fixture-vendor-1",
    name: "夜間舒緩面膜",
    slug: "test-fixture-night-mask",
    description: null,
    priceCents: 68000,
    compareAtCents: null,
    currency: "TWD",
    imageUrl: null,
    checkoutUrl: null,
    inventory: 20,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
];

type FormOverrides = Partial<Parameters<typeof LiveStepperForm>[0]>;

function renderForm(availableProducts: Product[] = products, overrides: FormOverrides = {}) {
  hookState.cursor = 0;
  return LiveStepperForm({
    videos: [],
    forms: [],
    templates: [],
    scripts: [],
    affiliates: [],
    csrfToken: "test-fixture-csrf-token",
    ...overrides,
    products: availableProducts,
  });
}

function control(tree: unknown, name: string, value?: string) {
  const element = findElement(tree, (candidate) => (
    candidate.type === "input" &&
    candidate.props.name === name &&
    (value === undefined || candidate.props.value === value)
  ));

  expect(element).toBeDefined();
  return element as ElementNode & {
    props: Record<string, unknown> & {
      onChange: (event: { target: { value?: string; checked?: boolean } }) => void;
    };
  };
}

function productSelection(tree: unknown) {
  const element = findElement(tree, (candidate) => (
    typeof candidate.type === "function" && candidate.type.name === "ProductSelection"
  ));
  expect(element).toBeDefined();
  return element as ElementNode & {
    props: Record<string, unknown> & {
      onSelectionChange: (productId: string, checked: boolean) => void;
    };
  };
}

function showPublishPreview(tree: unknown) {
  let currentTree = tree;
  for (let step = 0; step < 7; step += 1) {
    const nextButton = findElement(currentTree, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "下一步"
    ));
    expect(nextButton).toBeDefined();
    (nextButton?.props.onClick as () => void)();
    currentTree = renderForm();
  }

  const publishPanel = findElement(currentTree, (candidate) => (
    candidate.props.active === true && textContent(candidate.props.children).includes("確認直播間設定")
  ));
  expect(publishPanel).toBeDefined();
  return renderToStaticMarkup(publishPanel as unknown as ReactElement);
}

describe("LiveStepperForm", () => {
  beforeEach(() => {
    hookState.cursor = 0;
    hookState.values = [];
    hookState.refs = [];
  });

  it("shows stable default copy in the empty publish preview", () => {
    const preview = showPublishPreview(renderForm([]));

    expect(preview).toContain("未命名直播");
    expect(preview).toContain("直播限定優惠");
    expect(preview).toContain("尚未選擇主打商品");
  });

  it("does not expose a writable Cloudflare Live Input UID field", () => {
    const form = renderForm();
    const providerUidInput = findElement(form, (candidate) => (
      candidate.type === "input" && candidate.props.name === "cloudflareLiveInputUid"
    ));

    expect(providerUidInput).toBeUndefined();
  });

  it("marks the current step and connects every step control to its panel", () => {
    const form = renderForm();
    const basicsButton = findElement(form, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "基本資料"
    ));

    expect(basicsButton?.props["aria-current"]).toBe("step");
    expect(basicsButton?.props["aria-controls"]).toBe("live-step-panel-0");
  });

  it("shows an instructive empty product state instead of a blank panel", () => {
    const form = renderForm([]);
    const productButton = findElement(form, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "商品"
    ));
    expect(productButton).toBeDefined();

    const onClick = productButton?.props.onClick as () => void;
    onClick();
    const productPanel = findElement(renderForm([]), (candidate) => candidate.props.active === true);
    const markup = renderToStaticMarkup(productPanel as unknown as ReactElement);
    expect(markup).toContain("目前沒有可綁定的啟用商品");
  });

  it("updates the publish phone preview with entered copy and selected product summary", () => {
    const form = renderForm();
    control(form, "title").props.onChange({ target: { value: "夏日保養直播" } });
    control(form, "accentCopy").props.onChange({ target: { value: "今晚滿額免運" } });
    const selection = productSelection(form);
    for (const product of products) selection.props.onSelectionChange(product.id, true);

    const preview = showPublishPreview(form);

    expect(preview).toContain("夏日保養直播");
    expect(preview).toContain("今晚滿額免運");
    expect(preview).toContain("亮白精華組");
    expect(preview).toContain("保濕修護霜");
    expect(preview).toContain("及其他 1 件商品");
    expect(preview).not.toContain("尚未選擇主打商品");
  });

  it("moves between steps in both directions and keeps the active panel linked", () => {
    const form = renderForm();
    const nextButton = findElement(form, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "下一步"
    ));
    expect(nextButton).toBeDefined();
    (nextButton?.props.onClick as () => void)();

    const mediaForm = renderForm();
    const mediaButton = findElement(mediaForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "影片 / Live Input"
    ));
    expect(mediaButton?.props["aria-current"]).toBe("step");
    expect(mediaButton?.props["aria-controls"]).toBe("live-step-panel-1");
    const activePanel = findElement(mediaForm, (candidate) => candidate.props.active === true);
    expect(activePanel?.props.index).toBe(1);

    const previousButton = findElement(mediaForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "上一步"
    ));
    expect(previousButton).toBeDefined();
    (previousButton?.props.onClick as () => void)();
    const basicsForm = renderForm();
    const basicsButton = findElement(basicsForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "基本資料"
    ));
    expect(basicsButton?.props["aria-current"]).toBe("step");
    expect(findElement(basicsForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "上一步"
    ))?.props.disabled).toBe(true);
  });

  it("reports required-field validation and refuses to advance until the panel is valid", () => {
    const reportValidity = vi.fn();
    let invalidControl: { reportValidity: () => void } | null = { reportValidity };
    const panel = {
      querySelector: vi.fn(() => invalidControl),
    };
    const formNode = {
      querySelector: vi.fn(() => panel),
    };
    const form = renderForm();
    const formRef = hookState.refs[5];
    expect(formRef).toBeDefined();
    formRef.current = formNode;

    const nextButton = findElement(form, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "下一步"
    ));
    expect(nextButton).toBeDefined();
    (nextButton?.props.onClick as () => void)();

    const blockedForm = renderForm();
    const status = findElement(blockedForm, (candidate) => candidate.props.role === "status");
    expect(textContent(status?.props.children)).toBe("請先完成本步驟的必填欄位，再繼續下一步。");
    expect(reportValidity).toHaveBeenCalledTimes(1);
    expect(panel.querySelector).toHaveBeenCalledWith("input:invalid, select:invalid, textarea:invalid");

    invalidControl = null;
    const retryButton = findElement(blockedForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "下一步"
    ));
    expect(retryButton).toBeDefined();
    (retryButton?.props.onClick as () => void)();
    const advancedForm = renderForm();
    const mediaButton = findElement(advancedForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "影片 / Live Input"
    ));
    expect(mediaButton?.props["aria-current"]).toBe("step");
  });

  it("moves to the invalid field step, focuses the field, and renders invalid-reference feedback", () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousHTMLElement = globalScope.HTMLElement;
    const previousRequestAnimationFrame = globalScope.requestAnimationFrame;

    class SyntheticHTMLElement {
      focus = vi.fn();
      closest = vi.fn(() => ({ dataset: { stepIndex: "3" } }));
    }

    globalScope.HTMLElement = SyntheticHTMLElement;
    globalScope.requestAnimationFrame = (callback: (timestamp: number) => void) => {
      callback(0);
      return 0;
    };

    try {
      const form = renderForm(products, { error: "invalid_reference" });
      const control = new SyntheticHTMLElement();
      const preventDefault = vi.fn();
      const onInvalid = form.props.onInvalid as (event: {
        preventDefault: () => void;
        target: unknown;
      }) => void;

      onInvalid({ preventDefault, target: control });
      const movedForm = renderForm(products, { error: "invalid_reference" });
      const activePanel = findElement(movedForm, (candidate) => candidate.props.active === true);
      expect(activePanel?.props.index).toBe(3);
      expect(control.focus).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalledTimes(1);

      const alert = findElement(movedForm, (candidate) => candidate.props.role === "alert");
      expect(textContent(alert?.props.children)).toContain("直播關聯資料無效");

      onInvalid({ preventDefault, target: {} });
      expect(preventDefault).toHaveBeenCalledTimes(2);
    } finally {
      if (previousHTMLElement === undefined) delete globalScope.HTMLElement;
      else globalScope.HTMLElement = previousHTMLElement;
      if (previousRequestAnimationFrame === undefined) delete globalScope.requestAnimationFrame;
      else globalScope.requestAnimationFrame = previousRequestAnimationFrame;
    }
  });

  it("supports selecting and then removing a product from the preview", () => {
    const form = renderForm();
    const selection = productSelection(form);
    selection.props.onSelectionChange(products[0].id, true);
    selection.props.onSelectionChange(products[0].id, false);

    const preview = showPublishPreview(form);
    expect(preview).toContain("尚未選擇主打商品");
    expect(preview).not.toContain("亮白精華組");
  });

  it("renders every available media, form, template, script, and affiliate option", () => {
    const form = renderForm(products, {
      videos: [{ id: "video-1", title: "示範影片" }],
      forms: [{ id: "form-1", name: "活動報名表" }] as FormOverrides["forms"],
      templates: [{ id: "template-1", name: "開播通知", channel: "email" }] as FormOverrides["templates"],
      scripts: [{ id: "script-1", name: "互動腳本" }] as FormOverrides["scripts"],
      affiliates: [{ id: "affiliate-1", code: "REF-1", name: "合作推廣者" }] as FormOverrides["affiliates"],
    });
    const markup = renderToStaticMarkup(form as ReactElement);

    expect(markup).toContain("示範影片");
    expect(markup).toContain("活動報名表");
    expect(markup).toContain("開播通知 · email");
    expect(markup).toContain("互動腳本");
    expect(markup).toContain("合作推廣者 · REF-1");
  });

  it("renders the final confirmation step and submit action", () => {
    const form = renderForm();
    const publishButton = findElement(form, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "發布"
    ));
    expect(publishButton).toBeDefined();
    (publishButton?.props.onClick as () => void)();

    const reviewForm = renderForm();
    const markup = renderToStaticMarkup(reviewForm as ReactElement);
    expect(markup).toContain("確認直播間設定");
    expect(markup).toContain("建立直播間");
    expect(findElement(reviewForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "上一步"
    ))?.props.disabled).toBe(false);
  });
});
