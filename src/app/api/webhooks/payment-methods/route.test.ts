import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPaymentProvider: vi.fn(),
  readTextBody: vi.fn(),
  getDb: vi.fn(),
  applyVerifiedPaymentMethodSetup: vi.fn(),
  writeAuditLog: vi.fn(),
  auditSnapshot: vi.fn((value: unknown) => value),
  setupVerify: vi.fn(),
  setupNormalize: vi.fn(),
  eventUpsert: vi.fn(),
  eventUpdate: vi.fn(),
  eventUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/api-security", () => ({ readTextBody: mocks.readTextBody }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/payment-method-reference", () => ({
  applyVerifiedPaymentMethodSetup: mocks.applyVerifiedPaymentMethodSetup,
  PaymentMethodReferenceValidationError: class PaymentMethodReferenceValidationError extends Error {},
  PaymentMethodSetupConflictError: class PaymentMethodSetupConflictError extends Error {},
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog, auditSnapshot: mocks.auditSnapshot }));

import { POST } from "@/app/api/webhooks/payment-methods/route";

function request(provider = "payuni", body = "signed-body") {
  return new Request(`https://app.example.test/api/webhooks/payment-methods?provider=${provider}`, {
    method: "POST",
    headers: { "x-payment-provider": provider },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAYMENT_PROVIDER", "payuni");
  vi.stubEnv("NODE_ENV", "test");
  mocks.readTextBody.mockResolvedValue("signed-body");
  mocks.setupVerify.mockResolvedValue(true);
  mocks.setupNormalize.mockResolvedValue({
    providerName: "payuni",
    eventId: "setup-event-1",
    vendorId: "vendor-1",
    scopeType: "VENDOR",
    providerPaymentMethodRef: "method_ref",
    verifiedAt: "2026-08-07T12:00:00.000Z",
    expiresAt: null,
  });
  mocks.eventUpsert.mockResolvedValue({ id: "webhook-event-1", status: "received", eventType: "payment_method_setup_verified" });
  mocks.eventUpdate.mockResolvedValue(undefined);
  mocks.eventUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    paymentMethodReference: {},
    vendor: {},
    teamMembership: {},
    webhookEvent: { update: mocks.eventUpdate },
  }));
  mocks.getDb.mockReturnValue({
    webhookEvent: {
      upsert: mocks.eventUpsert,
      updateMany: mocks.eventUpdateMany,
    },
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
    expect(mocks.eventUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "processed" }) }));

    mocks.eventUpsert.mockResolvedValue({ id: "webhook-event-1", status: "processed", eventType: "payment_method_setup_verified" });
    const duplicate = await POST(request());
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual({ ok: true, duplicate: true, eventId: "webhook-event-1" });
    expect(mocks.applyVerifiedPaymentMethodSetup).toHaveBeenCalledOnce();
  });

  it("fails closed when the provider event id belongs to a different webhook type", async () => {
    mocks.eventUpsert.mockResolvedValue({ id: "webhook-event-1", status: "processed", eventType: "payment_paid" });

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
});
