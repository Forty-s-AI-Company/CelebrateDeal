import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  crypto.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: crypto.timingSafeEqual };
});

import {
  createMerchantRegistrationInvite,
  MERCHANT_REGISTRATION_INVITE_MAX_LENGTH,
  MERCHANT_REGISTRATION_INVITE_TTL_DAYS,
  MERCHANT_REGISTRATION_INVITE_TTL_MS,
  merchantRegistrationInviteMatchesEmail,
  merchantRegistrationInviteUrl,
  normalizeMerchantRegistrationEmail,
  verifyMerchantRegistrationInvite,
} from "@/lib/merchant-registration-invite";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const SECRET = "synthetic-invite-test-secret-at-least-32-bytes";
const NOW = new Date("2026-10-25T00:00:00.000Z");

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Re-sign an arbitrary payload with the real derived key, to test payload rules behind a valid signature. */
function forge(payload: unknown, version = "mri1", keyPurpose = "merchant-registration-invite-v2") {
  const body = `${version}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return `${body}.${createHmac("sha256", deriveSensitiveDataKey(keyPurpose)).update(body).digest("base64url")}`;
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", SECRET);
  crypto.timingSafeEqual.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("merchant registration invite tokens", () => {
  it("round-trips a normalised email with a 14-day expiry and a random jti", () => {
    const invite = createMerchantRegistrationInvite({ email: "  Owner@Example.TEST ", now: NOW });
    expect(MERCHANT_REGISTRATION_INVITE_TTL_DAYS).toBe(14);
    expect(invite.email).toBe("owner@example.test");
    expect(invite.expiresAt.getTime()).toBe(NOW.getTime() + MERCHANT_REGISTRATION_INVITE_TTL_MS);
    expect(invite.token).toMatch(/^mri1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    expect(decode(invite.token)).toEqual({ purpose: "merchant_registration", email: "owner@example.test", exp: invite.expiresAt.getTime() / 1_000, jti: invite.jti });
    expect(verifyMerchantRegistrationInvite(invite.token, NOW)).toEqual({ email: "owner@example.test", expiresAt: invite.expiresAt, jti: invite.jti });
    expect(createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW }).jti).not.toBe(invite.jti);
  });

  it("compares signatures in constant time", () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW });
    verifyMerchantRegistrationInvite(token, NOW);
    expect(crypto.timingSafeEqual).toHaveBeenCalledOnce();
  });

  it("rejects an expired token at and after its expiry", () => {
    const invite = createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW });
    expect(verifyMerchantRegistrationInvite(invite.token, new Date(invite.expiresAt.getTime() - 1_000))).not.toBeNull();
    expect(verifyMerchantRegistrationInvite(invite.token, invite.expiresAt)).toBeNull();
    expect(verifyMerchantRegistrationInvite(invite.token, new Date(invite.expiresAt.getTime() + 1))).toBeNull();
  });

  it("rejects a tampered payload even when it stays well formed", () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW });
    const [version, , signature] = token.split(".");
    const payload = { ...decode(token), email: "attacker@example.test" };
    const tampered = `${version}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    expect(verifyMerchantRegistrationInvite(tampered, NOW)).toBeNull();
    const extended = `${version}.${Buffer.from(JSON.stringify({ ...decode(token), exp: 9_999_999_999 })).toString("base64url")}.${signature}`;
    expect(verifyMerchantRegistrationInvite(extended, NOW)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW });
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(verifyMerchantRegistrationInvite(`${token.slice(0, -1)}${last}`, NOW)).toBeNull();
    expect(verifyMerchantRegistrationInvite(`${token.slice(0, -1)}`, NOW)).toBeNull();
  });

  it("rejects a token signed with another secret or another derived key", () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW });
    vi.stubEnv("CSRF_SECRET", "another-synthetic-secret-also-32-bytes-long");
    expect(verifyMerchantRegistrationInvite(token, NOW)).toBeNull();
    vi.stubEnv("CSRF_SECRET", SECRET);
    const payload = decode(token);
    expect(verifyMerchantRegistrationInvite(forge(payload, "mri1", "form-submission-email-verification"), NOW)).toBeNull();
    // The pre-fix purpose label must never sign a valid invitation.
    expect(verifyMerchantRegistrationInvite(forge(payload, "mri1", "merchant-registration-invite"), NOW)).toBeNull();
    expect(verifyMerchantRegistrationInvite(forge(payload), NOW)).not.toBeNull();
  });

  it("rejects a validly signed token issued for another purpose or with unexpected fields", () => {
    const payload = decode(createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW }).token);
    expect(verifyMerchantRegistrationInvite(forge({ ...payload, purpose: "vendor_member_invitation" }), NOW)).toBeNull();
    expect(verifyMerchantRegistrationInvite(forge({ ...payload, role: "platform_admin" }), NOW)).toBeNull();
    expect(verifyMerchantRegistrationInvite(forge({ ...payload, email: "Owner@Example.test" }), NOW)).toBeNull();
    expect(verifyMerchantRegistrationInvite(forge({ ...payload, email: "not-an-email" }), NOW)).toBeNull();
    expect(verifyMerchantRegistrationInvite(forge({ ...payload, exp: "9999999999" }), NOW)).toBeNull();
    expect(verifyMerchantRegistrationInvite(forge({ ...payload, jti: "short" }), NOW)).toBeNull();
    expect(verifyMerchantRegistrationInvite(forge(payload, "mri2"), NOW)).toBeNull();
    expect(verifyMerchantRegistrationInvite(forge("just a string"), NOW)).toBeNull();
  });

  it("rejects malformed input before computing a signature", () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW });
    crypto.timingSafeEqual.mockClear();
    for (const value of [undefined, null, 42, "", "mri1", "mri1.abc", `${token}.extra`, token.replace("mri1", "mri0"), `mri1.${"a".repeat(MERCHANT_REGISTRATION_INVITE_MAX_LENGTH)}.${"b".repeat(43)}`, "mri1.has space.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "mri1.e30.short"]) {
      expect(verifyMerchantRegistrationInvite(value, NOW)).toBeNull();
    }
    expect(crypto.timingSafeEqual).not.toHaveBeenCalled();
    // A well-formed body with a valid signature over invalid JSON is still rejected.
    const body = `mri1.${Buffer.from("{not json").toString("base64url")}`;
    const signed = `${body}.${createHmac("sha256", deriveSensitiveDataKey("merchant-registration-invite-v2")).update(body).digest("base64url")}`;
    expect(verifyMerchantRegistrationInvite(signed, NOW)).toBeNull();
  });

  it("fails closed when the signing secret is missing or too short", () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW });
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");
    expect(verifyMerchantRegistrationInvite(token, NOW)).toBeNull();
    expect(() => createMerchantRegistrationInvite({ email: "owner@example.test" })).toThrow();
    vi.stubEnv("CSRF_SECRET", "too-short");
    expect(verifyMerchantRegistrationInvite(token, NOW)).toBeNull();
  });

  it("refuses to sign an invalid email or lifetime", () => {
    expect(() => createMerchantRegistrationInvite({ email: "not-an-email" })).toThrow("Invalid merchant registration invite email.");
    expect(() => createMerchantRegistrationInvite({ email: `${"a".repeat(320)}@example.test` })).toThrow();
    expect(() => createMerchantRegistrationInvite({ email: "owner@example.test", ttlMs: 0 })).toThrow("Invalid merchant registration invite lifetime.");
  });

  it("matches the submitted email with the registration normalisation", () => {
    const invite = verifyMerchantRegistrationInvite(createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW }).token, NOW)!;
    expect(normalizeMerchantRegistrationEmail("  MiXeD@Example.Test\t")).toBe("mixed@example.test");
    expect(merchantRegistrationInviteMatchesEmail(invite, " OWNER@example.test ")).toBe(true);
    expect(merchantRegistrationInviteMatchesEmail(invite, "owner+1@example.test")).toBe(false);
  });

  it("builds the link on the canonical app URL only", () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test", now: NOW });
    const url = new URL(merchantRegistrationInviteUrl(token, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://app.example.test/ignored/path" } as NodeJS.ProcessEnv));
    expect(url.origin).toBe("https://app.example.test");
    expect(url.pathname).toBe("/register");
    expect(url.searchParams.get("invite")).toBe(token);
    expect(() => merchantRegistrationInviteUrl(token, { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow();
  });
});
