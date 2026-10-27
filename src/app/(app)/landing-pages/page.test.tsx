import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ manager: vi.fn(), list: vi.fn(), projects: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.manager }));
vi.mock("@/lib/landing-page-service", () => ({ listLandingPages: mocks.list }));
vi.mock("@/lib/sales-project-scope", () => ({ listSelectableSalesProjects: mocks.projects }));
vi.mock("@/app/actions/sales-workspace-actions", () => ({ selectSalesProjectAction: vi.fn() }));
vi.mock("@/components/landing-pages/funnel-list", () => ({ FunnelList: ({ readOnly }: { readOnly?: boolean }) => <div data-funnel-list={readOnly ? "read-only" : "editable"} /> }));
import LandingPagesPage from "./page";

const aggregate = { projectId: null, projectName: null, isAggregate: true, isLegacyWorkspace: false };
const selected = { projectId: "project-1", projectName: "秋季課程", isAggregate: false, isLegacyWorkspace: false };
const page = { id: "lp-1", name: "網站", slug: "site", status: "draft", revision: 1, publishedAt: null, updatedAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manager.mockResolvedValue({ id: "vendor-1" });
});

describe("/landing-pages project guidance", () => {
  it("in the aggregate overview explains that sites belong to a project and lists projects to switch to", async () => {
    mocks.list.mockResolvedValue({ pages: [], scope: aggregate });
    mocks.projects.mockResolvedValue([{ id: "project-1", name: "秋季課程" }]);
    const html = renderToStaticMarkup(await LandingPagesPage());
    expect(mocks.projects).toHaveBeenCalledWith("vendor-1");
    expect(html).toContain("一頁式網站屬於銷售專案，請先選擇專案");
    expect(html).toContain("切換到「秋季課程」");
    expect(html).not.toContain('href="/landing-pages/new"');
    expect(html).not.toContain("開始建立第一個一頁式網站");
    expect(html).toContain('href="/landing-pages/templates"');
  });

  it("keeps existing sites read-only in the overview, with the guidance above them", async () => {
    mocks.list.mockResolvedValue({ pages: [page], scope: aggregate });
    mocks.projects.mockResolvedValue([{ id: "project-1", name: "秋季課程" }]);
    const html = renderToStaticMarkup(await LandingPagesPage());
    expect(html).toContain('data-funnel-list="read-only"');
    expect(html).toContain("請先選擇專案");
  });

  it("offers to create a sales project when the vendor has none", async () => {
    mocks.list.mockResolvedValue({ pages: [], scope: { ...aggregate, isAggregate: false, isLegacyWorkspace: true } });
    mocks.projects.mockResolvedValue([]);
    const html = renderToStaticMarkup(await LandingPagesPage());
    expect(html).toContain('href="/projects/new"');
    expect(html).toContain("建立銷售專案");
    expect(html).not.toContain('href="/landing-pages/new"');
  });

  it("with a selected project shows the create actions and no guidance", async () => {
    mocks.list.mockResolvedValue({ pages: [], scope: selected });
    const html = renderToStaticMarkup(await LandingPagesPage());
    expect(mocks.projects).not.toHaveBeenCalled();
    expect(html).not.toContain("請先選擇專案");
    expect(html).toContain('href="/landing-pages/new"');
    expect(html).toContain("開始建立第一個一頁式網站");
  });
});
