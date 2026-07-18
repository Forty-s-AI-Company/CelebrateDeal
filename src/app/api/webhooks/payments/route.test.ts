import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  writeAuditLog: vi.fn(),
  auditSnapshot: vi.fn(),
  buildPaymentWebhookDiagnostics: vi.fn(),
  processPaymentWebhook: vi.fn(),
  demoVerifySignature: vi.fn(),
  demoNormalizePayload: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: mocks.auditSnapshot,
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/payment-webhook-diagnostics", () => ({
  buildPaymentWebhookDiagnostics: mocks.buildPaymentWebhookDiagnostics,
}));
vi.mock("@/lib/payment-webhooks", () => ({
  processPaymentWebhook: mocks.processPaymentWebhook,
}));
vi.mock("@/lib/payment-providers/demo", () => ({
  demoPaymentProvider: {
    id: "demo",
    verifySignature: mocks.demoVerifySignature,
    normalizePayload: mocks.demoNormalizePayload,
  },
}));
vi.mock("@/lib/payment-providers/payuni", () => ({
  payUniPaymentProvider: { id: "payuni" },
}));
vi.mock("@/lib/payment-providers/ecpay-like", () => ({
  ecpayLikePaymentProvider: { id: "ecpay-like" },
}));

import { POST } from "@/app/api/webhooks/payments/route";

function webhookRequest(providerQuery = "") {
  return new Request(`https://app.example.test/api/webhooks/payments${providerQuery}`, {
    method: "POST",
    body: JSON.stringify({ eventId: "event-test" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("payment webhook provider selection", () => {
  it.each([
    ["unknown", "?provider=unknown-provider"],
    ["blank", "?provider="],
    ["missing", ""],
  ])("rejects a %s provider before adapter or database work", async (_description, providerQuery) => {
    const response = await POST(webhookRequest(providerQuery));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unsupported payment provider" });
    expect(mocks.demoVerifySignature).not.toHaveBeenCalled();
    expect(mocks.demoNormalizePayload).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("continues to verify signatures for registered providers", async () => {
    mocks.demoVerifySignature.mockResolvedValue(false);

    const response = await POST(webhookRequest("?provider=demo"));

    expect(response.status).toBe(401);
    expect(mocks.demoVerifySignature).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
