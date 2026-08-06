import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  retryWebhookEventAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ webhookEvent: { findMany: mocks.findMany, count: mocks.count } }),
}));
vi.mock("@/app/actions", () => ({ retryWebhookEventAction: mocks.retryWebhookEventAction }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import AdminBillingWebhooksPage from "./page";

const events = [
  {
    id: "webhook-failed",
    provider: "payuni",
    eventId: "event-failed",
    eventType: "refund",
    status: "failed",
    retryCount: 2,
    maxRetries: 5,
    errorMessage: "synthetic validation failure",
    nextRetryAt: new Date("2026-08-06T00:00:00.000Z"),
    createdAt: new Date("2026-08-05T00:00:00.000Z"),
    vendor: { name: "測試商家" },
  },
  {
    id: "webhook-processed",
    provider: "ecpay",
    eventId: "event-processed",
    eventType: "payment",
    status: "processed",
    retryCount: 0,
    maxRetries: 5,
    errorMessage: null,
    nextRetryAt: null,
    createdAt: new Date("2026-08-04T00:00:00.000Z"),
    vendor: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-admin" } });
  mocks.findMany.mockResolvedValue(events);
  mocks.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
});

describe("/admin/billing/webhooks route", () => {
  it("loads bounded webhook summaries and exposes retry only for failed events", async () => {
    const html = renderToStaticMarkup(await AdminBillingWebhooksPage());

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.findMany).toHaveBeenCalledWith({
      include: { vendor: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(mocks.count).toHaveBeenNthCalledWith(1, { where: { status: "failed" } });
    expect(mocks.count).toHaveBeenNthCalledWith(2, { where: { nextRetryAt: { not: null } } });
    expect(html).toContain("Webhook 對帳中心");
    expect(html).toContain("payuni");
    expect(html).toContain("synthetic validation failure");
    expect(html).toContain("Retry");
    expect(html).toContain("查看");
    expect(html).toContain("事件列表");
  });

  it("renders an empty event table without leaking unknown payload data", async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.count.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const html = renderToStaticMarkup(await AdminBillingWebhooksPage());

    expect(html).toContain(">0<");
    expect(html).toContain("Retry Queue");
    expect(html).not.toContain("event-failed");
    expect(html).not.toContain("raw-provider-secret");
  });
});
