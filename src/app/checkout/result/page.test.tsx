import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getDb: vi.fn(),
  resolveBuyerSupportGrants: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/buyer-support-access", () => ({ resolveBuyerSupportGrants: mocks.resolveBuyerSupportGrants }));

import { paymentReturnOutcome } from "@/lib/payment-return-outcome";

import PaymentResultPage from "./page";

function findElementByHref(node: ReactNode, href: string): ReactElement<{ children?: ReactNode; href?: string }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByHref(child, href);
      if (match) return match;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode; href?: string }>(node)) return null;
  if (node.props.href === href) return node;
  return findElementByHref(node.props.children, href);
}

function grant(status = "paid", createdAt = new Date("2026-08-08T00:00:00.000Z")) {
  return {
    id: `grant-${status}`,
    order: {
      vendorId: "vendor-1",
      createdAt,
      status,
      orderNumber: "CD-SAFE-001",
      buyerMaskedEmail: "b***@example.test",
      totalAmountCents: 120000,
      refundedAmountCents: 0,
      currency: "TWD",
      vendor: { name: "合成測試商家" },
      items: [{ productId: "product-1" }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.getDb.mockReturnValue({ buyerSupportOrderGrant: {} });
  mocks.resolveBuyerSupportGrants.mockResolvedValue([grant()]);
});

describe("payment result page", () => {
  it("shows the verified callback notice and actual order state without raw identifiers", async () => {
    const html = renderToStaticMarkup(await PaymentResultPage({ searchParams: Promise.resolve({ payment: "updated" }) }));

    expect(html).toContain("已收到付款結果");
    expect(html).toContain("付款完成");
    expect(html).toContain("CD-SAFE-001");
    expect(html).toContain("b***@example.test");
    expect(html).toContain('href="/support/requests"');
    expect(html).toContain('href="/support/orders/grant-paid"');
    expect(html).toContain("查看商品與履約進度");
    expect(html).toContain("text-blue-700");
    expect(html).toContain("underline-offset-2");
    expect(html).not.toContain(">grant-paid<");
  });

  it("keeps a delayed callback neutral and shows the persisted pending order state", async () => {
    mocks.resolveBuyerSupportGrants.mockResolvedValue([grant("pending_payment")]);

    const html = renderToStaticMarkup(await PaymentResultPage({ searchParams: Promise.resolve({ payment: "pending" }) }));

    expect(html).toContain("付款結果仍在確認");
    expect(html).toContain("等待付款確認");
    expect(html).toContain("請稍後重新整理");
    expect(html).not.toContain("付款完成");
    expect(html).not.toContain("重新嘗試付款");
  });

  it.each(["payment_failed", "expired"])("offers a server-derived fresh checkout path for %s without retrying the old transaction", async (status) => {
    mocks.resolveBuyerSupportGrants.mockResolvedValue([grant(status)]);

    const page = await PaymentResultPage({ searchParams: Promise.resolve({ payment: "updated" }) });
    const retryCta = findElementByHref(page, "/checkout/vendor-1/product-1");
    const supportLink = findElementByHref(page, "/support/requests");
    const html = renderToStaticMarkup(page);

    expect(html).toContain('href="/checkout/vendor-1/product-1"');
    expect(retryCta?.type, "payment retry must use a native anchor for hard navigation").toBe("a");
    expect(supportLink?.type, "non-checkout navigation must remain a Next Link").not.toBe("a");
    expect(html).toContain("回到商品重新嘗試付款");
    expect(html).toContain("建立新的安全付款嘗試");
    expect(html).toContain("不會直接重送舊交易");
  });

  it.each(["paid", "pending_payment", "partially_refunded", "refunded", "cancelled"])("does not offer duplicate payment for %s", async (status) => {
    mocks.resolveBuyerSupportGrants.mockResolvedValue([grant(status)]);

    const html = renderToStaticMarkup(await PaymentResultPage({ searchParams: Promise.resolve({ payment: "updated" }) }));

    expect(html).not.toContain("重新嘗試付款");
    expect(html).not.toContain('href="/checkout/vendor-1/product-1"');
  });

  it("fails safely for an unknown outcome or a browser without an order capability", async () => {
    mocks.resolveBuyerSupportGrants.mockResolvedValue([]);

    const html = renderToStaticMarkup(await PaymentResultPage({ searchParams: Promise.resolve({ payment: "private-marker" }) }));

    expect(paymentReturnOutcome("private-marker")).toBe("unknown");
    expect(html).toContain("查看訂單付款狀態");
    expect(html).toContain("目前瀏覽器找不到可顯示的訂單");
    expect(html).toContain('href="/support"');
    expect(html).not.toContain("private-marker");
  });
});
