import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock("@/components/form-builder", () => ({ FormBuilder: ({ error }: { error?: string }) => <div data-testid="form-builder">{error ?? "no-error"}</div> }));

import NewFormPage from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); });

describe("/forms/new route", () => {
  it("requires vendor manager and forwards validation errors", async () => {
    const html = renderToStaticMarkup(await NewFormPage({ searchParams: Promise.resolve({ error: "invalid_fields" }) }));
    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith(); expect(html).toContain("新增報名表"); expect(html).toContain("invalid_fields");
  });

  it("keeps a clean builder state when no error is supplied", async () => {
    const html = renderToStaticMarkup(await NewFormPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("新增報名表"); expect(html).toContain("no-error");
  });
});
