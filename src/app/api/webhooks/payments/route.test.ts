import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  writeAuditLog: vi.fn(),
  auditSnapshot: vi.fn(),
  buildPaymentWebhookDiagnostics: vi.fn(),
  processPaymentWebhook: vi.fn(),
  demoVerifySignature: vi.fn(),
  demoNormalizePayload: vi.fn(),
  payUniVerifySignature: vi.fn(),
  payUniNormalizePayload: vi.fn(),
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
  payUniPaymentProvider: {
    id: "payuni",
    verifySignature: mocks.payUniVerifySignature,
    normalizePayload: mocks.payUniNormalizePayload,
  },
}));
vi.mock("@/lib/payment-providers/ecpay-like", () => ({
  ecpayLikePaymentProvider: { id: "ecpay-like" },
}));

import { POST } from "@/app/api/webhooks/payments/route";
import { MAX_JSON_BODY_BYTES } from "@/lib/api-security";

function webhookRequest(providerQuery = "", headers?: HeadersInit) {
  return new Request(`https://app.example.test/api/webhooks/payments${providerQuery}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ eventId: "event-test" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAYMENT_PROVIDER", "demo");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("payment webhook provider selection", () => {
  it("rejects oversized payloads before diagnostics, signature verification, audit, or database work", async () => {
    const response = await POST(webhookRequest("?provider=demo", {
      "content-length": String(MAX_JSON_BODY_BYTES + 1),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Webhook payload too large" });
    expect(mocks.buildPaymentWebhookDiagnostics).not.toHaveBeenCalled();
    expect(mocks.demoVerifySignature).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

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

  it.each([
    ["demo query provider", "?provider=demo", undefined],
    ["ecpay-like query provider", "?provider=ecpay-like", undefined],
    ["ecpay-like header provider", "", { "x-payment-provider": "ecpay-like" }],
  ])("rejects a %s when production is configured for payuni", async (_description, providerQuery, headers) => {
    vi.stubEnv("PAYMENT_PROVIDER", "payuni");
    vi.stubEnv("NODE_ENV", "production");
    const request = webhookRequest(providerQuery, headers);
    const readBody = vi.spyOn(request, "text");

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unsupported payment provider" });
    expect(readBody).not.toHaveBeenCalled();
    expect(mocks.payUniVerifySignature).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects demo webhooks in production before reading the body", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = webhookRequest("?provider=demo");
    const readBody = vi.spyOn(request, "text");

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Demo payment webhooks are not allowed in production" });
    expect(readBody).not.toHaveBeenCalled();
    expect(mocks.demoVerifySignature).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects conflicting provider query and header values", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "payuni");

    const response = await POST(webhookRequest("?provider=payuni", { "x-webhook-provider": "demo" }));

    expect(response.status).toBe(400);
    expect(mocks.payUniVerifySignature).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("continues to verify signatures for the configured provider", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "payuni");
    mocks.payUniVerifySignature.mockResolvedValue(false);

    const response = await POST(webhookRequest("?provider=payuni"));

    expect(response.status).toBe(401);
    expect(mocks.payUniVerifySignature).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("allows demo webhooks outside production", async () => {
    mocks.demoVerifySignature.mockResolvedValue(false);

    const response = await POST(webhookRequest("?provider=demo"));

    expect(response.status).toBe(401);
    expect(mocks.demoVerifySignature).toHaveBeenCalledTimes(1);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
