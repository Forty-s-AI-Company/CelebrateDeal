import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManagerMfa: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManagerMfa: mocks.requireVendorManagerMfa }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ commerceOrder: { findFirst: mocks.findFirst }, commerceOrderItem: { findMany: mocks.findMany } }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/commerce-order-detail", () => ({ CommerceOrderDetail: () => <div /> }));
vi.mock("@/components/ui", () => ({ PageHeader: () => <header /> }));

import OrderDetailPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManagerMfa.mockResolvedValue({ vendor: { id: "vendor-current" } });
  mocks.findFirst.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([]);
  mocks.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
});

describe("/orders/[id] tenant boundary", () => {
  it("queries by both order id and current vendor before rendering not-found", async () => {
    await expect(OrderDetailPage({
      params: Promise.resolve({ id: "order-foreign" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.requireVendorManagerMfa).toHaveBeenCalledExactlyOnceWith("/orders/order-foreign");
    expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { id: "order-foreign", vendorId: "vendor-current" },
    }));
    expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
  });
});
