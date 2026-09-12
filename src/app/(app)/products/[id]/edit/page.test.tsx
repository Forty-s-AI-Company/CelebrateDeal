import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  requireVendorManagerContext: vi.fn(),
  getSalesProjectScope: vi.fn(),
  productFindFirst: vi.fn(),
  membershipFindMany: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.requireVendorManagerContext }));
vi.mock("@/lib/sales-project-scope", () => ({ getSalesProjectScope: mocks.getSalesProjectScope }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  product: { findFirst: mocks.productFindFirst },
  teamMembership: { findMany: mocks.membershipFindMany },
}) }));
vi.mock("@/components/product-form", () => ({ ProductForm: () => <div /> }));
vi.mock("@/components/ui", () => ({ PageHeader: () => <header />, ButtonLink: () => <a /> }));

import EditProductPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManagerContext.mockResolvedValue({ auth: { user: { id: "user-1" } }, vendor: { id: "vendor-1" } });
  mocks.getSalesProjectScope.mockResolvedValue({ projectId: "project-1", projectName: "專案一", isAggregate: false, isLegacyWorkspace: false });
  mocks.productFindFirst.mockResolvedValue({ id: "product-1" });
  mocks.membershipFindMany.mockResolvedValue([]);
});

describe("/products/[id]/edit project boundary", () => {
  it("requires the selected project relation on a direct edit URL", async () => {
    await EditProductPage({ params: Promise.resolve({ id: "product-1" }), searchParams: Promise.resolve({}) });
    expect(mocks.productFindFirst).toHaveBeenCalledWith({
      where: { id: "product-1", vendorId: "vendor-1", salesProjectLinks: { some: { projectId: "project-1" } } },
      include: { deliveryConfig: true },
    });
  });

  it("rejects aggregate editing before loading editable data", async () => {
    mocks.getSalesProjectScope.mockResolvedValue({ projectId: null, projectName: null, isAggregate: true, isLegacyWorkspace: false });
    await expect(EditProductPage({ params: Promise.resolve({ id: "product-1" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.productFindFirst).not.toHaveBeenCalled();
    expect(mocks.membershipFindMany).not.toHaveBeenCalled();
  });
});
