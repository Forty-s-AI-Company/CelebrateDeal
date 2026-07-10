import { describe, expect, it, vi } from "vitest";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  serializePendingMfaSetup,
  parsePendingMfaSetup,
  totpCodeForTimestamp,
  verifyTotpCode,
} from "@/lib/mfa";

describe("mfa helpers", () => {
  it("encrypts and decrypts totp secrets", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);

    expect(decryptMfaSecret(encrypted)).toBe(secret);
  });

  it("serializes pending mfa setup payloads", () => {
    const secret = generateTotpSecret();
    const payload = serializePendingMfaSetup(secret);

    expect(parsePendingMfaSetup(payload)?.secret).toBe(secret);
  });

  it("verifies generated totp codes within the allowed window", () => {
    vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
    const secret = "JBSWY3DPEHPK3PXP";
    const code = totpCodeForTimestamp(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("creates one-time recovery codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
  });
});
