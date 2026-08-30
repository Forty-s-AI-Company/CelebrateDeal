import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorFinance: vi.fn(),
  invoiceFindFirst: vi.fn(),
  paymentTransactionFindFirst: vi.fn(),
  getCsrfToken: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    invoice: { findFirst: mocks.invoiceFindFirst },
    paymentTransaction: { findFirst: mocks.paymentTransactionFindFirst },
  }),
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
  mocks.requireVendorFinance.mockResolvedValue({
    vendor: { id: "vendor-current", name: "賀成交測試商店" },
  });
  mocks.invoiceFindFirst.mockResolvedValue(invoice);
  mocks.paymentTransactionFindFirst.mockResolvedValue(null);
  mocks.getCsrfToken.mockResolvedValue("test-csrf-token");
});

describe("/billing/invoices/[invoiceId] route", () => {
  it("loads a tenant-scoped paid invoice and renders a printable receipt", async () => {
    const html = renderToStaticMarkup(await InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: invoice.id }),
    }));

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/billing/invoices");
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

  it("renders only a tenant-scoped, allowlisted provider checkout snapshot", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({ ...invoice, status: "issued", paidAt: null });
    mocks.paymentTransactionFindFirst.mockResolvedValue({
      id: "transaction-invoice-checkout",
      metadata: {
        billingPurpose: "invoice_payment",
        invoiceId: invoice.id,
        checkoutSession: {
          provider: "payuni",
          mode: "form_post",
          formAction: "https://sandbox-api.payuni.com.tw/api/upp",
          formPayload: {
            MerID: "synthetic-merchant",
            Version: "2.0",
            EncryptInfo: "synthetic-encrypted",
            HashInfo: "synthetic-hash",
          },
          nextAction: "submit_payuni_upp_form",
        },
      },
    });

    const html = renderToStaticMarkup(await InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: invoice.id }),
      searchParams: Promise.resolve({ status: "checkout", transactionId: "transaction-invoice-checkout" }),
    }));

    expect(mocks.paymentTransactionFindFirst).toHaveBeenCalledWith({
      where: {
        id: "transaction-invoice-checkout",
        vendorId: "vendor-current",
        paymentMode: "platform",
        status: "pending",
      },
      select: { id: true, metadata: true },
    });
    expect(html).toContain("前往安全付款頁");
    expect(html).toContain('action="https://sandbox-api.payuni.com.tw/api/upp"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-disabled="false"');
    expect(html).toContain('name="MerID" value="synthetic-merchant"');
    expect(html).not.toContain("providerTradeNo");
  });

  it("fails closed when redirect checkout metadata contains a non-allowlisted URL", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({ ...invoice, status: "issued", paidAt: null });
    mocks.paymentTransactionFindFirst.mockResolvedValue({
      id: "transaction-unsafe-redirect",
      metadata: {
        billingPurpose: "invoice_payment",
        invoiceId: invoice.id,
        checkoutSession: {
          provider: "payuni",
          mode: "redirect",
          checkoutUrl: "javascript:alert(1)",
          nextAction: "redirect_to_provider",
        },
      },
    });

    const html = renderToStaticMarkup(await InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: invoice.id }),
      searchParams: Promise.resolve({ status: "checkout", transactionId: "transaction-unsafe-redirect" }),
    }));

    expect(html).not.toContain("javascript:alert(1)");
    expect(html).not.toContain("前往安全付款頁");
  });

  it("does not expose a stale pending checkout after the invoice is no longer payable", async () => {
    mocks.paymentTransactionFindFirst.mockResolvedValue({
      id: "transaction-stale-checkout",
      metadata: {
        billingPurpose: "invoice_payment",
        invoiceId: invoice.id,
        checkoutSession: {
          provider: "payuni",
          mode: "redirect",
          checkoutUrl: "https://sandbox-api.payuni.com.tw/api/upp",
          nextAction: "redirect_to_provider",
        },
      },
    });

    const html = renderToStaticMarkup(await InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: invoice.id }),
      searchParams: Promise.resolve({ status: "checkout", transactionId: "transaction-stale-checkout" }),
    }));

    expect(mocks.paymentTransactionFindFirst).not.toHaveBeenCalled();
    expect(html).not.toContain("前往安全付款頁");
    expect(html).not.toContain("付款交易已建立");
  });

  it("does not trust a paid query parameter when the invoice is still unpaid", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({ ...invoice, status: "issued", paidAt: null });

    const html = renderToStaticMarkup(await InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: invoice.id }),
      searchParams: Promise.resolve({ status: "paid" }),
    }));

    expect(html).toContain("待付款");
    expect(html).not.toContain("已收到付款通知");
  });

  it("fails closed in the checkout-in-progress state without offering a duplicate checkout", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({ ...invoice, status: "issued", paidAt: null });

    const html = renderToStaticMarkup(await InvoiceDetailPage({
      params: Promise.resolve({ invoiceId: invoice.id }),
      searchParams: Promise.resolve({ error: "checkout_in_progress" }),
    }));

    expect(html).toContain("系統已避免重複建立交易");
    expect(html).not.toContain("建立付款交易");
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
