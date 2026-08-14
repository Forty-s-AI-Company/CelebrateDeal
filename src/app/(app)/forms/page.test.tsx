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

beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); mocks.findMany.mockResolvedValue([{ id: "form-1", name: "活動報名", slug: "summer", isActive: true, _count: { submissions: 2 } }, { id: "form-2", name: "停用表單", slug: "old", isActive: false, _count: { submissions: 0 } }]); mocks.groupBy.mockResolvedValue([{ formId: "form-1", _count: { _all: 1 } }]); });

describe("/forms route", () => {
  it("scopes forms to the vendor and renders active state and submission links", async () => {
    const html = renderToStaticMarkup(await FormsPage());
    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1" }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, slug: true, isActive: true, _count: { select: { submissions: true } } } });
    expect(mocks.groupBy).toHaveBeenCalledWith({ by: ["formId"], where: { formId: { in: ["form-1", "form-2"] }, form: { vendorId: "vendor-1" }, verificationStatus: "VERIFIED" }, _count: { _all: true } });
    expect(html).toContain("報名表管理"); expect(html).toContain("活動報名"); expect(html).toContain("/form/summer"); expect(html).toContain("啟用"); expect(html).toContain("1 已驗證 / 1 待驗證"); expect(html).toContain("/forms/form-1/submissions"); expect(html).toContain("停用");
  });

  it("renders an empty state when no forms exist", async () => {
    mocks.findMany.mockResolvedValue([]);
    const html = renderToStaticMarkup(await FormsPage());
    expect(mocks.groupBy).not.toHaveBeenCalled();
    expect(html).toContain("還沒有報名表"); expect(html).toContain("直播頁就能收集觀看者名單"); expect(html).toContain("/forms/new");
  });
});
