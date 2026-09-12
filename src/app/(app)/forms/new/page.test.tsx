import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input name="csrf" value="fixture" readOnly /> }));
vi.mock("@/components/fixed-registration-form-builder", () => ({ FixedRegistrationFormBuilder: ({ csrfField }: { csrfField: React.ReactNode }) => <div data-testid="fixed-form">{csrfField}</div> }));
import NewFormPage from "./page";
beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); });
describe("/forms/new fixed form", () => {
  it("requires a manager and provides CSRF to the fixed form", async () => {
    const html = renderToStaticMarkup(await NewFormPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(html).toContain("fixed-form");
    expect(html).toContain('name="csrf"');
    expect(html).toContain("固定欄位");
  });
  it("does not render when authorization fails", async () => {
    mocks.requireVendorManager.mockRejectedValue(new Error("unauthorized"));
    await expect(NewFormPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("unauthorized");
  });
});
