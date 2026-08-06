import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  findUnique: vi.fn(),
  getPaymentProvider: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
  reconcilePayUniRefund: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ paymentTransaction: { findUnique: mocks.findUnique } }) }));
vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/payment-providers/index", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/payment-providers/payuni-refund-reconciliation", () => ({ reconcilePayUniRefund: mocks.reconcilePayUniRefund }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: vi.fn() }));

import AdminBillingRefundReconciliationPage from "./page";

const transaction = {
  id: "transaction-1",
  providerName: "payuni",
  providerTradeNo: "trade-synthetic",
  orderNumber: "ORDER-SYNTHETIC",
  grossAmountCents: 20000,
  refundedAmountCents: 5000,
  refundedAt: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  status: "partially_refunded",
  vendor: { name: "測試商家" },
  refunds: [{ id: "refund-1", refundAmountCents: 5000, status: "pending", createdAt: new Date("2026-08-02T00:00:00.000Z") }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-admin", role: "finance" } });
  mocks.findUnique.mockResolvedValue(transaction);
  mocks.getPaymentProvider.mockReturnValue({ queryPayment: vi.fn() });
});

describe("/admin/billing/refund-reconciliation/[id] route", () => {
  it("renders pending reservation details and the controlled Sandbox action", async () => {
    const html = renderToStaticMarkup(await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({ status: "reconciled" }),
    }));

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: transaction.id },
      include: {
        vendor: true,
        refunds: {
          where: { status: "pending" },
          orderBy: { createdAt: "asc" },
          select: { id: true, refundAmountCents: true, status: true, createdAt: true },
        },
      },
    });
    expect(html).toContain("PayUni 退款終態對帳");
    expect(html).toContain("已完成 PayUni Sandbox 退款對帳");
    expect(html).toContain("ORDER-SYNTHETIC");
    expect(html).toContain("執行 Sandbox 終態對帳");
    expect(html).toContain("$50 · 1 筆");
    expect(html).not.toContain("trade-synthetic");
  });

  it("renders terminal idempotency state without a reconcile button", async () => {
    mocks.findUnique.mockResolvedValue({
      ...transaction,
      status: "refunded",
      refundedAmountCents: transaction.grossAmountCents,
      refunds: [],
    });

    const html = renderToStaticMarkup(await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({ status: "already_reconciled" }),
    }));

    expect(html).toContain("此交易已完成退款對帳");
    expect(html).toContain("目前沒有可安全對帳的 pending reservation");
    expect(html).not.toContain("執行 Sandbox 終態對帳");
    expect(mocks.getPaymentProvider).not.toHaveBeenCalled();
  });

  it("fails closed through notFound when the transaction is missing", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: "missing-transaction" }),
    })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
