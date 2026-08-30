import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  hashRecoveryCodeAsync,
  generateTotpSecret,
  serializePendingMfaSetup,
  parsePendingMfaSetup,
  totpCodeForTimestamp,
  verifyRecoveryCode,
  verifyRecoveryCodeAsync,
  verifyTotpCode,
} from "@/lib/mfa";
import { hashPassword } from "@/lib/password";

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-mfa-at-least-32-bytes");
  vi.stubEnv("JOB_SECRET", "test-job-secret-for-mfa-at-least-32-bytes");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("mfa helpers", () => {
  it("encrypts and decrypts totp secrets", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);

    expect(decryptMfaSecret(encrypted)).toBe(secret);
  });

  it("serializes pending mfa setup payloads", () => {
    const secret = generateTotpSecret();
    const payload = serializePendingMfaSetup(secret, "user-1");

    expect(parsePendingMfaSetup(payload)).toEqual({
      secret,
      userId: "user-1",
      createdAt: expect.any(Number),
    });
  });

  it("rejects legacy pending setup payloads that are not bound to a user", () => {
    const encryptedLegacyPayload = encryptMfaSecret(JSON.stringify({
      secret: generateTotpSecret(),
      createdAt: Date.now(),
    }));

    expect(parsePendingMfaSetup(encryptedLegacyPayload)).toBeNull();
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
    expect(codes.every((code) => /^(?:[0-9A-F]{5}-){3}[0-9A-F]{5}$/.test(code))).toBe(true);
  });

  it("authenticates high-entropy recovery codes with a versioned keyed digest", async () => {
    const [code] = generateRecoveryCodes(1);
    if (!code) throw new Error("Expected one recovery code.");

    const codeHash = hashRecoveryCode(code);
    expect(codeHash).toMatch(/^hmac-sha256-v1:[A-Za-z0-9_-]{43}$/);
    expect(codeHash).not.toContain(code.replace(/-/g, ""));
    expect(verifyRecoveryCode(code, codeHash)).toBe(true);
    expect(verifyRecoveryCode("00000-00000-00000-00000", codeHash)).toBe(false);
    expect(await hashRecoveryCodeAsync(code)).toBe(codeHash);
    expect(await verifyRecoveryCodeAsync(code, codeHash)).toBe(true);
  });

  it("keeps legacy scrypt recovery codes valid during the hash transition", async () => {
    const legacyCode = "ABCDE-12345";
    const legacyHash = hashPassword(legacyCode.replace(/-/g, ""));

    expect(verifyRecoveryCode(legacyCode, legacyHash)).toBe(true);
    expect(await verifyRecoveryCodeAsync(legacyCode, legacyHash)).toBe(true);
  });
});
