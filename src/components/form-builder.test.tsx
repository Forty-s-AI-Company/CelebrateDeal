import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  actionState: null as { status: "idle" | "error"; message: string } | null,
  pending: false,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: (_action: unknown, initialState: unknown) => [hookState.actionState ?? initialState, vi.fn(), hookState.pending],
  };
});
vi.mock("@/app/actions/form-actions", () => ({ upsertFormBuilderAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("@/components/ui", () => ({ Card: ({ children }: { children: ReactNode }) => <section>{children}</section> }));

import { FormBuilder } from "./form-builder";

beforeEach(() => {
  hookState.actionState = null;
  hookState.pending = false;
});

describe("FormBuilder", () => {
  it("renders a visual builder with protected defaults, preview, and no raw JSON editor", () => {
    const html = renderToStaticMarkup(<FormBuilder draftScope="vendor-1" />);

    expect(html).toContain("1. 基本資料");
    expect(html).toContain("2. 報名欄位");
    expect(html).toContain("即時預覽");
    expect(html).toContain("核心欄位");
    expect(html).toContain("新增欄位");
    expect(html).toContain('name="fields"');
    expect(html).toContain("synthetic");
    expect(html).toContain("修改後會自動保存瀏覽器草稿");
    expect(html).not.toContain("欄位 JSON");
  });

  it("renders an existing valid legacy schema without changing stable field keys", () => {
    const form = {
      id: "form-1",
      name: "活動報名",
      slug: "summer",
      headline: "立即報名",
      description: "說明",
      fields: [
        { key: "name", label: "真實姓名", type: "text", required: true },
        { key: "email", label: "聯絡 Email", type: "email", required: true },
        { key: "company", label: "公司名稱", type: "text", required: false },
      ],
      submitLabel: "送出",
      successMessage: "完成",
      isActive: true,
      updatedAt: new Date("2026-08-10T01:02:03.000Z"),
    } as never;

    const html = renderToStaticMarkup(<FormBuilder form={form} draftScope="vendor-1" />);

    expect(html).toContain('name="id" value="form-1"');
    expect(html).toContain('name="expectedUpdatedAt" value="2026-08-10T01:02:03.000Z"');
    expect(html).toContain("活動報名");
    expect(html).toContain("真實姓名");
    expect(html).toContain("公司名稱");
    expect(html).toContain("company");
    expect(html).not.toContain("儲存已停用");
  });

  it("fails closed for an invalid legacy schema until the merchant explicitly rebuilds it", () => {
    const form = {
      id: "form-legacy",
      name: "舊表單",
      slug: "legacy",
      headline: "舊標題",
      description: null,
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
      submitLabel: "送出",
      successMessage: "完成",
      isActive: true,
      updatedAt: new Date("2026-08-10T01:02:03.000Z"),
    } as never;

    const html = renderToStaticMarkup(<FormBuilder form={form} draftScope="vendor-1" />);

    expect(html).toContain("既有欄位規格無法安全解析");
    expect(html).toContain("儲存已停用");
    expect(html).toContain("重建安全欄位");
  });

  it("keeps legacy redirect errors visible as accessible recovery feedback", () => {
    const html = renderToStaticMarkup(<FormBuilder error="invalid_fields" draftScope="vendor-1" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("先前的欄位設定無法儲存");
  });
});
