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
  senderName: string;
  contactUrl: string;
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
    onValueChange?: (value: { url: string; assetId: string; resourceId: string }) => void;
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

import { accessibleForeground, BrandSettingsForm } from "./brand-settings-form";

const initialValues: BrandSettingsFormValues = {
  name: "原始品牌",
  slug: "original-brand",
  primaryColor: "#2563eb",
  ctaColor: "#f97316",
  timezone: "Asia/Taipei",
  supportEmail: "support@example.test",
  senderName: "寄件品牌小組",
  contactUrl: "https://original.example.test/contact?from=brand#help",
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

function previewMarkup(html: string) {
  const start = html.indexOf('data-testid="brand-public-preview"');
  const end = html.indexOf("</section>", start) + "</section>".length;
  return html.slice(start, end);
}

beforeEach(() => {
  hookState.actionState = null;
  hookState.action.mockReset();
  hookState.pending = false;
  hookState.stateCursor = 0;
  hookState.stateValues = [];
});

describe("BrandSettingsForm", () => {
  it.each([
    ["#102030", "#405060", "#ffffff", "#ffffff"],
    ["#f5f5f5", "#f97316", "#000000", "#000000"],
    ["#777777", "#777777", "#000000", "#000000"],
  ])("chooses the higher-contrast WCAG foreground for deep, light, and mid-tone colors", (primaryColor, ctaColor, expectedPrimary, expectedCta) => {
    expect(accessibleForeground(primaryColor)).toBe(expectedPrimary);
    expect(accessibleForeground(ctaColor)).toBe(expectedCta);

    const preview = previewMarkup(renderToStaticMarkup(form({ ...initialValues, primaryColor, ctaColor })));
    expect(preview).toContain(`background-color:${primaryColor};color:${expectedPrimary}`);
    expect(preview).toContain(`background-color:${ctaColor};color:${expectedCta}`);
  });

  it("SSR renders controlled public fields with CSRF and no timezone query error", () => {
    const tree = form();
    const html = renderToStaticMarkup(tree);

    expect(html).toContain('name="_csrf" value="csrf-test-token"');
    expect(html).toMatch(/name="name"[^>]*value="原始品牌"/u);
    expect(html).toMatch(/name="slug"[^>]*value="original-brand"/u);
    expect(html).toMatch(/name="timezone"[^>]*value="Asia\/Taipei"/u);
    expect(html).toMatch(/name="supportEmail"[^>]*value="support@example.test"/u);
    expect(html).toMatch(/name="senderName"[^>]*value="寄件品牌小組"/u);
    expect(html).toMatch(/name="contactUrl"[^>]*value="https:\/\/original\.example\.test\/contact\?from=brand#help"/u);
    const contactInput = findElements(tree, (element) => element.type === "input" && element.props.name === "contactUrl")[0];
    expect(contactInput?.props).toMatchObject({ maxLength: 2048 });
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
        senderName: "尚未儲存寄件人",
        contactUrl: "https://unsaved.example.test/contact",
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
    expect(html).toMatch(/name="senderName"[^>]*value="尚未儲存寄件人"/u);
    expect(html).toMatch(/name="contactUrl"[^>]*value="https:\/\/unsaved\.example\.test\/contact"/u);
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

  it("renders desktop and mobile previews with all current public brand values", () => {
    const html = renderToStaticMarkup(form());
    const preview = previewMarkup(html);

    expect(preview).toContain("公開品牌效果預覽");
    expect(preview).toContain("desktop");
    expect(preview).toContain("mobile");
    expect(preview).toContain("原始品牌");
    expect(preview).toContain("original-brand");
    expect(preview).toContain("support@example.test");
    expect(preview).toContain("寄件品牌小組");
    expect(preview).toContain("https://original.example.test/contact?from=brand#help");
    expect(preview).toMatch(/href="https:\/\/original\.example\.test\/contact\?from=brand#help"/u);
    expect(preview).toContain("Asia/Taipei");
    expect(preview).toContain("未發布的品牌效果預覽，不會變更任何公開頁面");
    expect(preview).toContain("立即報名");
    expect(preview).not.toContain("<form");
    expect(preview).not.toContain("mailto:");
    expect(preview).not.toContain("type=\"submit\"");
  });

  it("keeps Logo images and placeholders inside a fixed high-contrast container", () => {
    const imagePreview = previewMarkup(renderToStaticMarkup(form()));
    expect(imagePreview).toMatch(/border border-slate-900 bg-white text-xs font-semibold text-slate-950/u);
    expect(imagePreview).toContain("logo.png");

    hookState.actionState = {
      status: "idle",
      message: "",
      values: { ...initialValues, logoUrl: "" },
    };
    hookState.stateCursor = 0;
    hookState.stateValues = [];
    const placeholderPreview = previewMarkup(renderToStaticMarkup(form()));
    expect(placeholderPreview).toMatch(/border border-slate-900 bg-white text-xs font-semibold text-slate-950/u);
    expect(placeholderPreview).toContain('aria-label="品牌 Logo 預覽佔位"');
    expect(placeholderPreview).toContain(">Logo</span>");
  });

  it("updates the preview when merchant edits public brand fields", () => {
    const tree = form();
    for (const [name, value] of [
      ["name", "即時品牌"],
      ["slug", "live-brand"],
      ["primaryColor", "#102030"],
      ["ctaColor", "#405060"],
      ["timezone", "UTC"],
      ["supportEmail", "hello@example.test"],
      ["senderName", "即時寄件人"],
      ["contactUrl", "https://live.example.test/contact"],
    ] as const) {
      const input = findElements(tree, (element) => element.type === "input" && element.props.name === name)[0];
      const onChange = input?.props.onChange as ((event: { target: { value: string } }) => void) | undefined;
      expect(onChange, name).toBeTypeOf("function");
      onChange?.({ target: { value } });
    }

    hookState.stateCursor = 0;
    const html = renderToStaticMarkup(form());
    const preview = previewMarkup(html);

    expect(preview).toContain("即時品牌");
    expect(preview).toContain("live-brand");
    expect(preview).toContain("hello@example.test");
    expect(preview).toContain("即時寄件人");
    expect(preview).toContain("https://live.example.test/contact");
    expect(preview).toContain("UTC");
    expect(preview).toContain("background-color:#102030");
    expect(preview).toContain("background-color:#405060");
  });

  it("syncs a completed Logo upload into controlled values and the preview", () => {
    const tree = form();
    const mediaField = findElements(tree, (element) => element.props.kind === "image" && element.props.urlInputName === "logoUrl")[0];
    const onValueChange = mediaField?.props.onValueChange as ((value: { url: string; assetId: string; resourceId: string }) => void) | undefined;
    expect(onValueChange).toBeTypeOf("function");

    onValueChange?.({ url: "https://cdn.example.test/new-logo.png", assetId: "logo-asset-2", resourceId: "" });
    hookState.stateCursor = 0;
    const html = renderToStaticMarkup(form());
    const preview = previewMarkup(html);

    expect(preview).toContain("/new-logo.png");
    expect(html).toMatch(/name="logoUrl"[^>]*value="https:\/\/cdn\.example\.test\/new-logo\.png"/u);
    expect(html).toMatch(/name="logoAssetId"[^>]*value="logo-asset-2"/u);
  });

  it("uses fixed safe colors and a Logo placeholder for invalid action values", () => {
    hookState.actionState = {
      status: "error",
      message: "顏色格式無效",
      values: {
        ...initialValues,
        primaryColor: "red; background-image:url(javascript:alert(1))",
        ctaColor: "#12345",
        logoUrl: "javascript:alert(1)",
      },
    };

    const html = renderToStaticMarkup(form());
    const preview = previewMarkup(html);

    expect(preview).toContain("background-color:#2563eb");
    expect(preview).toContain("background-color:#f97316");
    expect(preview).toContain("品牌 Logo 預覽佔位");
    expect(preview).not.toContain("javascript:");
    expect(preview).not.toContain("background-image");
  });

  it.each(["", "javascript:alert(1)", "data:image/png;base64,AAAA", "blob:https://example.test/logo", "http://cdn.example.test/logo.png", "not-a-url"]) (
    "does not render an unsafe Logo URL in the preview: %s",
    (logoUrl) => {
      hookState.actionState = {
        status: "idle",
        message: "",
        values: { ...initialValues, logoUrl },
      };

      const html = renderToStaticMarkup(form());
      const preview = previewMarkup(html);

      expect(preview).not.toMatch(/<img\b/u);
      expect(preview).toContain("品牌 Logo 預覽佔位");
    },
  );

  it("falls back to the brand name and renders an unsafe contact URL as text", () => {
    hookState.actionState = {
      status: "idle",
      message: "",
      values: { ...initialValues, senderName: "", contactUrl: "http://127.0.0.1/contact" },
    };

    const preview = previewMarkup(renderToStaticMarkup(form()));

    expect(preview).toContain("寄件人：原始品牌");
    expect(preview).toContain("http://127.0.0.1/contact（目前不會成為可點連結）");
    expect(preview).toContain('data-contact-url-state="invalid"');
    expect(preview).not.toMatch(/href="[^"]*127\.0\.0\.1/u);
  });

  it.each([
    "https://localhost/contact",
    "https://shop.localhost/contact",
    "https://10.0.0.1/contact",
    "https://[::1]/contact",
    "https://[fc00::1]/contact",
    "https://[::ffff:192.168.1.1]/contact",
  ])("does not render a restricted contact URL as a link: %s", (contactUrl) => {
    hookState.actionState = { status: "idle", message: "", values: { ...initialValues, contactUrl } };
    const preview = previewMarkup(renderToStaticMarkup(form()));

    expect(preview).toContain(contactUrl);
    expect(preview).toContain('data-contact-url-state="invalid"');
    expect(preview).not.toMatch(/<a\b/u);
  });
});
