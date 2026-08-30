import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() }));
vi.mock("lucide-react", () => ({ Plus: () => <span>plus</span> }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ registrationForm: { findMany: mocks.findMany }, formSubmission: { groupBy: mocks.groupBy } }) }));
vi.mock("@/components/ui", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ButtonLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  EmptyState: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <div data-testid="empty-state"><h2>{title}</h2><p>{description}</p>{action}</div>,
  PageHeader: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{action}</header>,
}));

import FormsPage from "./page";

type FormsSearchParams = { q?: string | string[]; status?: string | string[] };

async function renderFormsPage(searchParams: FormsSearchParams = {}) {
  return renderToStaticMarkup(await FormsPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); mocks.findMany.mockResolvedValue([{ id: "form-1", name: "活動報名", slug: "summer", isActive: true, _count: { submissions: 2 } }, { id: "form-2", name: "停用表單", slug: "old", isActive: false, _count: { submissions: 0 } }]); mocks.groupBy.mockResolvedValue([{ formId: "form-1", _count: { _all: 1 } }]); });

describe("/forms route", () => {
  it("scopes forms to the vendor and renders active state and submission links", async () => {
    const html = await renderFormsPage();
    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1" }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, slug: true, isActive: true, _count: { select: { submissions: true } } } });
    expect(mocks.groupBy).toHaveBeenCalledWith({ by: ["formId"], where: { formId: { in: ["form-1", "form-2"] }, form: { vendorId: "vendor-1" }, verificationStatus: "VERIFIED" }, _count: { _all: true } });
    expect(html).toContain("報名表管理"); expect(html).toContain("活動報名"); expect(html).toContain("/form/summer"); expect(html).toContain("啟用"); expect(html).toContain("1 已驗證 / 1 待驗證"); expect(html).toContain("/forms/form-1/submissions"); expect(html).toContain("停用"); expect(html).toContain("搜尋表單"); expect(html).toContain("預覽報名頁"); expect(html).toContain("target=\"_blank\""); expect(html).toContain("rel=\"noopener noreferrer\""); expect(html).toContain("公開預覽不可用");
  });

  it("renders an empty state when no forms exist", async () => {
    mocks.findMany.mockResolvedValue([]);
    const html = await renderFormsPage();
    expect(mocks.groupBy).not.toHaveBeenCalled();
    expect(html).toContain("還沒有報名表"); expect(html).toContain("直播頁就能收集觀看者名單"); expect(html).toContain("/forms/new");
  });

  it("builds a case-insensitive name and slug query with an active status filter", async () => {
    await renderFormsPage({ q: "  夏季活動  ", status: "active" });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        vendorId: "vendor-1",
        OR: [
          { name: { contains: "夏季活動", mode: "insensitive" } },
          { slug: { contains: "夏季活動", mode: "insensitive" } },
        ],
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }));
  });

  it("maps inactive status and keeps the query within the vendor scope", async () => {
    await renderFormsPage({ q: "legacy", status: "inactive" });
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        vendorId: "vendor-1",
        OR: [
          { name: { contains: "legacy", mode: "insensitive" } },
          { slug: { contains: "legacy", mode: "insensitive" } },
        ],
        isActive: false,
      },
    });
  });

  it("ignores array and unknown query values without creating an empty filter", async () => {
    await renderFormsPage({ q: ["first", "second"], status: ["active", "inactive"] });
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({ where: { vendorId: "vendor-1" } });
    expect(mocks.findMany.mock.calls[0][0].where).not.toHaveProperty("OR");
    expect(mocks.findMany.mock.calls[0][0].where).not.toHaveProperty("isActive");
  });

  it("trims and caps a single search value at 120 characters", async () => {
    const search = `  ${"x".repeat(140)}  `;
    await renderFormsPage({ q: search });
    expect(mocks.findMany.mock.calls[0][0].where.OR).toEqual([
      { name: { contains: "x".repeat(120), mode: "insensitive" } },
      { slug: { contains: "x".repeat(120), mode: "insensitive" } },
    ]);
  });

  it("does not add a search or status condition for whitespace and invalid status", async () => {
    const html = await renderFormsPage({ q: "   ", status: "deleted" });
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({ where: { vendorId: "vendor-1" } });
    expect(mocks.findMany.mock.calls[0][0].where).not.toHaveProperty("OR");
    expect(mocks.findMany.mock.calls[0][0].where).not.toHaveProperty("isActive");
    expect(html).not.toContain("清除篩選");
  });

  it("uses only the filtered form ids for verified submission counts", async () => {
    mocks.findMany.mockResolvedValue([{ id: "filtered-form", name: "篩選結果", slug: "filtered", isActive: true, _count: { submissions: 1 } }]);
    await renderFormsPage({ status: "active" });
    expect(mocks.groupBy).toHaveBeenCalledWith({ by: ["formId"], where: { formId: { in: ["filtered-form"] }, form: { vendorId: "vendor-1" }, verificationStatus: "VERIFIED" }, _count: { _all: true } });
  });

  it("renders a filtered empty state separately from the initial empty state", async () => {
    mocks.findMany.mockResolvedValue([]);
    const html = await renderFormsPage({ q: "不存在" });
    expect(mocks.groupBy).not.toHaveBeenCalled();
    expect(html).toContain("找不到符合條件的報名表");
    expect(html).toContain("請調整搜尋文字或狀態條件後再試");
    expect(html).toContain("清除篩選");
    expect(html).not.toContain("還沒有報名表");
  });

  it("encodes special slugs and adds safe new-tab preview attributes", async () => {
    mocks.findMany.mockResolvedValue([{ id: "form-special", name: "特殊網址", slug: "summer/event", isActive: true, _count: { submissions: 0 } }]);
    const html = await renderFormsPage();
    expect(html).toContain('href="/form/summer%2Fevent"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("does not expose a public preview anchor for inactive forms", async () => {
    mocks.findMany.mockResolvedValue([{ id: "form-inactive", name: "停用表單", slug: "disabled", isActive: false, _count: { submissions: 0 } }]);
    const html = await renderFormsPage();
    expect(html).toContain("公開預覽不可用");
    expect(html).not.toContain('href="/form/disabled"');
  });
});
