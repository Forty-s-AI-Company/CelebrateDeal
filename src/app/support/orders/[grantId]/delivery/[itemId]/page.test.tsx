import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getDb: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  resolveBuyerOrderItemDelivery: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/buyer-support-access", () => ({ resolveBuyerOrderItemDelivery: mocks.resolveBuyerOrderItemDelivery }));

import BuyerOrderItemDeliveryPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.getDb.mockReturnValue({ buyerSupportOrderGrant: {}, commerceOrderItem: {} });
  mocks.resolveBuyerOrderItemDelivery.mockResolvedValue({
    orderNumber: "CD-SAFE-003",
    productName: "數位課程",
    deliveryKind: "course_portal",
    title: "課程內容入口",
    destinationUrl: "https://courses.example.test/member/start",
    instructions: "先完成歡迎單元，再開始第一章。",
  });
});

describe("buyer order item delivery page", () => {
  it("renders only resolver-approved delivery behind a same-origin order route", async () => {
    const html = renderToStaticMarkup(await BuyerOrderItemDeliveryPage({
      params: Promise.resolve({ grantId: "grant-1", itemId: "item-1" }),
    }));

    expect(html).toContain("CD-SAFE-003");
    expect(html).toContain("課程內容入口");
    expect(html).toContain("先完成歡迎單元");
    expect(html).toContain('href="https://courses.example.test/member/start"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('/support/orders/grant-1');
  });

  it("returns not found when the grant, fulfillment, snapshot, or allowlist is unavailable", async () => {
    mocks.resolveBuyerOrderItemDelivery.mockResolvedValue(null);

    await expect(BuyerOrderItemDeliveryPage({
      params: Promise.resolve({ grantId: "foreign", itemId: "item-1" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
