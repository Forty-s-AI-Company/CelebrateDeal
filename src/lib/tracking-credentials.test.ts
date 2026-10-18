import { afterEach, describe, expect, it, vi } from "vitest";
import { protectFacebookAccessToken, unprotectFacebookAccessToken } from "@/lib/tracking-credentials";

const syntheticToken = "synthetic-meta-token-for-isolated-tests";
afterEach(() => vi.unstubAllEnvs());

describe("tenant-bound tracking credentials", () => {
  it("round trips an encrypted synthetic credential without storing plaintext", () => {
    vi.stubEnv("CSRF_SECRET", "synthetic-tracking-encryption-key-at-least-32-bytes");
    const encrypted = protectFacebookAccessToken("vendor-one", syntheticToken);
    expect(encrypted).not.toContain(syntheticToken);
    expect(unprotectFacebookAccessToken("vendor-one", encrypted)).toBe(syntheticToken);
    expect(protectFacebookAccessToken("vendor-one", syntheticToken)).not.toBe(encrypted);
  });
  it("rejects a second tenant without exposing the credential or envelope", () => {
    vi.stubEnv("CSRF_SECRET", "synthetic-tracking-encryption-key-at-least-32-bytes");
    const encrypted = protectFacebookAccessToken("vendor-one", syntheticToken);
    expect(() => unprotectFacebookAccessToken("vendor-two", encrypted)).toThrow("Tracking credential unavailable.");
  });
  it("rejects authenticated envelope tampering", () => {
    vi.stubEnv("CSRF_SECRET", "synthetic-tracking-encryption-key-at-least-32-bytes");
    const encrypted = protectFacebookAccessToken("vendor-one", syntheticToken);
    const parts = encrypted.split(".");
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    expect(() => unprotectFacebookAccessToken("vendor-one", parts.join("."))).toThrow("Tracking credential unavailable.");
  });
  it.each(["short", "bad\r\nAuthorization: Bearer synthetic", "a".repeat(4097)])("rejects malformed or unbounded tokens", token => {
    vi.stubEnv("CSRF_SECRET", "synthetic-tracking-encryption-key-at-least-32-bytes");
    expect(() => protectFacebookAccessToken("vendor-one", token)).toThrow("Invalid tracking credential.");
  });
  it.each(["", "vendor one", "vendor:one", "a".repeat(129)])("rejects ambiguous tenant identities", vendorId => {
    vi.stubEnv("CSRF_SECRET", "synthetic-tracking-encryption-key-at-least-32-bytes");
    expect(() => protectFacebookAccessToken(vendorId, syntheticToken)).toThrow("Invalid tracking tenant.");
  });
  it("fails closed without a configured encryption key", () => {
    vi.stubEnv("CSRF_SECRET", ""); vi.stubEnv("JOB_SECRET", "");
    expect(() => protectFacebookAccessToken("vendor-one", syntheticToken)).toThrow("Sensitive data encryption key is not configured.");
  });
});
