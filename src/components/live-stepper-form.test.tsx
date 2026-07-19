import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { Product } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookHarness = vi.hoisted(() => {
  let cursor = 0;
  let values: unknown[] = [];

  return {
    reset() {
      cursor = 0;
      values = [];
    },
    beginRender() {
      cursor = 0;
    },
    useState<T>(initialValue: T) {
      const index = cursor++;
      if (index === values.length) values.push(initialValue);

      return [
        values[index] as T,
        (nextValue: T | ((currentValue: T) => T)) => {
          values[index] = typeof nextValue === "function"
            ? (nextValue as (currentValue: T) => T)(values[index] as T)
            : nextValue;
        },
      ] as const;
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: hookHarness.useState };
});

import { LiveStepperForm } from "./live-stepper-form";

const products: Product[] = [
  {
    id: "test-fixture-product-1",
    vendorId: "test-fixture-vendor",
    name: "夏日保養組",
    slug: "test-fixture-summer-care",
    description: null,
    priceCents: 129000,
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
    vendorId: "test-fixture-vendor",
    name: "清爽防曬乳",
    slug: "test-fixture-sunscreen",
    description: null,
    priceCents: 79000,
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
    vendorId: "test-fixture-vendor",
    name: "旅行收納包",
    slug: "test-fixture-travel-pouch",
    description: null,
    priceCents: 49000,
    compareAtCents: null,
    currency: "TWD",
    imageUrl: null,
    checkoutUrl: null,
    inventory: 5,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
];

type ElementProps = Record<string, unknown> & { children?: ReactNode };
type ElementNode = ReactElement<ElementProps>;

function isElementNode(node: ReactNode): node is ElementNode {
  return isValidElement<ElementProps>(node);
}

function findElements(node: ReactNode): ElementNode[] {
  if (Array.isArray(node)) return node.flatMap(findElements);
  if (!isElementNode(node)) return [];

  return [node, ...findElements(node.props.children)];
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isElementNode(node)) return "";
  return textContent(node.props.children);
}

function renderForm() {
  hookHarness.beginRender();
  return LiveStepperForm({
    videos: [],
    products,
    forms: [],
    templates: [],
    scripts: [],
    affiliates: [],
    csrfToken: "test-fixture-csrf-token",
  });
}

function findControl(tree: ReactNode, name: string, value?: string) {
  const control = findElements(tree).find((element) => (
    element.props.name === name && (value === undefined || element.props.value === value)
  ));

  expect(control).toBeDefined();
  return control as ElementNode;
}

function changeValue(control: ElementNode, value: string) {
  const onChange = control.props.onChange as ((event: { target: { value: string } }) => void) | undefined;
  expect(onChange).toBeTypeOf("function");
  onChange?.({ target: { value } });
}

function changeCheckbox(control: ElementNode, checked: boolean) {
  const onChange = control.props.onChange as ((event: { target: { checked: boolean } }) => void) | undefined;
  expect(onChange).toBeTypeOf("function");
  onChange?.({ target: { checked } });
}

function openReview(tree: ReactNode) {
  const reviewButton = findElements(tree).find((element) => (
    element.props.type === "button" && textContent(element.props.children as ReactNode) === "發布"
  ));
  const onClick = reviewButton?.props.onClick as (() => void) | undefined;

  expect(onClick).toBeTypeOf("function");
  onClick?.();
}

describe("LiveStepperForm", () => {
  beforeEach(() => hookHarness.reset());

  it("shows stable default copy in the blank-state publishing preview", () => {
    const blankForm = renderForm();
    openReview(blankForm);

    const previewHtml = renderToStaticMarkup(renderForm());

    expect(previewHtml).toContain("未命名直播");
    expect(previewHtml).toContain("直播限定優惠");
    expect(previewHtml).toContain("尚未選擇主打商品");
  });

  it("updates the publishing phone preview when title, promotion, and products change", () => {
    const initialForm = renderForm();

    changeValue(findControl(initialForm, "title"), "週五新品導購直播");
    changeValue(findControl(initialForm, "accentCopy"), "今晚限時免運");
    for (const product of products) {
      changeCheckbox(findControl(initialForm, "productIds", product.id), true);
    }
    openReview(initialForm);

    const previewHtml = renderToStaticMarkup(renderForm());

    expect(previewHtml).toContain("週五新品導購直播");
    expect(previewHtml).toContain("今晚限時免運");
    expect(previewHtml).toContain("夏日保養組");
    expect(previewHtml).toContain("清爽防曬乳");
    expect(previewHtml).toContain("及其他 1 件商品");
  });
});
