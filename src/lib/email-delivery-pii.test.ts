import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmailRecipientHash,
  createEmailUnsubscribeToken,
  createEmailUnsubscribeUrl,
  protectEmailDeliveryPayload,
  revealEmailDeliveryPayload,
  verifyEmailUnsubscribeToken,
} from "./email-delivery-pii";

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "g7-07-test-secret-that-is-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
});

afterEach(() => vi.unstubAllEnvs());

describe("email delivery PII", () => {
  it("encrypts the normalized recipient and exposes only a masked projection", () => {
    const binding = { vendorId: "vendor-1", deliveryId: "email_delivery-1" };
    const protectedRecipient = protectEmailDeliveryPayload({
      recipientEmail: " Lead@Example.Test ",
      subject: "王小明報名成功",
      body: "這是合成通知內容",
    }, binding);

    expect(protectedRecipient.payloadEncryptedEnvelope).not.toContain("lead@example.test");
    expect(protectedRecipient.payloadEncryptedEnvelope).not.toContain("王小明");
    expect(protectedRecipient.recipientMaskedEmail).toBe("l***@example.test");
    expect(protectedRecipient.recipientHash).toBe(createEmailRecipientHash("lead@example.test", "vendor-1"));
    expect(revealEmailDeliveryPayload(protectedRecipient.payloadEncryptedEnvelope, binding)).toEqual({
      recipientEmail: "lead@example.test",
      subject: "王小明報名成功",
      body: "這是合成通知內容",
    });
  });

  it("binds unsubscribe tokens to a delivery and rejects tampering", () => {
    const token = createEmailUnsubscribeToken("delivery-1");
    expect(verifyEmailUnsubscribeToken(token)).toBe("delivery-1");
    expect(verifyEmailUnsubscribeToken(`${token}x`)).toBeNull();
    expect(createEmailUnsubscribeUrl("delivery-1")).toBe(`https://app.example.test/unsubscribe?token=${encodeURIComponent(token)}`);
  });

  it("fails closed for invalid recipients and missing public URL", () => {
    expect(() => protectEmailDeliveryPayload({ recipientEmail: "not-an-email", subject: "Subject", body: "Body" }, { vendorId: "vendor-1", deliveryId: "delivery-1" })).toThrow("Invalid email delivery recipient");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(() => createEmailUnsubscribeUrl("delivery-1")).toThrow("Public application URL is not configured");
  });
});
