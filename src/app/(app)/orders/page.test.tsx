import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManagerMfa: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerMfa: mocks.requireVendorManagerMfa }));
vi.mock("@/lib/sales-project-scope", () => ({ getSalesProjectScope: vi.fn().mockResolvedValue({ projectId: null, projectName: null, isAggregate: false, isLegacyWorkspace: true }), salesScopeDescription: () => "目前資料範圍：商家" }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ commerceOrder: { findMany: mocks.findMany } }) }));

import OrdersPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManagerMfa.mockResolvedValue({ user: { id: "user-1" }, vendor: { id: "vendor-1", name: "商家" } });
  mocks.findMany.mockResolvedValue([]);
});

describe("/orders product filter", () => {
  it("keeps the product filter tenant-scoped and within canonical order items", async () => {
    await OrdersPage({ searchParams: Promise.resolve({ productId: "product-1", status: "paid" }) });
    expect(mocks.requireVendorManagerMfa).toHaveBeenCalledWith("/orders");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", status: "paid", items: { some: { productId: "product-1" } } } }));
  });

  it("drops malformed product identifiers", async () => {
    await OrdersPage({ searchParams: Promise.resolve({ productId: "../../other" }) });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ vendorId: "vendor-1" });
  });
});
