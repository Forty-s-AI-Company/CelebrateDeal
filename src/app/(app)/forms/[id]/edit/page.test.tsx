import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }), requireVendorManager: vi.fn(), findFirst: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ registrationForm: { findFirst: mocks.findFirst } }) }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock("@/components/form-builder", () => ({ FormBuilder: ({ form, error }: { form?: { id: string; name: string; fields: unknown }; error?: string }) => <div data-testid="form-builder">{JSON.stringify({ id: form?.id, name: form?.name, fields: form?.fields, error })}</div> }));

import EditFormPage from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); mocks.findFirst.mockResolvedValue({ id: "form-1", name: "活動報名", slug: "summer", fields: [{ key: "email" }] }); });

describe("/forms/[id]/edit route", () => {
  it("scopes the form query and forwards form data and error", async () => {
    const html = renderToStaticMarkup(await EditFormPage({ params: Promise.resolve({ id: "form-1" }), searchParams: Promise.resolve({ error: "invalid_fields" }) }));
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "form-1", vendorId: "vendor-1" } }); expect(html).toContain("編輯報名表"); expect(html).toContain("form-1"); expect(html).toContain("invalid_fields");
  });

  it("fails closed when a foreign or missing form is not found", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(EditFormPage({ params: Promise.resolve({ id: "missing" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
  });
});
