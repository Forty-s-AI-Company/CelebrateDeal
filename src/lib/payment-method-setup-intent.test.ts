import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createPaymentMethodSetupIntent,
  consumePaymentMethodSetupIntent,
  PAYMENT_METHOD_SETUP_CONSENT_VERSION,
  PAYMENT_METHOD_SETUP_TTL_MS,
  PaymentMethodSetupIntentRejectedError,
} from "@/lib/payment-method-setup-intent";

const startedAt = new Date("2026-09-29T10:00:00.000Z");
const callbackAt = new Date("2026-09-29T10:01:00.000Z");

function signedEvent(nonce: string) {
  return {
    setupIntentId: "intent-1",
    setupNonce: nonce,
    providerName: "payuni",
    eventId: "event-1",
    vendorId: "vendor-1",
    scopeType: "VENDOR" as const,
    providerPaymentMethodRef: "opaque-ref",
    verifiedAt: callbackAt.toISOString(),
  };
}

describe("payment method setup intent boundary", () => {
  it("records explicit consent and only a digest of the short-lived nonce", async () => {
    const create = vi.fn().mockResolvedValue({ id: "intent-1" });
    const db = { paymentMethodSetupIntent: { create } };
    await expect(createPaymentMethodSetupIntent(db, {
      vendorId: "vendor-1", providerName: "payuni", scopeType: "VENDOR",
      teamId: null, membershipId: null, consentActorId: "actor-1", consentAccepted: false, now: startedAt,
    })).rejects.toBeInstanceOf(PaymentMethodSetupIntentRejectedError);
    expect(create).not.toHaveBeenCalled();

    const result = await createPaymentMethodSetupIntent(db, {
      vendorId: "vendor-1", providerName: "payuni", scopeType: "VENDOR",
      teamId: null, membershipId: null, consentActorId: "actor-1", consentAccepted: true, now: startedAt,
    });
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      vendorId: "vendor-1", consentActorId: "actor-1", consentVersion: PAYMENT_METHOD_SETUP_CONSENT_VERSION,
      consentedAt: startedAt, expiresAt: new Date(startedAt.getTime() + PAYMENT_METHOD_SETUP_TTL_MS),
    });
    expect(data.nonceHash).toBe(createHash("sha256").update(result.setupNonce).digest("hex"));
    expect(JSON.stringify(data)).not.toContain(result.setupNonce);
  });

  it("rejects cross-tenant, expired, wrong-nonce and replay callbacks before a reference write", async () => {
    const nonce = "A".repeat(43);
    const intent = {
      id: "intent-1", vendorId: "vendor-1", providerName: "payuni", scopeType: "VENDOR",
      teamId: null, membershipId: null, nonceHash: createHash("sha256").update(nonce).digest("hex"),
      consentVersion: PAYMENT_METHOD_SETUP_CONSENT_VERSION, consentedAt: startedAt,
      status: "pending", expiresAt: new Date(startedAt.getTime() + PAYMENT_METHOD_SETUP_TTL_MS),
      createdAt: startedAt,
    };
    const findUnique = vi.fn().mockResolvedValue(intent);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { paymentMethodSetupIntent: { findUnique, updateMany } };

    await expect(consumePaymentMethodSetupIntent(db, { ...signedEvent(nonce), vendorId: "vendor-2" }, callbackAt))
      .rejects.toBeInstanceOf(PaymentMethodSetupIntentRejectedError);
    await expect(consumePaymentMethodSetupIntent(db, { ...signedEvent(nonce), providerName: "demo" }, callbackAt))
      .rejects.toBeInstanceOf(PaymentMethodSetupIntentRejectedError);
    await expect(consumePaymentMethodSetupIntent(db, { ...signedEvent(nonce), scopeType: "MEMBERSHIP", teamId: "team-1", membershipId: "member-1" }, callbackAt))
      .rejects.toBeInstanceOf(PaymentMethodSetupIntentRejectedError);
    await expect(consumePaymentMethodSetupIntent(db, signedEvent("B".repeat(43)), callbackAt))
      .rejects.toBeInstanceOf(PaymentMethodSetupIntentRejectedError);
    await expect(consumePaymentMethodSetupIntent(db, signedEvent(nonce), new Date("2026-09-29T10:16:00.000Z")))
      .rejects.toBeInstanceOf(PaymentMethodSetupIntentRejectedError);
    expect(updateMany).not.toHaveBeenCalled();

    await consumePaymentMethodSetupIntent(db, signedEvent(nonce), callbackAt);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "intent-1", vendorId: "vendor-1", status: "pending" }),
      data: expect.objectContaining({ status: "verified", providerEventId: "event-1" }),
    }));
    updateMany.mockResolvedValue({ count: 0 });
    await expect(consumePaymentMethodSetupIntent(db, signedEvent(nonce), callbackAt))
      .rejects.toBeInstanceOf(PaymentMethodSetupIntentRejectedError);
  });
});
