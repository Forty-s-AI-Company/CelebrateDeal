import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getDb: vi.fn(),
  resolveBuyerSupportGrants: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/buyer-support-access", () => ({ resolveBuyerSupportGrants: mocks.resolveBuyerSupportGrants }));

import BuyerOrdersPage from "./page";

function grant() {
  return {
    id: "grant-private-1",
    order: {
      createdAt: new Date("2026-08-09T12:00:00.000Z"),
      status: "partially_refunded",
      orderNumber: "CD-SAFE-002",
      buyerMaskedEmail: "b***@example.test",
      totalAmountCents: 168000,
      refundedAmountCents: 20000,
      currency: "TWD",
      vendor: { name: "合成測試商家" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.getDb.mockReturnValue({ buyerSupportOrderGrant: {} });
  mocks.resolveBuyerSupportGrants.mockResolvedValue([grant()]);
});

describe("buyer orders page", () => {
  it("lists only capability-backed order summaries and links to the scoped detail", async () => {
    const html = renderToStaticMarkup(await BuyerOrdersPage());

    expect(html).toContain("我的訂單");
    expect(html).toContain("CD-SAFE-002");
    expect(html).toContain("部分退款");
    expect(html).toContain('href="/support/orders/grant-private-1"');
    expect(html).toContain('href="/support/requests"');
    expect(html).not.toContain("buyerEncryptedEnvelope");
  });

  it("fails safely when the browser has no order capability", async () => {
    mocks.resolveBuyerSupportGrants.mockResolvedValue([]);

    const html = renderToStaticMarkup(await BuyerOrdersPage());

    expect(html).toContain("找不到可查看的訂單");
    expect(html).toContain("不接受訂單編號或 Email 猜測查詢");
    expect(html).toContain('href="/support"');
  });
});
