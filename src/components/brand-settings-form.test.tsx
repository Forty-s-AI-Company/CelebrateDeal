import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type BrandSettingsFormValues = {
  name: string;
  slug: string;
  primaryColor: string;
  ctaColor: string;
  timezone: string;
  supportEmail: string;
  logoUrl: string;
};

type BrandSettingsActionState = {
  status: "idle" | "error";
  message: string;
  values: BrandSettingsFormValues;
};

const hookState = vi.hoisted(() => ({
  actionState: null as BrandSettingsActionState | null,
  action: vi.fn(),
  pending: false,
  stateCursor: 0,
  stateValues: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: (_action: unknown, initialState: BrandSettingsActionState) => [
      hookState.actionState ?? initialState,
      hookState.action,
      hookState.pending,
    ],
    useState: (initialValue: unknown) => {
      const index = hookState.stateCursor++;
      if (hookState.stateValues[index] === undefined) hookState.stateValues[index] = initialValue;
      const setValue = (nextValue: unknown | ((currentValue: unknown) => unknown)) => {
        const currentValue = hookState.stateValues[index];
        hookState.stateValues[index] = typeof nextValue === "function"
          ? (nextValue as (currentValue: unknown) => unknown)(currentValue)
          : nextValue;
      };
      return [hookState.stateValues[index], setValue];
    },
  };
});

vi.mock("@/app/actions", () => ({ saveBrandSettingsActionState: vi.fn() }));
vi.mock("@/components/form-submit-button", () => ({
  FormSubmitButton: ({ children }: { children: ReactNode }) => <button type="submit">{children}</button>,
}));

import { BrandSettingsForm } from "./brand-settings-form";

const initialValues: BrandSettingsFormValues = {
  name: "原始品牌",
  slug: "original-brand",
  primaryColor: "#2563eb",
  ctaColor: "#f97316",
  timezone: "Asia/Taipei",
  supportEmail: "support@example.test",
  logoUrl: "https://cdn.example.test/logo.png",
};

function form(values = initialValues) {
  return BrandSettingsForm({
    initialValues: values,
    csrfField: <input type="hidden" name="_csrf" value="csrf-test-token" />,
  });
}

type ElementNode = { type: unknown; props: Record<string, unknown> };

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}

function findElements(value: unknown, predicate: (element: ElementNode) => boolean, result: ElementNode[] = []) {
  if (Array.isArray(value)) {
    for (const child of value) findElements(child, predicate, result);
    return result;
  }
  if (!isElementNode(value)) return result;
  if (predicate(value)) result.push(value);
  findElements(value.props.children, predicate, result);
  return result;
}

beforeEach(() => {
  hookState.actionState = null;
  hookState.action.mockReset();
  hookState.pending = false;
  hookState.stateCursor = 0;
  hookState.stateValues = [];
});

describe("BrandSettingsForm", () => {
  it("SSR renders controlled public fields with CSRF and no timezone query error", () => {
    const html = renderToStaticMarkup(form());

    expect(html).toContain('name="_csrf" value="csrf-test-token"');
    expect(html).toMatch(/name="name"[^>]*value="原始品牌"/u);
    expect(html).toMatch(/name="slug"[^>]*value="original-brand"/u);
    expect(html).toMatch(/name="timezone"[^>]*value="Asia\/Taipei"/u);
    expect(html).toMatch(/name="supportEmail"[^>]*value="support@example.test"/u);
    expect(html).toMatch(/name="logoUrl"[^>]*value="https:\/\/cdn\.example\.test\/logo\.png"/u);
    expect(html).not.toContain('role="alert"');
  });

  it("renders every safe submitted public value after invalid timezone state", () => {
    hookState.actionState = {
      status: "error",
      message: "時區格式無效，請輸入有效的 IANA 時區，例如 Asia/Taipei。",
      values: {
        name: "未儲存品牌",
        slug: "unsaved-brand",
        primaryColor: "#102030",
        ctaColor: "#405060",
        timezone: "Mars/Olympus_Mons",
        supportEmail: "unsaved@example.test",
        logoUrl: "https://unsaved.example.test/logo.png",
      },
    };

    const html = renderToStaticMarkup(form());

    expect(html).toContain('role="alert"');
    expect(html).toContain("時區格式無效");
    expect(html).toMatch(/name="name"[^>]*value="未儲存品牌"/u);
    expect(html).toMatch(/name="slug"[^>]*value="unsaved-brand"/u);
    expect(html).toMatch(/name="timezone"[^>]*value="Mars\/Olympus_Mons"/u);
    expect(html).toMatch(/name="supportEmail"[^>]*value="unsaved@example.test"/u);
    expect(html).toMatch(/name="logoUrl"[^>]*value="https:\/\/unsaved\.example\.test\/logo\.png"/u);
    expect(html).not.toContain("vendor-1");
  });

  it("keeps input values controlled when a merchant edits a field", () => {
    const tree = form();
    const nameInput = findElements(tree, (element) => element.type === "input" && element.props.name === "name")[0];
    const onChange = nameInput?.props.onChange as ((event: { target: { value: string } }) => void) | undefined;
    expect(onChange).toBeTypeOf("function");

    onChange?.({ target: { value: "修改後品牌" } });
    hookState.stateCursor = 0;
    const html = renderToStaticMarkup(form());

    expect(html).toMatch(/name="name"[^>]*value="修改後品牌"/u);
  });
});
