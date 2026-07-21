import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  invoiceFindFirst: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ invoice: { findFirst: mocks.invoiceFindFirst } }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import InvoiceDetailPage from "./page";

const invoice = {
  id: "invoice-current",
  vendorId: "vendor-current",
  invoiceNumber: "INV-2026-07-001",
  monthKey: "2026-07",
  monthlyFeeCents: 10000,
  overflowFeeCents: 2500,
  paymentServiceFeeCents: 300,
  transactionServiceFeeCents: 400,
  affiliateManagementFeeCents: 500,
  subtotalCents: 13700,
  taxCents: 685,
  totalCents: 14385,
  status: "paid",
  dueAt: new Date("2026-07-10T00:00:00.000Z"),
  paidAt: new Date("2026-07-08T00:00:00.000Z"),
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  providerTradeNo: "must-not-render",
  HashInfo: "must-not-render",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue({ id: "vendor-current", name: "賀成交測試商店" });
  mocks.invoiceFindFirst.mockResolvedValue(invoice);
});

describe("/billing/invoices/[invoiceId] route", () => {
  it("loads a tenant-scoped paid invoice and renders a printable receipt", async () => {
    const html = renderToStaticMarkup(await InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: invoice.id }),
    }));

    expect(mocks.requireVendor).toHaveBeenCalledOnce();
    expect(mocks.invoiceFindFirst).toHaveBeenCalledWith({
      where: { id: invoice.id, vendorId: "vendor-current" },
    });
    expect(html).toContain("付款收據");
    expect(html).toContain("已付款");
    expect(html).toContain("賀成交測試商店");
    expect(html).toContain(invoice.invoiceNumber);
    expect(html).toContain("平台月費");
    expect(html).toContain("超額用量費");
    expect(html).toContain("金流服務費");
    expect(html).toContain("交易服務費");
    expect(html).toContain("聯盟結算管理費");
    expect(html).toContain("小計");
    expect(html).toContain("稅額");
    expect(html).toContain("總額");
    expect(html).toContain("列印／另存 PDF");
    expect(html).toContain('href="/billing/invoices"');
    expect(html).toContain("不是財政部電子發票");
    expect(html).not.toContain("must-not-render");
  });

  it.each([
    ["issued", "帳單明細", "待付款"],
    ["overdue", "帳單明細", "已逾期"],
    ["draft", "帳單明細", "草稿"],
  ])("localizes the %s state without calling it a paid receipt", async (status, title, label) => {
    mocks.invoiceFindFirst.mockResolvedValue({ ...invoice, status, paidAt: null });

    const html = renderToStaticMarkup(await InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: invoice.id }),
    }));

    expect(html).toContain(title);
    expect(html).toContain(label);
    expect(html).toContain("尚未付款");
  });

  it("returns not found for a missing or cross-tenant invoice", async () => {
    mocks.invoiceFindFirst.mockResolvedValue(null);

    await expect(InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: "invoice-other-vendor" }),
    })).rejects.toThrow("not-found");

    expect(mocks.invoiceFindFirst).toHaveBeenCalledWith({
      where: { id: "invoice-other-vendor", vendorId: "vendor-current" },
    });
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("rejects an invalid oversized invoice identifier before querying", async () => {
    await expect(InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: "x".repeat(65) }),
    })).rejects.toThrow("not-found");

    expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
  });
});
