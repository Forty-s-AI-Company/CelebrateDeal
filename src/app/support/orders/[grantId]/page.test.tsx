import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getDb: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  resolveBuyerOrderDetail: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/buyer-support-access", () => ({ resolveBuyerOrderDetail: mocks.resolveBuyerOrderDetail }));

import BuyerOrderDetailPage from "./page";

function order() {
  return {
    id: "order-private-1", vendorId: "vendor-private-1", orderNumber: "CD-SAFE-003", status: "paid", currency: "TWD",
    subtotalAmountCents: 220000, totalAmountCents: 220000, paidAmountCents: 220000, refundedAmountCents: 0,
    buyerMaskedName: "王＊明", buyerMaskedEmail: "b***@example.test", buyerMaskedPhone: "09＊＊＊1234",
    shippingMaskedSummary: "台北市＊＊區", paidAt: new Date("2026-08-09T12:05:00.000Z"), failedAt: null, refundedAt: null,
    createdAt: new Date("2026-08-09T12:00:00.000Z"), updatedAt: new Date("2026-08-09T12:05:00.000Z"),
    vendor: { name: "合成測試商家" },
    items: [
      {
        id: "item-physical", productName: "實體教材", fulfillmentType: "physical", unitPriceCents: 100000,
        quantity: 1, lineTotalCents: 100000, imageUrl: null,
        shippingFulfillment: {
          status: "shipped", carrierName: "安全物流", packingAt: null,
          shippedAt: new Date("2026-08-09T13:00:00.000Z"), deliveredAt: null,
          returnedAt: null, cancelledAt: null, updatedAt: new Date("2026-08-09T13:00:00.000Z"),
        },
        entitlement: null, serviceFulfillment: null, deliverySnapshot: null,
      },
      {
        id: "item-digital", productName: "數位課程", fulfillmentType: "course", unitPriceCents: 120000,
        quantity: 1, lineTotalCents: 120000, imageUrl: null, shippingFulfillment: null,
        entitlement: {
          status: "granted", grantedAt: new Date("2026-08-09T12:06:00.000Z"),
          expiresAt: null, revokedAt: null, updatedAt: new Date("2026-08-09T12:06:00.000Z"),
        },
        serviceFulfillment: null,
        deliverySnapshot: {
          id: "snapshot-safe", deliveryKind: "course_portal", title: "課程內容入口",
          destinationMaskedSummary: "安全 HTTPS 入口 · courses.example.test",
          instructionsMaskedSummary: "已設定 8 字交付說明", revokedAt: null,
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.getDb.mockReturnValue({ buyerSupportOrderGrant: {}, commerceOrder: {} });
  mocks.resolveBuyerOrderDetail.mockResolvedValue(order());
});

describe("buyer order detail page", () => {
  it("shows safe payment and fulfillment projections without internal secrets", async () => {
    const html = renderToStaticMarkup(await BuyerOrderDetailPage({ params: Promise.resolve({ grantId: "grant-1" }) }));

    expect(html).toContain("CD-SAFE-003");
    expect(html).toContain('class="min-w-0 max-w-full"');
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("台北市＊＊區");
    expect(html).toContain("實體教材");
    expect(html).toContain("已出貨");
    expect(html).toContain("安全物流");
    expect(html).toContain("數位課程");
    expect(html).toContain("已開通");
    expect(html).toContain("開啟付款後內容");
    expect(html).toContain('/support/orders/grant-1/delivery/item-digital');
    expect(html).toContain("安全 HTTPS 入口 · courses.example.test");
    expect(html).toContain("本頁不顯示完整地址、物流單號");
    expect(html).toContain('class="mt-4 text-xs leading-5 text-slate-600"');
    expect(html).not.toContain('class="mt-4 text-xs leading-5 text-slate-500"');
    for (const forbidden of ["order-private-1", "vendor-private-1", "accessEncryptedEnvelope", "grantSecret", "tracking-private", "payment-private"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("shows an honest support fallback for a paid legacy order without a delivery snapshot", async () => {
    const legacyOrder = order();
    legacyOrder.items[1].deliverySnapshot = null;
    mocks.resolveBuyerOrderDetail.mockResolvedValue(legacyOrder);

    const html = renderToStaticMarkup(await BuyerOrderDetailPage({ params: Promise.resolve({ grantId: "grant-1" }) }));
    expect(html).toContain("這筆舊訂單沒有保存付款後交付內容");
    expect(html).not.toContain('/support/orders/grant-1/delivery/item-digital');
  });

  it("returns not found for a foreign or expired grant", async () => {
    mocks.resolveBuyerOrderDetail.mockResolvedValue(null);

    await expect(BuyerOrderDetailPage({ params: Promise.resolve({ grantId: "foreign-grant" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
