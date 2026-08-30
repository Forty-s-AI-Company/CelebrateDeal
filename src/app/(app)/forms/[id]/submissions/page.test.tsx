import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }), requireVendorManager: vi.fn(), loadResult: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/form-submission-search", () => ({ loadFormSubmissionSearchResult: mocks.loadResult }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input name="csrf" value="safe" readOnly /> }));
vi.mock("@/components/form-submissions-workbench", () => ({ FormSubmissionsWorkbench: ({ initialState, csrfField }: { initialState: { result: { totalItems: number } }; csrfField: ReactNode }) => <section data-count={initialState.result.totalItems}>{csrfField}名單工作區</section> }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));

import FormSubmissionsPage from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); mocks.loadResult.mockResolvedValue({ form: { id: "form-1", name: "活動報名" }, criteria: { formId: "form-1", query: "", verification: "ALL", source: "ALL", page: 1 }, items: [], totalItems: 12, page: 1, totalPages: 1, pageSize: 25 }); });

describe("/forms/[id]/submissions route", () => {
  it("loads the first bounded page and hands it to the private search workbench", async () => {
    const html = renderToStaticMarkup(await FormSubmissionsPage({ params: Promise.resolve({ id: "form-1" }) }));
    expect(mocks.loadResult).toHaveBeenCalledWith("vendor-1", { formId: "form-1", query: "", verification: "ALL", source: "ALL", page: 1 });
    expect(html).toContain("活動報名 名單"); expect(html).toContain("查找、篩選並分頁管理"); expect(html).toContain("名單工作區"); expect(html).toContain("data-count=\"12\""); expect(html).toContain("name=\"csrf\"");
  });

  it("fails closed when the form is not visible to the vendor", async () => {
    mocks.loadResult.mockResolvedValue(null);
    await expect(FormSubmissionsPage({ params: Promise.resolve({ id: "missing" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
  });
});
