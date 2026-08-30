import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmailBrandSnapshot,
  createEmailRecipientHash,
  createEmailUnsubscribeToken,
  createEmailUnsubscribeUrl,
  protectEmailDeliveryPayload,
  revealEmailDeliveryPayload,
  sanitizeEmailBrandSnapshot,
  verifyEmailUnsubscribeToken,
} from "./email-delivery-pii";
import { encryptSensitiveValue } from "./sensitive-data";

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

  it("round-trips only a normalized versioned brand snapshot inside the encrypted envelope", () => {
    const binding = { vendorId: "vendor-1", deliveryId: "email_brand-1" };
    const protectedRecipient = protectEmailDeliveryPayload({
      recipientEmail: "lead@example.test",
      subject: "報名成功",
      body: "通知內容",
      brand: {
        senderName: "  e\u0301quipe  ",
        supportEmail: " Support@Example.Test ",
        contactUrl: "https://example.test/contact?from=email#help",
      },
    }, binding);

    for (const plaintext of ["équipe", "support@example.test", "https://example.test/contact"]) {
      expect(protectedRecipient.payloadEncryptedEnvelope).not.toContain(plaintext);
    }
    expect(revealEmailDeliveryPayload(protectedRecipient.payloadEncryptedEnvelope, binding)).toEqual({
      recipientEmail: "lead@example.test",
      subject: "報名成功",
      body: "通知內容",
      brand: {
        version: 1,
        senderName: "équipe",
        replyTo: "support@example.test",
        contactUrl: "https://example.test/contact?from=email#help",
      },
    });
  });

  it("fails soft per brand field and never accepts sender-address overrides", () => {
    expect(sanitizeEmailBrandSnapshot({
      version: 1,
      senderName: "正常品牌",
      replyTo: "Display <support@example.test>",
      contactUrl: "https://127.0.0.1/contact",
      from: "attacker@example.test",
      EMAIL_FROM: "attacker@example.test",
    })).toEqual({ version: 1, senderName: "正常品牌" });

    expect(sanitizeEmailBrandSnapshot({
      senderName: `品牌\u0007`,
      supportEmail: "first@example.test,second@example.test",
      contactUrl: "https://[::ffff:10.0.0.1]/contact",
    })).toBeUndefined();
    expect(sanitizeEmailBrandSnapshot({ contactUrl: `https://example.test/${"a".repeat(2_049)}` })).toBeUndefined();
  });

  it("keeps legacy and unknown-version encrypted payloads deliverable without brand data", () => {
    const binding = { vendorId: "vendor-1", deliveryId: "legacy_delivery-1" };
    const purpose = `email-delivery-recipient:${binding.vendorId}:${binding.deliveryId}`;
    const legacy = encryptSensitiveValue(JSON.stringify({
      recipientEmail: "lead@example.test",
      subject: "舊主旨",
      body: "舊內容",
    }), purpose);
    const unknownVersion = encryptSensitiveValue(JSON.stringify({
      recipientEmail: "lead@example.test",
      subject: "未知品牌版本",
      body: "仍應寄送",
      brand: { version: 2, senderName: "不得採用" },
    }), purpose);

    expect(revealEmailDeliveryPayload(legacy, binding)).toEqual({
      recipientEmail: "lead@example.test",
      subject: "舊主旨",
      body: "舊內容",
    });
    expect(revealEmailDeliveryPayload(unknownVersion, binding)).toEqual({
      recipientEmail: "lead@example.test",
      subject: "未知品牌版本",
      body: "仍應寄送",
    });
  });

  it("builds deterministic snapshots and omits empty legacy values", () => {
    const source = {
      senderName: "台灣品牌",
      supportEmail: "HELP@EXAMPLE.TEST",
      contactUrl: "https://example.test/help",
    };
    expect(createEmailBrandSnapshot(source)).toEqual(createEmailBrandSnapshot(source));
    expect(createEmailBrandSnapshot({ senderName: " ", supportEmail: "bad", contactUrl: "http://example.test" }))
      .toEqual({ version: 1 });
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
