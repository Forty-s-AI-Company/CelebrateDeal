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
  logoAssetId?: string;
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
vi.mock("@/components/media-upload-field", () => ({
  MediaUploadField: (props: {
    kind: string;
    defaultUrl?: string | null;
    defaultAssetId?: string | null;
    urlInputName?: string;
    assetIdInputName?: string;
    statusInputName?: string;
    allowExternalUrlFallback?: boolean;
    onBlockingChange?: (blocked: boolean) => void;
  }) => (
    <div
      data-testid="media-upload-field"
      data-kind={props.kind}
      data-default-url={props.defaultUrl ?? ""}
      data-default-asset-id={props.defaultAssetId ?? ""}
      data-url-input-name={props.urlInputName ?? ""}
      data-asset-id-input-name={props.assetIdInputName ?? ""}
      data-status-input-name={props.statusInputName ?? ""}
      data-allow-external-url-fallback={props.allowExternalUrlFallback ? "true" : "false"}
    >
      {props.urlInputName ? <input type="hidden" name={props.urlInputName} value={props.defaultUrl ?? ""} readOnly /> : null}
      {props.assetIdInputName ? <input type="hidden" name={props.assetIdInputName} value={props.defaultAssetId ?? ""} readOnly /> : null}
      {props.statusInputName ? <input type="hidden" name={props.statusInputName} value="idle" readOnly /> : null}
    </div>
  ),
}));
vi.mock("@/components/form-submit-button", () => ({
  FormSubmitButton: ({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) => (
    <button type="submit" disabled={disabled} aria-disabled={disabled}>{children}</button>
  ),
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
  logoAssetId: "logo-asset-1",
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
    const tree = form();
    const html = renderToStaticMarkup(tree);

    expect(html).toContain('name="_csrf" value="csrf-test-token"');
    expect(html).toMatch(/name="name"[^>]*value="原始品牌"/u);
    expect(html).toMatch(/name="slug"[^>]*value="original-brand"/u);
    expect(html).toMatch(/name="timezone"[^>]*value="Asia\/Taipei"/u);
    expect(html).toMatch(/name="supportEmail"[^>]*value="support@example.test"/u);
    expect(html).toMatch(/name="logoUrl"[^>]*value="https:\/\/cdn\.example\.test\/logo\.png"/u);
    expect(html).toMatch(/name="logoAssetId"[^>]*value="logo-asset-1"/u);
    expect(html).not.toContain(">Logo URL<");
    expect(html).not.toContain('role="alert"');

    const mediaField = findElements(tree, (element) => element.props.kind === "image" && element.props.urlInputName === "logoUrl")[0];
    expect(mediaField?.props).toMatchObject({
      kind: "image",
      defaultUrl: "https://cdn.example.test/logo.png",
      defaultAssetId: "logo-asset-1",
      urlInputName: "logoUrl",
      assetIdInputName: "logoAssetId",
      statusInputName: "logoUploadPhase",
      allowExternalUrlFallback: true,
    });
    expect(mediaField?.props.onBlockingChange).toBeTypeOf("function");
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
        logoAssetId: "unsaved-logo-asset",
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
    expect(html).toMatch(/name="logoAssetId"[^>]*value="unsaved-logo-asset"/u);
    expect(html).not.toContain("vendor-1");
  });

  it("disables submit and explains how to recover while a Logo upload is blocked", () => {
    const tree = form();
    const mediaField = findElements(tree, (element) => element.props.kind === "image" && element.props.urlInputName === "logoUrl")[0];
    const onBlockingChange = mediaField?.props.onBlockingChange as ((blocked: boolean) => void) | undefined;
    expect(onBlockingChange).toBeTypeOf("function");

    onBlockingChange?.(true);
    hookState.stateCursor = 0;
    const html = renderToStaticMarkup(form());

    expect(html).toContain("Logo 上傳尚未完成");
    expect(html).toContain("完成上傳或移除未完成的檔案");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-disabled="true"/u);
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
