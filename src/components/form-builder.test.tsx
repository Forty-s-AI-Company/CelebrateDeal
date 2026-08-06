import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("@/app/actions", () => ({ upsertFormAction: mocks.action }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="csrfToken" value="synthetic" /> }));
vi.mock("@/components/ui", () => ({
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Field: ({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string | null }) => <label>{label}<input name={name} defaultValue={defaultValue ?? undefined} /></label>,
  SubmitButton: () => <button type="submit">儲存</button>,
  TextArea: ({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string | null }) => <label>{label}<textarea name={name} defaultValue={defaultValue ?? undefined} /></label>,
}));

import { FormBuilder } from "./form-builder";

describe("FormBuilder", () => {
  it("renders safe defaults and validation feedback for a new form", () => {
    const html = renderToStaticMarkup(<FormBuilder error="invalid_fields" />);
    expect(html).toContain("欄位 JSON 格式不正確"); expect(html).toContain('&quot;key&quot;: &quot;name&quot;'); expect(html).toContain('&quot;key&quot;: &quot;email&quot;'); expect(html).toContain('&quot;key&quot;: &quot;phone&quot;'); expect(html).toContain("synthetic"); expect(html).toContain("儲存"); expect(html).not.toContain('name="id"');
  });

  it("renders an existing form with stable id, fields, and active checkbox", () => {
    const form = { id: "form-1", name: "活動報名", slug: "summer", headline: "立即報名", description: "說明", fields: [{ key: "email" }], submitLabel: "送出", successMessage: "完成", isActive: true } as never;
    const html = renderToStaticMarkup(<FormBuilder form={form} />);
    expect(html).toContain('name="id" value="form-1"'); expect(html).toContain("活動報名"); expect(html).toContain("summer"); expect(html).toContain("立即報名"); expect(html).toContain("email"); expect(html).toContain('checked=""');
  });
});
