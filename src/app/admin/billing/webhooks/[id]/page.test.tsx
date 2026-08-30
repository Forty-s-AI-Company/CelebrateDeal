import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  findUnique: vi.fn(),
  auditFindMany: vi.fn(),
  reconcileWebhookEvent: vi.fn(),
  redactSensitivePayload: vi.fn((value: unknown) => value),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
  retryWebhookEventAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    webhookEvent: { findUnique: mocks.findUnique },
    auditLog: { findMany: mocks.auditFindMany },
  }),
}));
vi.mock("@/lib/reconciliation", () => ({ reconcileWebhookEvent: mocks.reconcileWebhookEvent }));
vi.mock("@/lib/redaction", () => ({ redactSensitivePayload: mocks.redactSensitivePayload }));
vi.mock("@/app/actions", () => ({ retryWebhookEventAction: mocks.retryWebhookEventAction }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import AdminBillingWebhookDetailPage from "./page";

const event = {
  id: "webhook-failed",
  provider: "payuni",
  eventId: "event-failed",
  status: "failed",
  retryCount: 2,
  maxRetries: 5,
  errorMessage: "synthetic processing failure",
  processedAt: null,
  payload: {
    raw: { orderNumber: "ORDER-SYNTHETIC" },
    normalized: { status: "failed" },
    diagnostics: {
      payuni: {
        receivedFields: ["Status"],
        expectedCheckoutFormFields: ["MerchantTradeNo"],
        encryptInfo: { present: true, length: 12 },
        hashInfo: { present: true, length: 16 },
        hashInfoVerification: "fail",
        dashboardChecklist: ["sandbox"]
      },
    },
  },
  vendor: { name: "測試商家" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-admin" } });
  mocks.findUnique.mockResolvedValue(event);
  mocks.auditFindMany.mockResolvedValue([
    { id: "audit-1", action: "refund_reconciliation", actorLabel: "finance", ipAddress: null, createdAt: new Date("2026-08-05T00:00:00.000Z") },
  ]);
  mocks.reconcileWebhookEvent.mockResolvedValue([
    { key: "provider", label: "Provider", status: "warning", expected: "payuni", actual: "payuni", detail: "synthetic check" },
  ]);
});

describe("/admin/billing/webhooks/[id] route", () => {
  it("renders failed diagnostics, redacted payload blocks and reconciliation checks", async () => {
    const html = renderToStaticMarkup(await AdminBillingWebhookDetailPage({
      params: Promise.resolve({ id: event.id }),
    }));

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: event.id }, include: { vendor: true } });
    expect(mocks.auditFindMany).toHaveBeenCalledWith({
      where: { targetType: "WebhookEvent", targetId: event.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    expect(mocks.reconcileWebhookEvent).toHaveBeenCalledExactlyOnceWith(event);
    expect(html).toContain("Webhook 詳情");
    expect(html).toContain("匯出對帳 JSON");
    expect(html).toContain("處理失敗");
    expect(html).toContain("手動重送");
    expect(html.match(/aria-busy="false"/gu) ?? []).toHaveLength(1);
    expect(html).toContain('aria-disabled="false"');
    expect(html).toContain("PayUni EncryptInfo / HashInfo 診斷");
    expect(html).toContain("ORDER-SYNTHETIC");
    expect(html).toContain("Reconciliation Checks");
    expect(html).toContain("refund_reconciliation");
  });

  it("fails closed through notFound when the event does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(AdminBillingWebhookDetailPage({
      params: Promise.resolve({ id: "missing-event" }),
    })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.auditFindMany).not.toHaveBeenCalled();
    expect(mocks.reconcileWebhookEvent).not.toHaveBeenCalled();
  });
});
