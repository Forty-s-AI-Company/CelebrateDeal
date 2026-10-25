import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  crypto.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: crypto.timingSafeEqual };
});

import {
  createMerchantEmailVerificationToken,
  MERCHANT_EMAIL_VERIFICATION_KEY_PURPOSE,
  MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH,
  MERCHANT_EMAIL_VERIFICATION_TTL_HOURS,
  MERCHANT_EMAIL_VERIFICATION_TTL_MS,
  merchantEmailVerificationUrl,
  readMerchantEmailVerificationToken,
  verifyMerchantEmailVerificationToken,
} from "@/lib/merchant-email-verification-token";
import { createMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-purposes";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const SECRET = "synthetic-email-verification-secret-32-bytes";
const NOW = new Date("2026-10-25T00:00:00.000Z");
const USER = { userId: "cuid_synthetic_member_1", email: "owner@example.test" };

function decodePayload(token: string) {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Signs an arbitrary payload for `email` with a real derived key, to test payload rules behind a valid MAC. */
function forge(payload: unknown, email = USER.email, keyPurpose = MERCHANT_EMAIL_VERIFICATION_KEY_PURPOSE) {
  const body = `mev1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  const mac = createHmac("sha256", deriveSensitiveDataKey(keyPurpose)).update("mev1-mac:").update(body).update("\u0000").update(email).digest("base64url");
  return `${body}.${mac}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return { purpose: "merchant_email_verification", userId: USER.userId, exp: Math.floor(NOW.getTime() / 1_000) + 3_600, jti: "synthetic-jti-0123456789", ...overrides };
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", SECRET);
  crypto.timingSafeEqual.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("merchant email verification key", () => {
  it("uses an unguessable, single-purpose label", () => {
    expect(MERCHANT_EMAIL_VERIFICATION_KEY_PURPOSE).toMatch(/^merchant-email-verification:r2:[0-9a-f]{16}$/u);
    // Registered in the rotation registry with no legacy key.
    expect(DERIVED_KEY_ROTATIONS.merchantEmailVerification).toEqual({ label: "merchant-email-verification", current: "merchant-email-verification:r2:5a881e5879ba6156", legacy: null });
  });

  it("keeps a golden derived key and MAC, so the key and the token format cannot change silently", () => {
    vi.stubEnv("CSRF_SECRET", "synthetic-kdf-golden-root-secret-0123456789");
    expect(deriveSensitiveDataKey(MERCHANT_EMAIL_VERIFICATION_KEY_PURPOSE).toString("hex")).toBe("47636dcbd0645d5f0cb4b0256d9e88ebaa23e67838263bc755f070eda927b9c8");
    const golden = "mev1.eyJwdXJwb3NlIjoibWVyY2hhbnRfZW1haWxfdmVyaWZpY2F0aW9uIiwidXNlcklkIjoiY3VpZF9nb2xkZW5fdXNlciIsImV4cCI6NDEwMjQ0NDgwMCwianRpIjoiZ29sZGVuLWp0aS0wMTIzNDU2Nzg5In0.K9J0Ebv8luy2yZ2HKAoKnExqjqiE8OKHAMvi9Gve3oQ";
    expect(verifyMerchantEmailVerificationToken(golden, "owner@example.test", NOW)).toEqual({ userId: "cuid_golden_user", expiresAt: new Date(4102444800 * 1_000), jti: "golden-jti-0123456789" });
    expect(verifyMerchantEmailVerificationToken(golden, "other@example.test", NOW)).toBeNull();
  });
});

describe("merchant email verification tokens", () => {
  it("round-trips the user with a 24-hour expiry and a random jti, bound to the address", () => {
    const link = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    expect(MERCHANT_EMAIL_VERIFICATION_TTL_HOURS).toBe(24);
    expect(link.expiresAt.getTime()).toBe(NOW.getTime() + MERCHANT_EMAIL_VERIFICATION_TTL_MS);
    expect(link.token).toMatch(/^mev1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    const expected = { userId: USER.userId, expiresAt: link.expiresAt, jti: link.jti };
    expect(verifyMerchantEmailVerificationToken(link.token, USER.email, NOW)).toEqual(expected);
    expect(readMerchantEmailVerificationToken(link.token, NOW)).toEqual(expected);
    expect(createMerchantEmailVerificationToken({ ...USER, now: NOW }).jti).not.toBe(link.jti);
  });

  it("never carries the address: neither in the payload nor anywhere in the token", () => {
    const link = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    expect(decodePayload(link.token)).toEqual({ purpose: "merchant_email_verification", userId: USER.userId, exp: link.expiresAt.getTime() / 1_000, jti: link.jti });
    const decodedAll = link.token.split(".").map((part) => Buffer.from(part, "base64url").toString("latin1")).join(" ");
    for (const fragment of ["owner", "example.test", "@"]) {
      expect(link.token).not.toContain(fragment);
      expect(decodedAll).not.toContain(fragment);
    }
  });

  it("is invalidated when the account's address changes", () => {
    const { token } = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    expect(verifyMerchantEmailVerificationToken(token, "changed@example.test", NOW)).toBeNull();
    // Parsing alone never authenticates.
    expect(readMerchantEmailVerificationToken(token, NOW)).not.toBeNull();
  });

  it("compares the MAC in constant time", () => {
    const { token } = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    verifyMerchantEmailVerificationToken(token, USER.email, NOW);
    expect(crypto.timingSafeEqual).toHaveBeenCalledOnce();
  });

  it("rejects an expired link, including exactly at expiry", () => {
    const link = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    expect(verifyMerchantEmailVerificationToken(link.token, USER.email, new Date(link.expiresAt.getTime() - 1_000))).not.toBeNull();
    expect(verifyMerchantEmailVerificationToken(link.token, USER.email, link.expiresAt)).toBeNull();
    expect(readMerchantEmailVerificationToken(link.token, link.expiresAt)).toBeNull();
  });

  it("rejects a tampered payload or MAC", () => {
    const { token } = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    const [version, , signature] = token.split(".");
    const otherUser = Buffer.from(JSON.stringify(validPayload({ userId: "cuid_someone_else" }))).toString("base64url");
    expect(verifyMerchantEmailVerificationToken(`${version}.${otherUser}.${signature}`, USER.email, NOW)).toBeNull();
    const flipped = `${signature!.slice(0, -1)}${signature!.endsWith("A") ? "B" : "A"}`;
    expect(verifyMerchantEmailVerificationToken(`${token.split(".").slice(0, 2).join(".")}.${flipped}`, USER.email, NOW)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(token.replace(/^mev1/u, "mev2"), USER.email, NOW)).toBeNull();
  });

  it("rejects tokens of another purpose: other keys, other payload purposes and registration invites", () => {
    expect(verifyMerchantEmailVerificationToken(forge(validPayload()), USER.email, NOW)).not.toBeNull();
    expect(verifyMerchantEmailVerificationToken(forge(validPayload(), USER.email, "merchant-email-verification-v1"), USER.email, NOW)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(forge(validPayload(), USER.email, "merchant-registration-invite-v2"), USER.email, NOW)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(forge(validPayload({ purpose: "merchant_registration" })), USER.email, NOW)).toBeNull();
    // The old shape with an address in the payload is refused by the strict schema.
    expect(verifyMerchantEmailVerificationToken(forge(validPayload({ email: USER.email })), USER.email, NOW)).toBeNull();
    const invite = createMerchantRegistrationInvite({ email: USER.email, now: NOW }).token;
    expect(verifyMerchantEmailVerificationToken(invite, USER.email, NOW)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(invite.replace(/^mri1/u, "mev1"), USER.email, NOW)).toBeNull();
  });

  it("is signed with a key derived from the deployment secret, so another secret rejects it", () => {
    const { token } = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    vi.stubEnv("CSRF_SECRET", "another-synthetic-secret-also-32-bytes-long");
    expect(verifyMerchantEmailVerificationToken(token, USER.email, NOW)).toBeNull();
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");
    expect(verifyMerchantEmailVerificationToken(token, USER.email, NOW)).toBeNull();
    expect(() => createMerchantEmailVerificationToken({ ...USER, now: NOW })).toThrow();
  });

  it("rejects malformed input without throwing", () => {
    for (const value of [undefined, null, 1, "", "a.b", "a.b.c.d", "mev1..x", `mev1.${"A".repeat(MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH)}.x`]) {
      expect(verifyMerchantEmailVerificationToken(value, USER.email, NOW)).toBeNull();
      expect(readMerchantEmailVerificationToken(value, NOW)).toBeNull();
    }
    expect(verifyMerchantEmailVerificationToken(forge(validPayload({ userId: "not a valid id!" })), USER.email, NOW)).toBeNull();
  });

  it("refuses to sign an invalid user, address or lifetime", () => {
    expect(() => createMerchantEmailVerificationToken({ userId: "bad id", email: USER.email })).toThrow();
    expect(() => createMerchantEmailVerificationToken({ userId: USER.userId, email: "nope" })).toThrow();
    expect(() => createMerchantEmailVerificationToken({ ...USER, ttlMs: 0 })).toThrow();
  });

  it("builds the link on the canonical app URL, pointing at the confirm page", () => {
    const url = new URL(merchantEmailVerificationUrl("mev1.payload.signature", { NEXT_PUBLIC_APP_URL: "https://app.example.test", NODE_ENV: "test" }));
    expect(url.origin).toBe("https://app.example.test");
    expect(url.pathname).toBe("/verify-email");
    expect(url.searchParams.get("token")).toBe("mev1.payload.signature");
  });
});
