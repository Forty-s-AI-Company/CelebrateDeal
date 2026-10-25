import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyDerivedKeyUseCount, resetLegacyDerivedKeyUseCounts } from "@/lib/derived-key-rotation";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  hashRecoveryCodeAsync,
  generateTotpSecret,
  mfaSecretNeedsReencryption,
  reencryptMfaSecret,
  serializePendingMfaSetup,
  serializeRecoveryCodes,
  parsePendingMfaSetup,
  parseRecoveryCodes,
  totpCodeForTimestamp,
  verifyRecoveryCode,
  verifyRecoveryCodeAsync,
  verifyTotpCode,
} from "@/lib/mfa";
import { hashPassword } from "@/lib/password";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

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
    expect(codeHash).toMatch(/^hmac-sha256-v2:[A-Za-z0-9_-]{43}$/);
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

describe("mfa key rotation (B04-03 tier 4)", () => {
  // The exact pre-rotation format: "<iv>.<tag>.<data>" under the old purpose.
  function legacyCiphertext(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveSensitiveDataKey("mfa-encryption"), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  function legacyRecoveryHash(code: string) {
    const digest = createHmac("sha256", deriveSensitiveDataKey("mfa-recovery-code-authentication"))
      .update(code.replace(/\s+/g, "").replace(/-/g, ""))
      .digest("base64url");
    return `hmac-sha256-v1:${digest}`;
  }

  beforeEach(() => resetLegacyDerivedKeyUseCounts());

  it("encrypts new secrets in the m2 format under the new key only", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);
    const [version, iv, tag, data, extra] = encrypted.split(".");

    expect(version).toBe("m2");
    expect(extra).toBeUndefined();
    expect(mfaSecretNeedsReencryption(encrypted)).toBe(false);
    // The legacy key cannot open it.
    const decipher = createDecipheriv("aes-256-gcm", deriveSensitiveDataKey("mfa-encryption"), Buffer.from(iv!, "base64url"));
    decipher.setAuthTag(Buffer.from(tag!, "base64url"));
    expect(() => Buffer.concat([decipher.update(Buffer.from(data!, "base64url")), decipher.final()])).toThrow();
    expect(legacyDerivedKeyUseCount("mfa-encryption")).toBe(0);
  });

  it("still decrypts a stored legacy secret and counts the legacy-key use", () => {
    const secret = generateTotpSecret();
    const legacy = legacyCiphertext(secret);

    expect(mfaSecretNeedsReencryption(legacy)).toBe(true);
    expect(decryptMfaSecret(legacy)).toBe(secret);
    expect(legacyDerivedKeyUseCount("mfa-encryption")).toBe(1);
  });

  it("re-encrypts a legacy secret into the current format without changing it", () => {
    const secret = generateTotpSecret();
    const reencrypted = reencryptMfaSecret(legacyCiphertext(secret));

    expect(reencrypted.startsWith("m2.")).toBe(true);
    expect(mfaSecretNeedsReencryption(reencrypted)).toBe(false);
    expect(decryptMfaSecret(reencrypted)).toBe(secret);
  });

  it("rejects tampered ciphertext in both formats", () => {
    const secret = generateTotpSecret();
    const current = encryptMfaSecret(secret);
    const legacy = legacyCiphertext(secret);
    const flipLast = (value: string) => `${value.slice(0, -2)}${value.endsWith("AA") ? "BB" : "AA"}`;

    expect(() => decryptMfaSecret(flipLast(current))).toThrow();
    expect(() => decryptMfaSecret(flipLast(legacy))).toThrow();
    // A legacy body relabelled as m2 is not accepted under the new key.
    expect(() => decryptMfaSecret(`m2.${legacy}`)).toThrow();
    expect(() => decryptMfaSecret("m3.a.b.c")).toThrow();
  });

  it("refuses truncated GCM tags in both formats", () => {
    const secret = generateTotpSecret();
    const shorten = (tag: string) => Buffer.from(tag, "base64url").subarray(0, 8).toString("base64url");
    const [version, iv, tag, data] = encryptMfaSecret(secret).split(".");
    const [legacyIv, legacyTag, legacyData] = legacyCiphertext(secret).split(".");

    expect(() => decryptMfaSecret([version, iv, shorten(tag!), data].join("."))).toThrow("Invalid encrypted MFA payload.");
    expect(() => decryptMfaSecret([legacyIv, shorten(legacyTag!), legacyData].join("."))).toThrow("Invalid encrypted MFA payload.");
    // A genuine 4-byte-tag ciphertext under the current key is refused too.
    const shortIv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveSensitiveDataKey("mfa-encryption:r2:69a113bdb66c7a1e"), shortIv, { authTagLength: 4 });
    const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    expect(() => decryptMfaSecret(["m2", shortIv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join("."))).toThrow();
  });

  it("accepts only the current format for the short-lived setup and recovery cookies", () => {
    const secret = generateTotpSecret();
    const legacySetup = legacyCiphertext(JSON.stringify({ secret, userId: "user-1", createdAt: Date.now() }));
    const legacyCodes = legacyCiphertext(JSON.stringify({ codes: ["AAAAA-BBBBB"], createdAt: Date.now() }));

    expect(parsePendingMfaSetup(legacySetup)).toBeNull();
    expect(parseRecoveryCodes(legacyCodes)).toBeNull();
    expect(parseRecoveryCodes(serializeRecoveryCodes(["AAAAA-BBBBB"]))).toEqual(["AAAAA-BBBBB"]);
  });

  it("verifies v1 recovery-code hashes under the legacy key and counts the use", async () => {
    const [code] = generateRecoveryCodes(1);
    if (!code) throw new Error("Expected one recovery code.");
    const legacyHash = legacyRecoveryHash(code);

    expect(verifyRecoveryCode(code, legacyHash)).toBe(true);
    expect(await verifyRecoveryCodeAsync(code, legacyHash)).toBe(true);
    expect(verifyRecoveryCode("00000-00000-00000-00000", legacyHash)).toBe(false);
    expect(legacyDerivedKeyUseCount("mfa-recovery-code")).toBe(2);
    // A v2 label on a legacy digest does not verify under the new key.
    expect(verifyRecoveryCode(code, legacyHash.replace("hmac-sha256-v1:", "hmac-sha256-v2:"))).toBe(false);
    expect(hashRecoveryCode(code)).not.toBe(legacyHash.replace("hmac-sha256-v1:", "hmac-sha256-v2:"));
  });
});
