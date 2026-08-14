import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  findUnique: vi.fn(),
  reconcileWebhookEvent: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ webhookEvent: { findUnique: mocks.findUnique } }) }));
vi.mock("@/lib/reconciliation", () => ({ reconcileWebhookEvent: mocks.reconcileWebhookEvent }));

import { GET } from "./route";

const event = {
  id: "webhook-1",
  provider: "payuni",
  eventId: "event-1",
  status: "processed",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1" } });
  mocks.findUnique.mockResolvedValue(event);
  mocks.reconcileWebhookEvent.mockResolvedValue([
    { key: "transaction_amount", label: "Amount", status: "pass", expected: "1000", actual: "1000" },
    { key: "refund_total", label: "Refund", status: "fail", expected: "0", actual: "100" },
    { key: "provider", label: "Provider", status: "warning", expected: "payuni", actual: "payuni" },
  ]);
});

describe("GET /admin/billing/webhooks/[id]/reconciliation", () => {
  it("returns a sanitized downloadable reconciliation artifact", async () => {
    const response = await GET(new Request("https://app.example.test"), { params: Promise.resolve({ id: event.id }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=webhook-reconciliation.json");
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      schemaVersion: 1,
      event,
      summary: { pass: 1, warning: 1, fail: 1 },
      checks: expect.any(Array),
    }));
    expect(mocks.requireFinanceAdmin).toHaveBeenCalledOnce();
    expect(mocks.reconcileWebhookEvent).toHaveBeenCalledOnce();
  });

  it("returns a fixed not-found response without reconciliation data", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);

    const response = await GET(new Request("https://app.example.test"), { params: Promise.resolve({ id: event.id }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mocks.reconcileWebhookEvent).not.toHaveBeenCalled();
  });
});
