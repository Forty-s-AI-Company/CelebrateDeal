import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
  refundPaymentTransactionAction: vi.fn(),
  retryWebhookEventAction: vi.fn(),
  voidAffiliateCommissionAction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="csrf-admin" /> }));
vi.mock("@/components/form-submit-button", () => ({
  FormSubmitButton: ({ children, className, pendingMessage, confirmMessage }: { children: React.ReactNode; className?: string; pendingMessage: string; confirmMessage?: string }) => <button className={className} type="submit" data-pending-message={pendingMessage} data-confirm-message={confirmMessage}>{children}</button>,
}));
vi.mock("@/components/billing/refund-result-notice", () => ({ RefundResultNotice: () => <div data-testid="refund-result-notice" /> }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendorSubscription: { findMany: mocks.findMany },
    settlement: { findMany: mocks.findMany },
    payoutItem: { count: mocks.count },
    paymentTransaction: { findMany: mocks.findMany },
    webhookEvent: { findMany: mocks.findMany, count: mocks.count },
    auditLog: { findMany: mocks.findMany },
    $queryRaw: mocks.queryRaw,
  }),
}));

import AdminBillingDashboardPage from "./page";

const transaction = {
  id: "transaction-1",
  orderNumber: "ORDER-1",
  providerTradeNo: "PROVIDER-1",
  providerName: "payuni",
  status: "paid",
  occurredAt: new Date("2026-08-01T00:00:00.000Z"),
  refundedAmountCents: 0,
  grossAmountCents: 10000,
  vendor: { name: "示範商家" },
  _count: { refunds: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "admin-1", role: "platform_admin" } });
  mocks.findMany
    .mockResolvedValueOnce([{ plan: { monthlyPriceCents: 9900 } }])
    .mockResolvedValueOnce([{ id: "settlement-unlocked", status: "reviewing", monthKey: "2026-08", finalPayoutAmountCents: 0, vendor: { name: "示範商家" } }])
    .mockResolvedValueOnce([{ id: "settlement-ready", status: "locked", monthKey: "2026-07", finalPayoutAmountCents: 8000, vendor: { name: "示範商家" } }])
    .mockResolvedValueOnce([transaction])
    .mockResolvedValueOnce([{ id: "webhook-1", provider: "payuni", eventId: "event-1", eventType: "payment.succeeded", status: "failed", errorMessage: "重試測試", nextRetryAt: null, createdAt: new Date("2026-08-01T00:00:00.000Z"), vendor: { name: "示範商家" } }])
    .mockResolvedValueOnce([{ id: "audit-1", action: "refund", targetType: "PaymentTransaction", targetId: "transaction-1", actorLabel: "admin", createdAt: new Date("2026-08-01T00:00:00.000Z") }]);
  mocks.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
  mocks.queryRaw.mockResolvedValue([{ id: "commission-1", referralCode: "REF-1", monthKey: "2026-07", commissionAmountCents: 500, vendorName: "示範商家", affiliateName: "推廣夥伴" }]);
});

describe("/admin/billing/dashboard route", () => {
  it("renders finance summaries, refund controls, commission controls, webhooks and audits", async () => {
    const html = renderToStaticMarkup(await AdminBillingDashboardPage());

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(html).toContain("財務總覽");
    expect(html).toContain("$99");
    expect(html).toContain("示範商家");
    expect(html).toContain("ORDER-1");
    expect(html).toContain('data-testid="billing-refund-transaction-1"');
    expect(html).toContain('aria-label="退款月份"');
    expect(html).toContain('aria-label="退金流費"');
    expect(html).toContain('aria-label="退平台費"');
    expect(html).toContain('aria-label="退款原因"');
    expect(html).toContain("bg-orange-700");
    expect(html).toContain("推廣夥伴");
    expect(html).toContain("作廢佣金");
    expect(html).toContain("正在作廢聯盟佣金並寫入沖回紀錄");
    expect(html).toContain("確認作廢這筆聯盟佣金");
    expect(html).toContain("event-1");
    expect(html).toContain("Retry");
    expect(html).toContain("正在重新處理 webhook");
    expect(html).toContain("refund");
    expect(html).toContain('name="_csrf" value="csrf-admin"');
  });

  it("renders safely with empty operational collections", async () => {
    mocks.findMany.mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.count.mockReset().mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AdminBillingDashboardPage());

    expect(html).toContain("財務總覽");
    expect(html).toContain("本月 MRR");
    expect(html).not.toContain("billing-refund-");
    expect(html).not.toContain("Retry");
  });

  it("routes an ambiguous PayUni refund to reconciliation and hides refund controls for terminal states", async () => {
    const pending = { ...transaction, id: "transaction-pending", _count: { refunds: 1 } };
    const terminal = { ...transaction, id: "transaction-refunded", status: "refunded", refundedAmountCents: 10_000 };
    mocks.findMany.mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pending, terminal])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.count.mockReset().mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AdminBillingDashboardPage());

    expect(html).toContain('data-testid="billing-refund-reconciliation-transaction-pending"');
    expect(html).toContain('href="/admin/billing/refund-reconciliation/transaction-pending"');
    expect(html).not.toContain('data-testid="billing-refund-transaction-pending"');
    expect(html).toContain('data-testid="billing-refund-unavailable-transaction-refunded"');
    expect(html).not.toContain('data-testid="billing-refund-transaction-refunded"');
  });
});
