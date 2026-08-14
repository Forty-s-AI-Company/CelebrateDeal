import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  findUnique: vi.fn(),
  getPaymentProvider: vi.fn(),
  revalidatePath: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
  redirect: vi.fn(),
  reconcilePayUniRefund: vi.fn(),
}));
const formStatus = vi.hoisted(() => ({ pending: false }));

vi.mock("react-dom", async (importOriginal) => {
  const reactDom = await importOriginal<typeof import("react-dom")>();
  return {
    ...reactDom,
    useFormStatus: () => ({ pending: formStatus.pending }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ paymentTransaction: { findUnique: mocks.findUnique } }) }));
vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/payment-providers/index", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/payuni-refund-reconciliation", () => ({ reconcilePayUniRefund: mocks.reconcilePayUniRefund }));
vi.mock("@/lib/payment-providers/payuni-refund-reconciliation", () => ({ reconcilePayUniRefund: mocks.reconcilePayUniRefund }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));

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
  formStatus.pending = false;
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-admin", role: "finance" } });
  mocks.findUnique.mockResolvedValue(transaction);
  mocks.getPaymentProvider.mockReturnValue({ queryPayment: vi.fn() });
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`); });
});

function findFormAction(node: unknown): ((formData: FormData) => Promise<unknown>) | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const action = findFormAction(child);
      if (action) return action;
    }
    return null;
  }
  const element = node as { type?: unknown; props?: { action?: unknown; children?: unknown } };
  if (element.type === "form" && typeof element.props?.action === "function") {
    return element.props.action as (formData: FormData) => Promise<unknown>;
  }
  return findFormAction(element.props?.children);
}

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
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("ORDER-SYNTHETIC");
    expect(html).toContain("執行 Sandbox 終態對帳");
    expect(html).toContain("$50 · 1 筆");
    expect(html).not.toContain("trade-synthetic");
  });

  it("disables duplicate reconciliation and announces the provider query", async () => {
    formStatus.pending = true;

    const html = renderToStaticMarkup(await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain("查詢並核對中…");
    expect(html).toContain("正在查詢 PayUni Sandbox 並核對退款終態，請勿重複送出。");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });

  it("announces a failed reconciliation without implying a local ledger change", async () => {
    const html = renderToStaticMarkup(await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({ status: "error" }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("退款對帳未完成，系統未變更本機帳務");
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
      searchParams: Promise.resolve({ status: "nothing_pending" }),
    }));

    expect(html).toContain("目前沒有可執行的 pending reservation");
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

  it("does not render a PayUni action for an unsupported payment provider", async () => {
    mocks.findUnique.mockResolvedValue({ ...transaction, providerName: "stripe" });

    const html = renderToStaticMarkup(await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain("退款終態對帳不可用");
    expect(html).toContain("尚未支援的付款 provider");
    expect(html).not.toContain("執行 Sandbox 終態對帳");
    expect(mocks.getPaymentProvider).not.toHaveBeenCalled();
  });

  it("rejects a submitted form whose id does not match the rendered transaction", async () => {
    const element = await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({}),
    });
    const action = findFormAction(element);
    expect(action).toBeTypeOf("function");
    mocks.findUnique.mockClear();

    const formData = new FormData();
    formData.set("id", "other-transaction");
    await expect(action!(formData)).rejects.toThrow("redirect:/admin/billing/refund-reconciliation/transaction-1?status=error");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("stops without a provider query when the local transaction is already terminal", async () => {
    const element = await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({}),
    });
    const action = findFormAction(element);
    expect(action).toBeTypeOf("function");
    const providerQuery = vi.fn();
    mocks.getPaymentProvider.mockReturnValue({ queryPayment: providerQuery });
    mocks.findUnique.mockResolvedValue({
      ...transaction,
      status: "refunded",
      refundedAmountCents: transaction.grossAmountCents,
      refunds: [],
    });

    const formData = new FormData();
    formData.set("id", transaction.id);
    await expect(action!(formData)).rejects.toThrow("redirect:/admin/billing/refund-reconciliation/transaction-1?status=nothing_pending");
    expect(providerQuery).not.toHaveBeenCalled();
  });

  it("does not query PayUni for a partially refunded transaction with no pending reservation", async () => {
    const element = await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({}),
    });
    const action = findFormAction(element);
    expect(action).toBeTypeOf("function");
    const providerQuery = vi.fn();
    mocks.getPaymentProvider.mockReturnValue({ queryPayment: providerQuery });
    mocks.findUnique.mockResolvedValue({
      ...transaction,
      status: "partially_refunded",
      refunds: [],
    });

    const formData = new FormData();
    formData.set("id", transaction.id);
    await expect(action!(formData)).rejects.toThrow("redirect:/admin/billing/refund-reconciliation/transaction-1?status=nothing_pending");
    expect(providerQuery).not.toHaveBeenCalled();
  });

  it("queries PayUni once and reconciles the local reservation on success", async () => {
    const element = await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({}),
    });
    const action = findFormAction(element);
    expect(action).toBeTypeOf("function");
    const providerQuery = vi.fn().mockResolvedValue({
      providerTradeNo: transaction.providerTradeNo,
      orderNumber: transaction.orderNumber,
      grossAmountCents: transaction.grossAmountCents,
      refundedAmountCents: transaction.grossAmountCents,
      status: "refunded",
    });
    mocks.getPaymentProvider.mockReturnValue({ queryPayment: providerQuery });
    mocks.reconcilePayUniRefund.mockResolvedValue({ disposition: "reconciled" });
    mocks.findUnique.mockResolvedValue(transaction);

    const formData = new FormData();
    formData.set("id", transaction.id);
    await expect(action!(formData)).rejects.toThrow("redirect:/admin/billing/refund-reconciliation/transaction-1?status=reconciled");
    expect(providerQuery).toHaveBeenCalledExactlyOnceWith({ transaction });
    expect(mocks.reconcilePayUniRefund).toHaveBeenCalledWith({
      db: expect.any(Object),
      transactionId: transaction.id,
      providerSnapshot: expect.objectContaining({ status: "refunded" }),
      actor: { id: "finance-admin", label: "finance" },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/billing/refund-reconciliation/${transaction.id}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/billing/dashboard");
  });

  it("converts provider query failures into the safe error redirect", async () => {
    const element = await AdminBillingRefundReconciliationPage({
      params: Promise.resolve({ id: transaction.id }),
      searchParams: Promise.resolve({}),
    });
    const action = findFormAction(element);
    expect(action).toBeTypeOf("function");
    mocks.getPaymentProvider.mockReturnValue({ queryPayment: vi.fn().mockRejectedValue(new Error("provider failure")) });
    mocks.findUnique.mockResolvedValue(transaction);

    const formData = new FormData();
    formData.set("id", transaction.id);
    await expect(action!(formData)).rejects.toThrow("redirect:/admin/billing/refund-reconciliation/transaction-1?status=error");
    expect(mocks.reconcilePayUniRefund).not.toHaveBeenCalled();
  });
});
