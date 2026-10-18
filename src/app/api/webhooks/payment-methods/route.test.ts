import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPaymentProvider: vi.fn(),
  readTextBody: vi.fn(),
  getDb: vi.fn(),
  applyVerifiedPaymentMethodSetup: vi.fn(),
  consumeIntent: vi.fn(),
  writeAuditLog: vi.fn(),
  auditSnapshot: vi.fn((value: unknown) => value),
  setupVerify: vi.fn(),
  setupNormalize: vi.fn(),
  eventUpsert: vi.fn(),
  eventUpdate: vi.fn(),
  eventUpdateMany: vi.fn(),
  probeFindUnique: vi.fn(),
  probeUpdate: vi.fn(),
  referenceFindUnique: vi.fn(),
  transaction: vi.fn(),
  eventFindUnique: vi.fn(),
  auditFindFirst: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/api-security", () => ({ readTextBody: mocks.readTextBody }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/payment-method-reference", () => ({
  applyVerifiedPaymentMethodSetup: mocks.applyVerifiedPaymentMethodSetup,
  PaymentMethodReferenceValidationError: class PaymentMethodReferenceValidationError extends Error {},
  PaymentMethodSetupConflictError: class PaymentMethodSetupConflictError extends Error {},
}));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog, auditSnapshot: mocks.auditSnapshot }));
vi.mock("@/lib/payment-method-setup-intent", () => ({
  consumePaymentMethodSetupIntent: mocks.consumeIntent,
  PaymentMethodSetupIntentRejectedError: class PaymentMethodSetupIntentRejectedError extends Error {},
}));

import { POST } from "@/app/api/webhooks/payment-methods/route";
import { PaymentMethodSetupMalformedPayloadError, PaymentMethodSetupProviderResultError } from "@/lib/payment-providers/types";

function request(provider = "payuni", body = "signed-body") {
  return new Request(`https://app.example.test/api/webhooks/payment-methods?provider=${provider}`, {
    method: "POST",
    headers: { "x-payment-provider": provider },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.applyVerifiedPaymentMethodSetup.mockReset();
  mocks.consumeIntent.mockReset();
  vi.stubEnv("PAYMENT_PROVIDER", "payuni");
  vi.stubEnv("NODE_ENV", "test");
  mocks.readTextBody.mockResolvedValue("signed-body");
  mocks.setupVerify.mockResolvedValue(true);
  mocks.setupNormalize.mockResolvedValue({
    providerName: "payuni",
    setupIntentId: "intent-1",
    setupNonce: "synthetic-opaque-nonce",
    eventId: "setup-event-1",
    vendorId: "vendor-1",
    scopeType: "VENDOR",
    providerPaymentMethodRef: "method_ref",
    verifiedAt: "2026-08-07T12:00:00.000Z",
    expiresAt: null,
  });
  mocks.eventUpsert.mockResolvedValue({ id: "webhook-event-1", status: "received", eventType: "payment_method_setup_verified", vendorId: "vendor-1", payload: { setupIntentId: "intent-1" } });
  mocks.eventUpdate.mockResolvedValue(undefined);
  mocks.eventUpdateMany.mockResolvedValue({ count: 1 });
  mocks.probeFindUnique.mockResolvedValue(null);
  mocks.auditFindFirst.mockResolvedValue(null);
  mocks.writeAuditLog.mockResolvedValue(undefined);
  mocks.eventFindUnique.mockReset();
  mocks.transaction.mockReset();
  mocks.probeUpdate.mockResolvedValue(undefined);
  mocks.referenceFindUnique.mockResolvedValue({ id: "reference-1", status: "verified" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    paymentMethodSetupIntent: {},
    paymentMethodReference: { findUnique: mocks.referenceFindUnique },
    payUniLiveProbe: { findUnique: mocks.probeFindUnique, update: mocks.probeUpdate },
    vendor: {},
    teamMembership: {},
    webhookEvent: { update: mocks.eventUpdate },
  }));
  mocks.getDb.mockReturnValue({
    webhookEvent: {
      upsert: mocks.eventUpsert,
      updateMany: mocks.eventUpdateMany,
      findUnique: mocks.eventFindUnique,
    },
    auditLog: { findFirst: mocks.auditFindFirst },
    $transaction: mocks.transaction,
  });
  mocks.getPaymentProvider.mockReturnValue({
    id: "payuni",
    verifyPaymentMethodSetupSignature: mocks.setupVerify,
    normalizePaymentMethodSetupPayload: mocks.setupNormalize,
  });
});

describe("POST /api/webhooks/payment-methods", () => {
  it("fails closed when the provider has no setup callback contract", async () => {
    mocks.getPaymentProvider.mockReturnValue({ id: "payuni" });
    const response = await POST(request());
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({ error: "Payment method setup webhook is not configured" });
    expect(mocks.readTextBody).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures before normalization or database access", async () => {
    mocks.setupVerify.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.setupNormalize).not.toHaveBeenCalled();
    expect(mocks.eventUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledOnce();
  });

  it("persists only the normalized verified reference and converges replay", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, eventId: "webhook-event-1" });
    expect(mocks.eventUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { provider_eventId: { provider: "payuni", eventId: "setup-event-1" } },
      create: expect.objectContaining({
        eventType: "payment_method_setup_verified",
        payload: expect.not.objectContaining({ providerPaymentMethodRef: expect.anything() }),
      }),
    }));
    expect(mocks.applyVerifiedPaymentMethodSetup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      providerName: "payuni",
      providerPaymentMethodRef: "method_ref",
    }));
    expect(mocks.consumeIntent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ setupIntentId: "intent-1" }));
    expect(mocks.eventUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "processed" }) }));

    mocks.eventUpsert.mockResolvedValue({ id: "webhook-event-1", status: "processed", eventType: "payment_method_setup_verified", vendorId: "vendor-1", payload: { setupIntentId: "intent-1" } });
    const duplicate = await POST(request());
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual({ ok: true, duplicate: true, eventId: "webhook-event-1" });
    expect(mocks.applyVerifiedPaymentMethodSetup).toHaveBeenCalledOnce();
  });

  it("fails closed when the provider event id belongs to a different webhook type", async () => {
    mocks.eventUpsert.mockResolvedValue({ id: "webhook-event-1", status: "processed", eventType: "payment_paid", vendorId: "vendor-1", payload: { setupIntentId: "intent-1" } });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Payment method setup processing failed", code: "event_id_collision" });
    expect(mocks.applyVerifiedPaymentMethodSetup).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_method_setup_event_collision" }));
  });

  it("maps normalized reference rejection to a safe conflict without retrying it", async () => {
    const { PaymentMethodReferenceValidationError } = await import("@/lib/payment-method-reference");
    mocks.applyVerifiedPaymentMethodSetup.mockRejectedValue(new PaymentMethodReferenceValidationError());
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Payment method setup processing failed", code: "payment_method_setup_rejected" });
    expect(mocks.eventUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", errorMessage: "payment_method_setup_rejected" }),
    }));
  });

  it("schedules only the consented one-time live probe after a verified setup", async () => {
    mocks.probeFindUnique.mockResolvedValue({
      id: "probe-1", vendorId: "vendor-1", status: "awaiting_setup",
      firstAmountCents: 100, secondAmountCents: 100,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.probeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "probe-1" },
      data: expect.objectContaining({ status: "scheduled", paymentMethodReferenceId: "reference-1", dueAt: expect.any(Date) }),
    }));
  });

  it("rejects a signed callback with no matching live consent intent", async () => {
    const { PaymentMethodSetupIntentRejectedError } = await import("@/lib/payment-method-setup-intent");
    mocks.consumeIntent.mockRejectedValue(new PaymentMethodSetupIntentRejectedError());
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.applyVerifiedPaymentMethodSetup).not.toHaveBeenCalled();
  });
});

function sourceRequest(source: string, extraQuery = "") {
  return new Request(`https://app.example.test/api/webhooks/payment-methods?provider=payuni&source=${source}${extraQuery}`, {
    method: "POST",
    headers: { "x-payment-provider": "payuni", "content-type": "application/x-www-form-urlencoded" },
    body: "signed-body",
  });
}

const ALLOWED_PROVIDER_AUDIT_KEYS = [
  "errorCode",
  "setupIntentId",
  "providerStatus",
  "providerMessageCode",
  "providerTradeStatus",
  "providerResCode",
  "providerOuterStatusMismatch",
];
const RESULT_KEY = "0123456789abcdef0123456789abcdef";

function expectBrowserRedirect(response: Response, location: string) {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(location);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("content-type") ?? "").not.toContain("json");
}

function serializationFailure() {
  return Object.assign(new Error("Transaction failed due to a write conflict or a deadlock"), { code: "P2034" });
}

describe("POST /api/webhooks/payment-methods payer ReturnURL", () => {
  it("redirects a verified setup return to the fixed billing page", async () => {
    const response = await POST(sourceRequest("return"));
    expectBrowserRedirect(response, "/billing/payment-methods?setup=success");
    await expect(response.text()).resolves.toBe("");
    expect(mocks.applyVerifiedPaymentMethodSetup).toHaveBeenCalledOnce();
    expect(mocks.eventUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "processed" }) }));
  });

  it("converges on success when notify already processed the same signed event", async () => {
    mocks.eventUpsert.mockResolvedValue({ id: "webhook-event-1", status: "processed", eventType: "payment_method_setup_verified", vendorId: "vendor-1", payload: { setupIntentId: "intent-1" } });
    const response = await POST(sourceRequest("return"));
    expectBrowserRedirect(response, "/billing/payment-methods?setup=success");
    expect(mocks.consumeIntent).not.toHaveBeenCalled();
    expect(mocks.applyVerifiedPaymentMethodSetup).not.toHaveBeenCalled();
  });

  it.each([
    ["intent already consumed", async () => {
      const { PaymentMethodSetupIntentRejectedError } = await import("@/lib/payment-method-setup-intent");
      return new PaymentMethodSetupIntentRejectedError();
    }],
    ["P2034 serialization failure", async () => serializationFailure()],
  ])("reports success without a failure record when a concurrent notify committed first (%s)", async (_label, makeError) => {
    const failure = await makeError();
    mocks.transaction.mockRejectedValue(failure);
    mocks.eventFindUnique.mockResolvedValue({ status: "processed", eventType: "payment_method_setup_verified" });

    const response = await POST(sourceRequest("return"));

    expectBrowserRedirect(response, "/billing/payment-methods?setup=success");
    expect(mocks.eventFindUnique).toHaveBeenCalledWith({ where: { id: "webhook-event-1" }, select: { status: true, eventType: true } });
    expect(mocks.eventUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("reports a rejected intent when no processed event exists", async () => {
    const { PaymentMethodSetupIntentRejectedError } = await import("@/lib/payment-method-setup-intent");
    mocks.consumeIntent.mockRejectedValue(new PaymentMethodSetupIntentRejectedError());
    mocks.eventFindUnique.mockResolvedValue({ status: "failed", eventType: "payment_method_setup_verified" });
    const response = await POST(sourceRequest("return"));
    expectBrowserRedirect(response, "/billing/payment-methods?setup=failed&reason=rejected");
    expect(mocks.applyVerifiedPaymentMethodSetup).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_method_setup_failed" }));
  });

  it("reports a retryable processing failure only after re-reading an unprocessed event", async () => {
    mocks.transaction.mockRejectedValue(serializationFailure());
    mocks.eventFindUnique.mockResolvedValue({ status: "retrying", eventType: "payment_method_setup_verified" });
    const response = await POST(sourceRequest("return"));
    expectBrowserRedirect(response, "/billing/payment-methods?setup=failed&reason=processing_failed");
    expect(mocks.eventFindUnique).toHaveBeenCalledOnce();
    expect(mocks.eventUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", errorMessage: "payment_method_setup_processing_failed" }),
    }));
  });

  it("does not trust a processed row of another event type", async () => {
    mocks.transaction.mockRejectedValue(serializationFailure());
    mocks.eventFindUnique.mockResolvedValue({ status: "processed", eventType: "payment_paid" });
    expectBrowserRedirect(await POST(sourceRequest("return")), "/billing/payment-methods?setup=failed&reason=processing_failed");
  });

  it("redirects an authenticated PAYUNi decline and records only signed provider codes", async () => {
    mocks.setupNormalize.mockRejectedValue(new PaymentMethodSetupProviderResultError("declined", {
      status: "UPP02086", messageCode: "UPP02086", tradeStatus: "2", resCode: "05", outerStatusMismatch: true,
    }, RESULT_KEY, { setupIntentId: "pmABCDEFGHIJKLMNOPQRSTUV", vendorId: "vendor-1" }));

    const response = await POST(sourceRequest("return"));

    expectBrowserRedirect(response, "/billing/payment-methods?setup=failed&reason=provider_declined");
    expect(mocks.eventUpsert).not.toHaveBeenCalled();
    expect(mocks.consumeIntent).not.toHaveBeenCalled();
    expect(mocks.auditFindFirst).toHaveBeenCalledExactlyOnceWith({
      where: { targetType: "PaymentMethodSetupResult", targetId: RESULT_KEY, createdAt: { gte: expect.any(Date) } },
      select: { id: true },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledExactlyOnceWith({
      vendorId: "vendor-1",
      actorLabel: "payment-method-webhook:payuni",
      action: "payment_method_setup_provider_declined",
      targetType: "PaymentMethodSetupResult",
      targetId: RESULT_KEY,
      before: { providerId: "payuni", bodyBytes: "signed-body".length, callbackSource: "return" },
      after: {
        errorCode: "provider_declined",
        setupIntentId: "pmABCDEFGHIJKLMNOPQRSTUV",
        providerStatus: "UPP02086",
        providerMessageCode: "UPP02086",
        providerTradeStatus: "2",
        providerResCode: "05",
        providerOuterStatusMismatch: true,
      },
    });
    const auditAfter = mocks.writeAuditLog.mock.calls[0][0].after as Record<string, unknown>;
    expect(Object.keys(auditAfter).filter((key) => auditAfter[key] !== undefined)
      .every((key) => ALLOWED_PROVIDER_AUDIT_KEYS.includes(key))).toBe(true);
    expect(mocks.captureOperationalError).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      {
        source: "payment_method_setup_webhook",
        operation: "provider_declined",
        provider: "payuni",
        callbackSource: "return",
        providerStatus: "UPP02086",
        providerMessageCode: "UPP02086",
        providerTradeStatus: "2",
        providerResCode: "05",
        providerOuterStatusMismatch: true,
      },
      { fingerprint: ["payment-method-setup", "provider_declined", "UPP02086"] },
    );
  });

  it("skips duplicate audit and monitoring for a replay of an already recorded result", async () => {
    mocks.setupNormalize.mockRejectedValue(new PaymentMethodSetupProviderResultError("declined", { status: "UPP02086" }, RESULT_KEY));
    mocks.auditFindFirst.mockResolvedValue({ id: "audit-1" });

    const response = await POST(sourceRequest("return"));

    expectBrowserRedirect(response, "/billing/payment-methods?setup=failed&reason=provider_declined");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it("records again when the de-duplication lookup fails", async () => {
    mocks.setupNormalize.mockRejectedValue(new PaymentMethodSetupProviderResultError("declined", { status: "UPP02086" }, RESULT_KEY));
    mocks.auditFindFirst.mockRejectedValue(new Error("database unavailable"));
    expectBrowserRedirect(await POST(sourceRequest("return")), "/billing/payment-methods?setup=failed&reason=provider_declined");
    expect(mocks.writeAuditLog).toHaveBeenCalledOnce();
  });

  it("distinguishes a provider pending result and audits it without vendor attribution when unscoped", async () => {
    mocks.setupNormalize.mockRejectedValue(new PaymentMethodSetupProviderResultError("pending", { status: "UNKNOWN" }, RESULT_KEY));
    const response = await POST(sourceRequest("return"));
    expectBrowserRedirect(response, "/billing/payment-methods?setup=failed&reason=provider_pending");
    expect(mocks.writeAuditLog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      vendorId: null,
      action: "payment_method_setup_provider_pending",
      targetType: "PaymentMethodSetupResult",
      targetId: RESULT_KEY,
      after: { errorCode: "provider_pending", providerStatus: "UNKNOWN" },
    }));
  });

  it("redirects a malformed authenticated payload as invalid and de-duplicates by its signed key", async () => {
    mocks.setupNormalize.mockRejectedValue(new PaymentMethodSetupMalformedPayloadError(RESULT_KEY));
    const response = await POST(sourceRequest("return"));
    expectBrowserRedirect(response, "/billing/payment-methods?setup=failed&reason=invalid_payload");
    expect(mocks.writeAuditLog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: "payment_method_setup_invalid",
      targetType: "PaymentMethodSetupResult",
      targetId: RESULT_KEY,
      after: { errorCode: "invalid_payload" },
    }));
    expect(mocks.captureOperationalError).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      { source: "payment_method_setup_webhook", operation: "invalid_payload", provider: "payuni", callbackSource: "return" },
      { fingerprint: ["payment-method-setup", "invalid_payload"] },
    );
    expect(mocks.eventUpsert).not.toHaveBeenCalled();
  });

  it("keys an unclassified adapter error on the raw body digest", async () => {
    mocks.setupNormalize.mockRejectedValue(new Error("unexpected"));
    expectBrowserRedirect(await POST(sourceRequest("return")), "/billing/payment-methods?setup=failed&reason=invalid_payload");
    const audit = mocks.writeAuditLog.mock.calls[0][0] as { targetId: string; targetType: string };
    expect(audit.targetType).toBe("PaymentMethodSetupResult");
    expect(audit.targetId).toMatch(/^[0-9a-f]{32}$/u);
    expect(audit.targetId).not.toContain("signed-body");
  });

  it("keeps forged-signature handling and only changes the browser presentation", async () => {
    mocks.setupVerify.mockResolvedValue(false);
    const response = await POST(sourceRequest("return"));
    expectBrowserRedirect(response, "/billing/payment-methods?setup=failed&reason=unverified");
    expect(mocks.setupNormalize).not.toHaveBeenCalled();
    expect(mocks.eventUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: "payment_method_setup_signature_failed",
      before: { providerId: "payuni", bodyBytes: "signed-body".length },
    }));
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it("never redirects outside the fixed same-origin billing path", async () => {
    const response = await POST(new Request(
      "https://attacker.example/api/webhooks/payment-methods?provider=payuni&source=return&next=https%3A%2F%2Fattacker.example%2F&reason=evil",
      { method: "POST", headers: { "x-payment-provider": "payuni", host: "attacker.example" }, body: "signed-body" },
    ));
    expectBrowserRedirect(response, "/billing/payment-methods?setup=success");
  });

  it("redirects configuration failures on the return path instead of rendering JSON", async () => {
    mocks.getPaymentProvider.mockReturnValue({ id: "payuni" });
    expectBrowserRedirect(await POST(sourceRequest("return")), "/billing/payment-methods?setup=failed&reason=unavailable");
    mocks.readTextBody.mockResolvedValue(null);
    mocks.getPaymentProvider.mockReturnValue({
      id: "payuni",
      verifyPaymentMethodSetupSignature: mocks.setupVerify,
      normalizePaymentMethodSetupPayload: mocks.setupNormalize,
    });
    expectBrowserRedirect(await POST(sourceRequest("return")), "/billing/payment-methods?setup=failed&reason=invalid_payload");
  });

  it.each([
    ["body read", () => mocks.readTextBody.mockRejectedValue(new Error("stream aborted"))],
    ["signature audit write", () => {
      mocks.setupVerify.mockResolvedValue(false);
      mocks.writeAuditLog.mockRejectedValue(new Error("audit unavailable"));
    }],
    ["event upsert", () => mocks.eventUpsert.mockRejectedValue(new Error("database unavailable"))],
    ["failure bookkeeping", () => {
      mocks.transaction.mockRejectedValue(serializationFailure());
      mocks.eventFindUnique.mockResolvedValue(null);
      mocks.eventUpdateMany.mockRejectedValue(new Error("database unavailable"));
    }],
  ])("turns an unexpected %s exception into a sanitized browser redirect", async (_label, arrange) => {
    arrange();
    const response = await POST(sourceRequest("return"));
    expectBrowserRedirect(response, "/billing/payment-methods?setup=failed&reason=processing_failed");
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(
      expect.any(Error),
      { source: "payment_method_setup_webhook", operation: "return_unhandled", callbackSource: "return" },
      { fingerprint: ["payment-method-setup", "return_unhandled"] },
    );
    const context = JSON.stringify(mocks.captureOperationalError.mock.calls);
    expect(context).not.toMatch(/stream aborted|audit unavailable|database unavailable/u);
  });
});

describe("POST /api/webhooks/payment-methods notify contract", () => {
  it("keeps the JSON success contract for notify", async () => {
    const response = await POST(sourceRequest("notify"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, eventId: "webhook-event-1" });
  });

  it("keeps the 400 invalid_payload contract for an authenticated provider decline", async () => {
    mocks.setupNormalize.mockRejectedValue(new PaymentMethodSetupProviderResultError("declined", { status: "UPP02086" }, RESULT_KEY));
    const response = await POST(sourceRequest("notify"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payment method setup payload", code: "invalid_payload" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_method_setup_provider_declined" }));
  });

  it("keeps 400 for malformed notify payloads and 401 for forged notify signatures", async () => {
    mocks.setupNormalize.mockRejectedValue(new Error("malformed"));
    const malformed = await POST(sourceRequest("notify"));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: "Invalid payment method setup payload", code: "invalid_payload" });

    mocks.setupVerify.mockResolvedValue(false);
    const forged = await POST(sourceRequest("notify"));
    expect(forged.status).toBe(401);
    await expect(forged.json()).resolves.toEqual({ error: "Invalid signature" });
  });

  it("treats an ambiguous repeated source as a server-to-server caller", async () => {
    mocks.setupVerify.mockResolvedValue(false);
    const response = await POST(sourceRequest("return", "&source=return"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid signature" });
  });

  it("keeps the notify 409 and 500 processing contract without re-reading the event", async () => {
    const { PaymentMethodSetupIntentRejectedError } = await import("@/lib/payment-method-setup-intent");
    mocks.consumeIntent.mockRejectedValue(new PaymentMethodSetupIntentRejectedError());
    mocks.eventFindUnique.mockResolvedValue({ status: "processed", eventType: "payment_method_setup_verified" });
    const rejected = await POST(sourceRequest("notify"));
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toEqual({ error: "Payment method setup processing failed", code: "payment_method_setup_rejected" });

    mocks.consumeIntent.mockReset();
    mocks.transaction.mockRejectedValue(serializationFailure());
    const failedResponse = await POST(sourceRequest("notify"));
    expect(failedResponse.status).toBe(500);
    await expect(failedResponse.json()).resolves.toEqual({ error: "Payment method setup processing failed", code: "processing_failed" });
    expect(mocks.eventFindUnique).not.toHaveBeenCalled();
  });

  it("lets unexpected notify exceptions surface unchanged", async () => {
    mocks.eventUpsert.mockRejectedValue(new Error("database unavailable"));
    await expect(POST(sourceRequest("notify"))).rejects.toThrow("database unavailable");
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });
});
