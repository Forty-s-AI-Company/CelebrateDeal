import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sensitive data envelopes", () => {
  it("encrypts values without retaining plaintext and decrypts only for the same purpose", () => {
    vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-sensitive-data");
    const plaintext = "cloudflare-stream-key-fixture";
    const envelope = encryptSensitiveValue(plaintext, "cloudflare-live-stream-key");

    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain(plaintext);
    expect(decryptSensitiveValue(envelope, "cloudflare-live-stream-key")).toBe(plaintext);
    expect(() => decryptSensitiveValue(envelope, "another-purpose")).toThrow();
  });

  it("fails closed when no server-side encryption key is configured", () => {
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");

    expect(() => encryptSensitiveValue("secret", "cloudflare-live-stream-key")).toThrow(
      "Sensitive data encryption key is not configured.",
    );
  });
});
