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
  MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH,
  MERCHANT_EMAIL_VERIFICATION_TTL_HOURS,
  MERCHANT_EMAIL_VERIFICATION_TTL_MS,
  merchantEmailVerificationUrl,
  verifyMerchantEmailVerificationToken,
} from "@/lib/merchant-email-verification-token";
import { createMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const SECRET = "synthetic-email-verification-secret-32-bytes";
const NOW = new Date("2026-10-25T00:00:00.000Z");
const USER = { userId: "cuid_synthetic_owner_1", email: "owner@example.test" };

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Signs an arbitrary payload with a real derived key, to test payload rules behind a valid signature. */
function forge(payload: unknown, keyPurpose = "merchant-email-verification-v1", version = "mev1") {
  const body = `${version}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return `${body}.${createHmac("sha256", deriveSensitiveDataKey(keyPurpose)).update(body).digest("base64url")}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return { purpose: "merchant_email_verification", ...USER, exp: Math.floor(NOW.getTime() / 1_000) + 3_600, jti: "synthetic-jti-0123456789", ...overrides };
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", SECRET);
  crypto.timingSafeEqual.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("merchant email verification tokens", () => {
  it("round-trips the user and address with a 24-hour expiry and a random jti", () => {
    const link = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    expect(MERCHANT_EMAIL_VERIFICATION_TTL_HOURS).toBe(24);
    expect(link.expiresAt.getTime()).toBe(NOW.getTime() + MERCHANT_EMAIL_VERIFICATION_TTL_MS);
    expect(link.token).toMatch(/^mev1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    expect(decode(link.token)).toEqual({ purpose: "merchant_email_verification", ...USER, exp: link.expiresAt.getTime() / 1_000, jti: link.jti });
    expect(verifyMerchantEmailVerificationToken(link.token, NOW)).toEqual({ ...USER, expiresAt: link.expiresAt, jti: link.jti });
    expect(createMerchantEmailVerificationToken({ ...USER, now: NOW }).jti).not.toBe(link.jti);
  });

  it("compares the signature in constant time", () => {
    const { token } = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    verifyMerchantEmailVerificationToken(token, NOW);
    expect(crypto.timingSafeEqual).toHaveBeenCalledOnce();
  });

  it("rejects an expired link, including exactly at expiry", () => {
    const link = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    expect(verifyMerchantEmailVerificationToken(link.token, new Date(link.expiresAt.getTime() - 1_000))).not.toBeNull();
    expect(verifyMerchantEmailVerificationToken(link.token, link.expiresAt)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(link.token, new Date(NOW.getTime() + 25 * 60 * 60 * 1_000))).toBeNull();
  });

  it("rejects a tampered payload or signature", () => {
    const { token } = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    const [version, , signature] = token.split(".");
    const otherPayload = Buffer.from(JSON.stringify(validPayload({ email: "attacker@example.test" }))).toString("base64url");
    expect(verifyMerchantEmailVerificationToken(`${version}.${otherPayload}.${signature}`, NOW)).toBeNull();
    const flipped = `${signature!.slice(0, -1)}${signature!.endsWith("A") ? "B" : "A"}`;
    expect(verifyMerchantEmailVerificationToken(`${token.split(".").slice(0, 2).join(".")}.${flipped}`, NOW)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(token.replace(/^mev1/u, "mev2"), NOW)).toBeNull();
  });

  it("rejects tokens of another purpose: other keys, other payload purposes and registration invites", () => {
    expect(verifyMerchantEmailVerificationToken(forge(validPayload()), NOW)).not.toBeNull();
    expect(verifyMerchantEmailVerificationToken(forge(validPayload(), "merchant-registration-invite-v2"), NOW)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(forge(validPayload({ purpose: "merchant_registration" })), NOW)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(forge(validPayload({ extra: true })), NOW)).toBeNull();
    const invite = createMerchantRegistrationInvite({ email: USER.email, now: NOW }).token;
    expect(verifyMerchantEmailVerificationToken(invite, NOW)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(invite.replace(/^mri1/u, "mev1"), NOW)).toBeNull();
  });

  it("is signed with a key derived from the deployment secret, so another secret rejects it", () => {
    const { token } = createMerchantEmailVerificationToken({ ...USER, now: NOW });
    vi.stubEnv("CSRF_SECRET", "another-synthetic-secret-also-32-bytes-long");
    expect(verifyMerchantEmailVerificationToken(token, NOW)).toBeNull();
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");
    expect(verifyMerchantEmailVerificationToken(token, NOW)).toBeNull();
    expect(() => createMerchantEmailVerificationToken({ ...USER, now: NOW })).toThrow();
  });

  it("rejects malformed input without throwing", () => {
    for (const value of [undefined, null, 1, "", "a.b", "a.b.c.d", "mev1..x", `mev1.${"A".repeat(MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH)}.x`]) {
      expect(verifyMerchantEmailVerificationToken(value, NOW)).toBeNull();
    }
    expect(verifyMerchantEmailVerificationToken(forge(validPayload({ userId: "not a valid id!" })), NOW)).toBeNull();
    expect(verifyMerchantEmailVerificationToken(forge(validPayload({ email: "not-an-email" })), NOW)).toBeNull();
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
