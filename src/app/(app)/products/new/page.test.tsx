import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  prefFindUnique: vi.fn(),
  projectFindFirst: vi.fn(),
  membershipFindMany: vi.fn(),
  productFindMany: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: async () => ({ auth: { user: { id: "user-1" } }, vendor: await mocks.requireVendorManager() }) }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    userOnboardingPreference: { findUnique: mocks.prefFindUnique },
    salesProject: { findFirst: mocks.projectFindFirst },
    teamMembership: { findMany: mocks.membershipFindMany },
    product: { findMany: mocks.productFindMany },
  }),
}));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header> }));
vi.mock("@/components/product-form", () => ({
  ProductForm: ({ projectId }: { projectId?: string | null }) => <div data-testid="product-form">{JSON.stringify({ projectId })}</div>,
}));

import NewProductPage from "./page";

const scopedPreference = { selectedProjectId: "project-1", selectedProject: { id: "project-1", name: "原型食物", status: "active" } };
const projectLookup = (id: string) => ({ where: { id, vendorId: "vendor-1", status: { not: "archived" } }, select: { id: true } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.prefFindUnique.mockResolvedValue(null);
  mocks.projectFindFirst.mockResolvedValue(null);
  mocks.membershipFindMany.mockResolvedValue([]);
  mocks.productFindMany.mockResolvedValue([]);
});

describe("/products/new route", () => {
  it("defaults to the scoped workspace project and says where the product will be created", async () => {
    mocks.prefFindUnique.mockResolvedValue(scopedPreference);
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1" });
    const html = renderToStaticMarkup(await NewProductPage({}));
    expect(mocks.projectFindFirst).toHaveBeenCalledWith(projectLookup("project-1"));
    expect(html).toContain("project-1");
    expect(html).toContain("將建立於專案：原型食物");
    expect(html).not.toContain("全部專案總覽");
  });

  it("leaves the product unattached in the aggregate overview and shows the notice", async () => {
    mocks.prefFindUnique.mockResolvedValue({ selectedProjectId: null, selectedProject: null });
    const html = renderToStaticMarkup(await NewProductPage({}));
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
    expect(html).toContain("全部專案總覽");
    expect(html).not.toContain("將建立於專案");
  });

  it("rejects a foreign or archived projectId after binding the lookup to the current vendor", async () => {
    mocks.projectFindFirst.mockResolvedValue(null);
    await expect(NewProductPage({ searchParams: Promise.resolve({ projectId: "foreign-project" }) })).rejects.toThrow("404");
    expect(mocks.projectFindFirst).toHaveBeenCalledWith(projectLookup("foreign-project"));
    expect(mocks.prefFindUnique).not.toHaveBeenCalled();
  });

  it("rejects a scoped default that is no longer available to the vendor", async () => {
    mocks.prefFindUnique.mockResolvedValue(scopedPreference);
    mocks.projectFindFirst.mockResolvedValue(null);
    await expect(NewProductPage({})).rejects.toThrow("404");
  });
});
