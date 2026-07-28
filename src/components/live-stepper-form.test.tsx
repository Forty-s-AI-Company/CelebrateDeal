import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Product } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
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
    useRef: <Value,>(initialValue: Value) => ({ current: initialValue }),
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

function renderForm(availableProducts: Product[] = products) {
  hookState.cursor = 0;
  return LiveStepperForm({
    videos: [],
    products: availableProducts,
    forms: [],
    templates: [],
    scripts: [],
    affiliates: [],
    csrfToken: "test-fixture-csrf-token",
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
});
