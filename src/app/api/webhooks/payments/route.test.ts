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
  webhookEventFindUnique: vi.fn(),
  webhookEventCreate: vi.fn(),
  webhookEventUpdateMany: vi.fn(),
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

import { HEAD, POST } from "@/app/api/webhooks/payments/route";
import { MAX_JSON_BODY_BYTES } from "@/lib/api-security";

function webhookRequest(providerQuery = "", headers?: HeadersInit, body = JSON.stringify({ eventId: "event-test" })) {
  return new Request(`https://app.example.test/api/webhooks/payments${providerQuery}`, {
    method: "POST",
    headers,
    body,
  });
}

function observePreview() {
  vi.stubEnv("VERCEL_ENV", "preview");
  return vi.spyOn(console, "info").mockImplementation(() => undefined);
}

function observedRecord(consoleInfo: ReturnType<typeof vi.spyOn>) {
  const first = consoleInfo.mock.calls[0]?.[0];
  expect(typeof first).toBe("string");
  return JSON.parse(first as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAYMENT_PROVIDER", "demo");
  vi.stubEnv("NODE_ENV", "test");
  mocks.getDb.mockReturnValue({
    webhookEvent: {
      findUnique: mocks.webhookEventFindUnique,
      create: mocks.webhookEventCreate,
      updateMany: mocks.webhookEventUpdateMany,
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("payment webhook provider selection", () => {
  it.each([
    ["return", "return"],
    ["notify", "notify"],
    ["missing", "unknown"],
    ["case variant", "unknown"],
    ["duplicate", "unknown"],
  ])("HEAD classifies %s source with a fixed 405 receipt", async (sourceCase, expectedSource) => {
    const consoleInfo = observePreview();
    const query = sourceCase === "return"
      ? "?provider=payuni&source=return"
      : sourceCase === "notify"
        ? "?provider=payuni&source=notify"
        : sourceCase === "case variant"
          ? "?provider=payuni&source=RETURN"
          : sourceCase === "duplicate"
            ? "?provider=payuni&source=return&source=notify"
            : "?provider=payuni";
    const request = new Request(`https://app.example.test/api/webhooks/payments${query}`, { method: "HEAD" });
    const readBody = vi.spyOn(request, "text");

    const response = await HEAD(request);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(readBody).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.demoVerifySignature).not.toHaveBeenCalled();
    expect(mocks.payUniVerifySignature).not.toHaveBeenCalled();
    expect(consoleInfo).toHaveBeenCalledTimes(1);
    const record = observedRecord(consoleInfo);
    expect(record).toEqual({
      event: "payment_webhook_request_v1",
      method: "HEAD",
      path: "/api/webhooks/payments",
      source: expectedSource,
      status: 405,
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("emits one safe POST receipt for explicit success and failure statuses", async () => {
    const consoleInfo = observePreview();

    const unsupported = await POST(webhookRequest("?provider=unknown&source=return"));
    expect(unsupported.status).toBe(400);

    vi.stubEnv("PAYMENT_PROVIDER", "payuni");
    mocks.payUniVerifySignature.mockResolvedValue(false);
    const signatureFailure = await POST(webhookRequest("?provider=payuni&source=notify"));
    expect(signatureFailure.status).toBe(401);

    const oversized = await POST(webhookRequest("?provider=payuni&source=return", {
      "content-length": String(MAX_JSON_BODY_BYTES + 1),
    }));
    expect(oversized.status).toBe(303);
    expect(oversized.headers.get("location")).toBe("https://app.example.test/checkout/result?payment=unverified");

    mocks.payUniVerifySignature.mockResolvedValue(true);
    mocks.payUniNormalizePayload.mockResolvedValue({
      payload: { provider: "payuni", eventId: "event-safe", eventType: "paid", orderNumber: "CD-SAFE" },
      rawPayload: {},
    });
    mocks.webhookEventFindUnique.mockResolvedValue({ id: "event-safe", status: "processed" });
    const duplicate = await POST(webhookRequest("?provider=payuni&source=return"));
    expect(duplicate.status).toBe(303);
    expect(duplicate.headers.get("location")).toBe("https://app.example.test/checkout/result?payment=updated");

    expect(consoleInfo).toHaveBeenCalledTimes(4);
    const records = consoleInfo.mock.calls.map(([value]) => JSON.parse(value as string));
    expect(records.map((record) => [record.method, record.source, record.status])).toEqual([
      ["POST", "return", 400],
      ["POST", "notify", 401],
      ["POST", "return", 303],
      ["POST", "return", 303],
    ]);
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual(["event", "method", "path", "source", "status", "timestamp"]);
      expect(JSON.stringify(record)).not.toContain("event-safe");
      expect(JSON.stringify(record)).not.toContain("CD-SAFE");
    }
  });

  it("redirects an exact PayUni payer return to a bounded same-origin result without identifiers", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "payuni");
    mocks.payUniVerifySignature.mockResolvedValue(true);
    mocks.payUniNormalizePayload.mockResolvedValue({
      payload: { provider: "payuni", eventId: "provider-event-private", eventType: "paid", orderNumber: "CD-PRIVATE" },
      rawPayload: {},
    });
    mocks.webhookEventFindUnique.mockResolvedValue(null);
    mocks.webhookEventCreate.mockResolvedValue({ id: "webhook-event-private", status: "received" });
    mocks.processPaymentWebhook.mockResolvedValue({ vendor: { id: "vendor-private" }, transaction: { id: "transaction-private" } });

    const response = await POST(webhookRequest("?provider=payuni&source=return"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/checkout/result?payment=updated");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const serialized = JSON.stringify({ location: response.headers.get("location"), body: await response.text() });
    for (const marker of ["provider-event-private", "CD-PRIVATE", "webhook-event-private", "vendor-private", "transaction-private"]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("keeps PayUni NotifyURL as a provider JSON acknowledgement", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "payuni");
    mocks.payUniVerifySignature.mockResolvedValue(true);
    mocks.payUniNormalizePayload.mockResolvedValue({
      payload: { provider: "payuni", eventId: "provider-event-notify", eventType: "paid", orderNumber: "CD-NOTIFY" },
      rawPayload: {},
    });
    mocks.webhookEventFindUnique.mockResolvedValue({ id: "webhook-event-notify", status: "processed" });

    const response = await POST(webhookRequest("?provider=payuni&source=notify"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true, eventId: "webhook-event-notify" });
  });

  it("sends an unresolved PayUni payer return to a neutral pending result", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "payuni");
    mocks.payUniVerifySignature.mockResolvedValue(true);
    mocks.payUniNormalizePayload.mockResolvedValue({
      payload: { provider: "payuni", eventId: "provider-event-pending", eventType: "paid", orderNumber: "CD-PENDING" },
      rawPayload: {},
    });
    const event = { id: "webhook-event-pending", status: "received" };
    mocks.webhookEventFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(event);
    mocks.webhookEventCreate.mockResolvedValue(event);
    mocks.processPaymentWebhook.mockRejectedValue(new Error("temporary processing failure"));

    const response = await POST(webhookRequest("?provider=payuni&source=return"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/checkout/result?payment=pending");
    expect(mocks.webhookEventUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("does not serialize raw query, body, header, identifier, or secret markers", async () => {
    const consoleInfo = observePreview();
    const bodyMarker = "raw-body-canary-value";
    const headerMarker = "raw-header-canary-value";
    const sourceMarker = "source-canary-value";

    const response = await POST(webhookRequest(`?provider=unknown&source=${sourceMarker}`, {
      "x-webhook-provider": "unknown",
      "x-test-marker": headerMarker,
    }, bodyMarker));

    expect(response.status).toBe(400);
    const serialized = JSON.stringify(observedRecord(consoleInfo));
    expect(serialized).not.toContain("app.example.test");
    expect(serialized).not.toContain("provider=unknown");
    expect(serialized).not.toContain(bodyMarker);
    expect(serialized).not.toContain(headerMarker);
    expect(serialized).not.toContain(sourceMarker);
    expect(serialized).not.toContain("event-test");
  });

  it("does not emit request receipts outside Preview", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubEnv("VERCEL_ENV", "production");

    const response = await HEAD(new Request("https://app.example.test/api/webhooks/payments?provider=payuni&source=return", { method: "HEAD" }));

    expect(response.status).toBe(405);
    expect(consoleInfo).not.toHaveBeenCalled();
  });

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

  it("does not expose provider parser details when a signed payload is invalid", async () => {
    mocks.demoVerifySignature.mockResolvedValue(true);
    mocks.demoNormalizePayload.mockRejectedValue(new Error("secret=provider-private-value"));

    const response = await POST(webhookRequest("?provider=demo"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "Invalid payment webhook payload", code: "invalid_payload" });
    expect(JSON.stringify(payload)).not.toContain("provider-private-value");
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("provider-private-value");
  });

  it("stores and returns only a closed failure code when processing throws an unknown exception", async () => {
    const event = { id: "webhook-event-1", status: "received" };
    const normalizedPayload = {
      provider: "demo",
      eventId: "provider-event-1",
      eventType: "paid",
    };
    mocks.demoVerifySignature.mockResolvedValue(true);
    mocks.demoNormalizePayload.mockResolvedValue({ payload: normalizedPayload, rawPayload: {} });
    mocks.webhookEventFindUnique.mockResolvedValue(null);
    mocks.webhookEventCreate.mockResolvedValue(event);
    mocks.processPaymentWebhook.mockRejectedValue(new Error("postgresql://user:password@private-db.example.test/app")); // secret-scan: allow-test-fixture

    const response = await POST(webhookRequest("?provider=demo"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: "Payment webhook processing failed",
      code: "processing_failed",
      eventId: event.id,
    });
    expect(mocks.webhookEventUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: event.id, status: { not: "processed" } },
      data: expect.objectContaining({
        errorMessage: "Payment webhook processing failed (processing_failed).",
      }),
    }));
    expect(JSON.stringify([
      payload,
      mocks.webhookEventUpdateMany.mock.calls,
      mocks.writeAuditLog.mock.calls,
    ])).not.toContain("private-db.example.test");
  });

  it("converges a concurrent callback to duplicate success only after the event is processed", async () => {
    const receivedEvent = { id: "webhook-event-race", status: "received", retryCount: 0 };
    const normalizedPayload = {
      provider: "demo",
      eventId: "provider-event-race",
      eventType: "paid",
    };
    mocks.demoVerifySignature.mockResolvedValue(true);
    mocks.demoNormalizePayload.mockResolvedValue({ payload: normalizedPayload, rawPayload: {} });
    mocks.webhookEventFindUnique
      .mockResolvedValueOnce(receivedEvent)
      .mockResolvedValueOnce(receivedEvent)
      .mockResolvedValueOnce({ ...receivedEvent, status: "processed" });
    mocks.processPaymentWebhook
      .mockResolvedValueOnce({ vendor: { id: "vendor-race" }, transaction: { id: "transaction-race" } })
      .mockRejectedValueOnce(new Error("付款 webhook 事件處理權已變更。"));

    const first = await POST(webhookRequest("?provider=demo&source=return"));
    const second = await POST(webhookRequest("?provider=demo&source=notify"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      ok: true,
      duplicate: true,
      eventId: receivedEvent.id,
    });
    expect(mocks.webhookEventUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it.each([
    ["is still received", () => ({ id: "webhook-event-unprocessed", status: "received", retryCount: 0 })],
    ["cannot be read", () => { throw new Error("database reread unavailable"); }],
  ])("keeps a processing failure fail-closed when convergence %s", async (_description, reread) => {
    const receivedEvent = { id: "webhook-event-unprocessed", status: "received", retryCount: 0 };
    const normalizedPayload = { provider: "demo", eventId: "provider-event-unprocessed", eventType: "paid" };
    mocks.demoVerifySignature.mockResolvedValue(true);
    mocks.demoNormalizePayload.mockResolvedValue({ payload: normalizedPayload, rawPayload: {} });
    mocks.webhookEventFindUnique
      .mockResolvedValueOnce(receivedEvent)
      .mockImplementationOnce(reread);
    mocks.processPaymentWebhook.mockRejectedValueOnce(new Error("付款 webhook 事件處理權已變更。"));

    const response = await POST(webhookRequest("?provider=demo&source=notify"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "Payment webhook processing failed",
      code: "processing_claim_lost",
    });
    expect(mocks.webhookEventUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: receivedEvent.id, status: { not: "processed" } },
    }));
  });

  it("does not convert an invalid provider configuration into duplicate success", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "not-a-provider");

    const response = await POST(webhookRequest("?provider=demo&source=notify"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payment provider configuration" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("emits one redacted claim-lost failure record only when convergence is unresolved", async () => {
    const consoleInfo = observePreview();
    const receivedEvent = { id: "webhook-event-failure", status: "received", retryCount: 0 };
    const bodyMarker = "body-marker-not-for-log";
    const headerMarker = "header-marker-not-for-log";
    const queryMarker = "query-marker-not-for-log";
    mocks.demoVerifySignature.mockResolvedValue(true);
    mocks.demoNormalizePayload.mockResolvedValue({
      payload: { provider: "demo", eventId: "provider-event-failure", eventType: "paid" },
      rawPayload: {},
    });
    mocks.webhookEventFindUnique
      .mockResolvedValueOnce(receivedEvent)
      .mockResolvedValueOnce(receivedEvent);
    mocks.processPaymentWebhook.mockRejectedValueOnce(new Error("付款 webhook 事件處理權已變更。"));

    const response = await POST(webhookRequest(`?provider=demo&source=notify&marker=${queryMarker}`, {
      "x-test-marker": headerMarker,
    }, bodyMarker));

    expect(response.status).toBe(500);
    const records = consoleInfo.mock.calls.map(([value]) => JSON.parse(value as string));
    expect(records).toEqual([
      expect.objectContaining({ event: "payment_webhook_failure_v1", method: "POST", path: "/api/webhooks/payments", source: "notify", status: 500, code: "processing_claim_lost" }),
      expect.objectContaining({ event: "payment_webhook_request_v1", method: "POST", path: "/api/webhooks/payments", source: "notify", status: 500 }),
    ]);
    const serialized = JSON.stringify(records);
    for (const marker of [bodyMarker, headerMarker, queryMarker, "provider-event-failure", "webhook-event-failure", "app.example.test"]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("records unknown failures as processing_failed and isolates a Preview log sink failure", async () => {
    const receivedEvent = { id: "webhook-event-unknown", status: "received", retryCount: 0 };
    mocks.demoVerifySignature.mockResolvedValue(true);
    mocks.demoNormalizePayload.mockResolvedValue({
      payload: { provider: "demo", eventId: "provider-event-unknown", eventType: "paid" },
      rawPayload: {},
    });
    mocks.webhookEventFindUnique
      .mockResolvedValueOnce(receivedEvent)
      .mockResolvedValueOnce(receivedEvent);
    mocks.processPaymentWebhook.mockRejectedValueOnce(new Error("unreviewed failure detail"));
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("log sink unavailable"); });

    const response = await POST(webhookRequest("?provider=demo&source=return"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "processing_failed" });
    expect(mocks.webhookEventUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("does not emit failure records outside Preview or after processed convergence", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const receivedEvent = { id: "webhook-event-processed", status: "received", retryCount: 0 };
    mocks.demoVerifySignature.mockResolvedValue(true);
    mocks.demoNormalizePayload.mockResolvedValue({
      payload: { provider: "demo", eventId: "provider-event-processed", eventType: "paid" },
      rawPayload: {},
    });
    mocks.webhookEventFindUnique
      .mockResolvedValueOnce(receivedEvent)
      .mockResolvedValueOnce({ ...receivedEvent, status: "processed" });
    mocks.processPaymentWebhook.mockRejectedValueOnce(new Error("付款 webhook 事件處理權已變更。"));

    const response = await POST(webhookRequest("?provider=demo&source=return"));

    expect(response.status).toBe(200);
    expect(consoleInfo).not.toHaveBeenCalled();
  });
});
