import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sensitive data envelopes", () => {
  it("encrypts values without retaining plaintext and decrypts only for the same purpose", () => {
    vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-sensitive-data-32-bytes");
    const plaintext = "cloudflare-stream-key-fixture";
    const envelope = encryptSensitiveValue(plaintext, "cloudflare-live-stream-key");

    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain(plaintext);
    expect(decryptSensitiveValue(envelope, "cloudflare-live-stream-key")).toBe(plaintext);
    expect(() => decryptSensitiveValue(envelope, "another-purpose")).toThrow();
  });

  it("fails closed when the configured encryption seed is shorter than 32 bytes", () => {
    vi.stubEnv("CSRF_SECRET", "short-secret");
    vi.stubEnv("JOB_SECRET", "");

    expect(() => encryptSensitiveValue("secret", "cloudflare-live-stream-key")).toThrow(
      "Sensitive data encryption key is too short.",
    );
  });

  it("fails closed when no server-side encryption key is configured", () => {
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");

    expect(() => encryptSensitiveValue("secret", "cloudflare-live-stream-key")).toThrow(
      "Sensitive data encryption key is not configured.",
    );
  });
});

describe("deriveSensitiveDataKey compatibility", () => {
  // Golden values were produced by the implementation before the CSRF key
  // separation fix, using only this synthetic root secret. If any of them
  // changes, existing MFA secrets, PII envelopes and hash indexes stop working.
  const SYNTHETIC_ROOT_SECRET = "synthetic-kdf-golden-root-secret-0123456789";
  const GOLDEN_KEYS: ReadonlyArray<readonly [string, string]> = [
    ["mfa-encryption", "a2eb7246cc071f0b207ed88782eb2eda683c45a500267425d62c8350ba06d014"],
    ["mfa-recovery-code-authentication", "bad8df85f6bab6524967cb00394d22ee4567a83f8382f4583abbab115cdb0c33"],
    ["commerce-order-buyer", "0b9390349e18235d3eb6a08d2b3e0d011f49f221309c6d8c5f968cd2f793ea42"],
    ["commerce-order-identity-fingerprint", "2b9d652b48836d4fa54f7b4a8a158818bb00794e98b4ff5b5ac738a48ca948e6"],
    ["form-submission-email-verification", "b3b44c1ecfa43cb42104334ce8a72cc3e47a2a58a530ed111ec77c8e27b27354"],
    ["form-submission-chat-session", "c5a2007a6a71a05f278a000ad85e0f279da974d337840d1accab4dd8629975b3"],
    ["email-delivery-unsubscribe", "f2dc0610274f5e683dd87b27f5d2a129a5af214c4546fc3ee4e0d8320afe8204"],
    ["student-portal-access-token-v1", "3ea4439b0cf0d30da405ee3da4da247e4a198c273335dec86d69cafc87168338"],
    ["cloudflare-live-stream-key", "2ba1c55eb1f9ff72d33ce306a6b11006e4fc943698d50b2dd2ed9a2c9d4f4328"],
    ["line-user-lookup:vendor_1", "3945fa3caa06c4c8d1019b8909077315181591182f5f6d2599e78c8aaa203a63"],
    ["team-funnel-attribution-cookie", "fd844965ebae71c2d9cbae99dae5413942357b5471f11e7a6bb4b32968c7450c"],
    ["public-checkout-admission", "23ab20a36125cd00c78d464aa9a06fc0cdcdc59c333ad3616567cbeb7bd79b78"],
    ["merchant-registration-invite", "a1aa5eb2c893bc38e1efe443a2842721b2c8baaffa780b202df37d1325768d92"],
    ["merchant-registration-invite-v2", "9e2ff4671f0dd4759a0905a0d9bfdbc1a9fa1b8dcb41fa8571f404f2e71ed9cf"],
  ];

  it.each(GOLDEN_KEYS)("keeps the %s key byte-identical", (purpose, expectedHex) => {
    vi.stubEnv("CSRF_SECRET", SYNTHETIC_ROOT_SECRET);

    expect(deriveSensitiveDataKey(purpose).toString("hex")).toBe(expectedHex);
  });

  it("keeps the JOB_SECRET fallback root unchanged when CSRF_SECRET is absent", () => {
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", SYNTHETIC_ROOT_SECRET);

    expect(deriveSensitiveDataKey("mfa-encryption").toString("hex")).toBe(GOLDEN_KEYS[0][1]);
  });
});
