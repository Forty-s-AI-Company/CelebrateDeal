import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), videoFindMany: vi.fn(), prefFindUnique: vi.fn(), projectFindFirst: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager, requireVendorManagerContext: async () => ({ auth: { user: { id: "user-1" } }, vendor: await mocks.requireVendorManager() }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ video: { findMany: mocks.videoFindMany }, userOnboardingPreference: { findUnique: mocks.prefFindUnique }, salesProject: { findFirst: mocks.projectFindFirst } }) }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock("@/components/form-builder", () => ({ FormBuilder: ({ error, promoVideos, projectId }: { error?: string; projectId?: string | null; promoVideos: Array<{ id: string; title: string }> }) => <div data-testid="form-builder">{JSON.stringify({ error: error ?? "no-error", promoVideos, projectId })}</div> }));

import NewFormPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prefFindUnique.mockResolvedValue(null);
  mocks.projectFindFirst.mockResolvedValue(null);
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.videoFindMany.mockResolvedValue([{ id: "video-1", title: "宣傳影片" }]);
});

describe("/forms/new route", () => {
  it("requires vendor manager and forwards validation errors", async () => {
    const html = renderToStaticMarkup(await NewFormPage({ searchParams: Promise.resolve({ error: "invalid_fields" }) }));
    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.videoFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", status: "ready" },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });
    expect(html).toContain("新增報名表");
    expect(html).toContain("invalid_fields");
    expect(html).toContain("宣傳影片");
  });

  it("keeps a clean builder state when no error is supplied", async () => {
    const html = renderToStaticMarkup(await NewFormPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("新增報名表"); expect(html).toContain("no-error");
  });
  it("binds a new form to the scoped workspace project when no projectId is given", async () => {
    mocks.prefFindUnique.mockResolvedValue({ selectedProjectId: "project-1", selectedProject: { id: "project-1", name: "原型食物", status: "active" } });
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1" });
    const html = renderToStaticMarkup(await NewFormPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.projectFindFirst).toHaveBeenCalledWith({ where: { id: "project-1", vendorId: "vendor-1", status: { not: "archived" } }, select: { id: true } });
    expect(html).toContain("project-1");
    expect(html).not.toContain("全部專案總覽");
  });

  it("leaves the form unattached in the aggregate overview and shows a hint", async () => {
    mocks.prefFindUnique.mockResolvedValue({ selectedProjectId: null, selectedProject: null });
    const html = renderToStaticMarkup(await NewFormPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
    expect(html).toContain("全部專案總覽");
    expect(html).not.toContain("project-1");
  });

  it("rejects a foreign projectId", async () => {
    mocks.projectFindFirst.mockResolvedValue(null);
    await expect(NewFormPage({ searchParams: Promise.resolve({ projectId: "foreign-project" }) })).rejects.toThrow("404");
  });
});
