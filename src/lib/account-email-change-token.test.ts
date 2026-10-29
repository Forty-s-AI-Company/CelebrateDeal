import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  crypto.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: crypto.timingSafeEqual };
});

import {
  ACCOUNT_EMAIL_CHANGE_KEY_PURPOSE,
  ACCOUNT_EMAIL_CHANGE_MAX_LENGTH,
  ACCOUNT_EMAIL_CHANGE_PATH,
  ACCOUNT_EMAIL_CHANGE_TTL_MINUTES,
  ACCOUNT_EMAIL_CHANGE_TTL_MS,
  accountEmailChangeTokenHash,
  accountEmailChangeUrl,
  createAccountEmailChangeToken,
  normalizeLoginEmail,
  readAccountEmailChangeToken,
  verifyAccountEmailChangeToken,
} from "@/lib/account-email-change-token";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-purposes";
import { createMerchantEmailVerificationToken, MERCHANT_EMAIL_VERIFICATION_KEY_PURPOSE } from "@/lib/merchant-email-verification-token";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const SECRET = "synthetic-account-email-change-secret-32b";
const NOW = new Date("2026-10-30T00:00:00.000Z");
const CHANGE = { userId: "cuid_synthetic_owner_1", newEmail: "new-owner@example.test" };

function decodePayload(token: string) {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Signs an arbitrary payload for `newEmail` with a real derived key, to test payload rules behind a valid MAC. */
function forge(payload: unknown, newEmail = CHANGE.newEmail, keyPurpose = ACCOUNT_EMAIL_CHANGE_KEY_PURPOSE, version = "aec1") {
  const body = `${version}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  const mac = createHmac("sha256", deriveSensitiveDataKey(keyPurpose)).update(`${version}-mac:`).update(body).update("\u0000").update(newEmail).digest("base64url");
  return `${body}.${mac}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return { purpose: "account_email_change", userId: CHANGE.userId, exp: Math.floor(NOW.getTime() / 1_000) + 600, jti: "synthetic-jti-0123456789", ...overrides };
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", SECRET);
  crypto.timingSafeEqual.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("account email change key", () => {
  it("uses an unguessable, single-purpose label registered without a legacy key", () => {
    expect(ACCOUNT_EMAIL_CHANGE_KEY_PURPOSE).toMatch(/^account-email-change:r2:[0-9a-f]{16}$/u);
    expect(DERIVED_KEY_ROTATIONS.accountEmailChange).toEqual({ label: "account-email-change", current: "account-email-change:r2:a8a788e3ba38de72", legacy: null });
    expect(ACCOUNT_EMAIL_CHANGE_KEY_PURPOSE).not.toBe(MERCHANT_EMAIL_VERIFICATION_KEY_PURPOSE);
  });

  it("keeps a golden derived key and MAC, so the key and the token format cannot change silently", () => {
    vi.stubEnv("CSRF_SECRET", "synthetic-kdf-golden-root-secret-0123456789");
    expect(deriveSensitiveDataKey(ACCOUNT_EMAIL_CHANGE_KEY_PURPOSE).toString("hex")).toBe("2feb0b738fee9812061467f65792776873cdd5d5d93279e9a5c0955f7a0d83fa");
    const golden = "aec1.eyJwdXJwb3NlIjoiYWNjb3VudF9lbWFpbF9jaGFuZ2UiLCJ1c2VySWQiOiJjdWlkX2dvbGRlbl91c2VyIiwiZXhwIjo0MTAyNDQ0ODAwLCJqdGkiOiJnb2xkZW4tanRpLTAxMjM0NTY3ODkifQ.pIhU1Xwyadx-g0XxW_EBRNiuzDutESdCdyAbyc9pzMM";
    expect(verifyAccountEmailChangeToken(golden, "new@example.test", NOW)).toEqual({ userId: "cuid_golden_user", expiresAt: new Date(4102444800 * 1_000), jti: "golden-jti-0123456789" });
    expect(verifyAccountEmailChangeToken(golden, "other@example.test", NOW)).toBeNull();
  });
});

describe("account email change tokens", () => {
  it("round-trips the user with a 60-minute expiry, a random jti and the SHA-256 the table stores", () => {
    const link = createAccountEmailChangeToken({ ...CHANGE, now: NOW });
    expect(ACCOUNT_EMAIL_CHANGE_TTL_MINUTES).toBe(60);
    expect(link.expiresAt.getTime()).toBe(NOW.getTime() + ACCOUNT_EMAIL_CHANGE_TTL_MS);
    expect(link.token).toMatch(/^aec1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    expect(link.tokenHash).toBe(createHash("sha256").update(link.token).digest("hex"));
    expect(link.tokenHash).toBe(accountEmailChangeTokenHash(link.token));
    expect(link.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    const expected = { userId: CHANGE.userId, expiresAt: link.expiresAt, jti: link.jti };
    expect(verifyAccountEmailChangeToken(link.token, CHANGE.newEmail, NOW)).toEqual(expected);
    expect(readAccountEmailChangeToken(link.token, NOW)).toEqual(expected);
    const second = createAccountEmailChangeToken({ ...CHANGE, now: NOW });
    expect(second.jti).not.toBe(link.jti);
    expect(second.tokenHash).not.toBe(link.tokenHash);
  });

  it("never carries the new address in the token", () => {
    const link = createAccountEmailChangeToken({ ...CHANGE, now: NOW });
    expect(decodePayload(link.token)).toEqual({ purpose: "account_email_change", userId: CHANGE.userId, exp: link.expiresAt.getTime() / 1_000, jti: link.jti });
    const decodedAll = link.token.split(".").map((part) => Buffer.from(part, "base64url").toString("latin1")).join(" ");
    for (const fragment of [CHANGE.newEmail, "new-owner", "example.test"]) {
      expect(link.token).not.toContain(fragment);
      expect(decodedAll).not.toContain(fragment);
    }
  });

  it("is bound to the new address: any other address fails the MAC, and parsing alone never authenticates", () => {
    const { token } = createAccountEmailChangeToken({ ...CHANGE, now: NOW });
    expect(verifyAccountEmailChangeToken(token, "attacker@example.test", NOW)).toBeNull();
    expect(verifyAccountEmailChangeToken(token, CHANGE.newEmail.toUpperCase(), NOW)).toBeNull();
    expect(readAccountEmailChangeToken(token, NOW)).not.toBeNull();
  });

  it("compares the MAC in constant time", () => {
    const { token } = createAccountEmailChangeToken({ ...CHANGE, now: NOW });
    verifyAccountEmailChangeToken(token, CHANGE.newEmail, NOW);
    expect(crypto.timingSafeEqual).toHaveBeenCalledOnce();
  });

  it("rejects an expired link, including exactly at expiry", () => {
    const link = createAccountEmailChangeToken({ ...CHANGE, now: NOW });
    expect(verifyAccountEmailChangeToken(link.token, CHANGE.newEmail, new Date(link.expiresAt.getTime() - 1_000))).not.toBeNull();
    expect(verifyAccountEmailChangeToken(link.token, CHANGE.newEmail, link.expiresAt)).toBeNull();
    expect(readAccountEmailChangeToken(link.token, link.expiresAt)).toBeNull();
  });

  it("rejects a tampered payload or MAC", () => {
    const { token } = createAccountEmailChangeToken({ ...CHANGE, now: NOW });
    const [version, , signature] = token.split(".");
    const otherUser = Buffer.from(JSON.stringify(validPayload({ userId: "cuid_someone_else" }))).toString("base64url");
    expect(verifyAccountEmailChangeToken(`${version}.${otherUser}.${signature}`, CHANGE.newEmail, NOW)).toBeNull();
    const flipped = `${signature!.slice(0, -1)}${signature!.endsWith("A") ? "B" : "A"}`;
    expect(verifyAccountEmailChangeToken(`${token.split(".").slice(0, 2).join(".")}.${flipped}`, CHANGE.newEmail, NOW)).toBeNull();
    expect(verifyAccountEmailChangeToken(token.replace(/^aec1/u, "aec2"), CHANGE.newEmail, NOW)).toBeNull();
  });

  it("rejects tokens of another purpose: other keys, other payload purposes and merchant verification links", () => {
    expect(verifyAccountEmailChangeToken(forge(validPayload()), CHANGE.newEmail, NOW)).not.toBeNull();
    expect(verifyAccountEmailChangeToken(forge(validPayload(), CHANGE.newEmail, MERCHANT_EMAIL_VERIFICATION_KEY_PURPOSE), CHANGE.newEmail, NOW)).toBeNull();
    expect(verifyAccountEmailChangeToken(forge(validPayload(), CHANGE.newEmail, "account-email-change"), CHANGE.newEmail, NOW)).toBeNull();
    expect(verifyAccountEmailChangeToken(forge(validPayload({ purpose: "merchant_email_verification" })), CHANGE.newEmail, NOW)).toBeNull();
    // An address in the payload is refused by the strict schema even behind a valid MAC.
    expect(verifyAccountEmailChangeToken(forge(validPayload({ newEmail: CHANGE.newEmail })), CHANGE.newEmail, NOW)).toBeNull();
    // A merchant verification link for the same address, relabelled, never passes.
    const merchant = createMerchantEmailVerificationToken({ userId: CHANGE.userId, email: CHANGE.newEmail, now: NOW }).token;
    expect(verifyAccountEmailChangeToken(merchant, CHANGE.newEmail, NOW)).toBeNull();
    expect(verifyAccountEmailChangeToken(merchant.replace(/^mev1/u, "aec1"), CHANGE.newEmail, NOW)).toBeNull();
  });

  it("is signed with a key derived from the deployment secret, so another secret rejects it", () => {
    const { token } = createAccountEmailChangeToken({ ...CHANGE, now: NOW });
    vi.stubEnv("CSRF_SECRET", "another-synthetic-secret-also-32-bytes-long");
    expect(verifyAccountEmailChangeToken(token, CHANGE.newEmail, NOW)).toBeNull();
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");
    expect(verifyAccountEmailChangeToken(token, CHANGE.newEmail, NOW)).toBeNull();
    expect(() => createAccountEmailChangeToken({ ...CHANGE, now: NOW })).toThrow();
  });

  it("rejects malformed input without throwing", () => {
    for (const value of [undefined, null, 1, "", "a.b", "a.b.c.d", "aec1..x", `aec1.${"A".repeat(ACCOUNT_EMAIL_CHANGE_MAX_LENGTH)}.x`]) {
      expect(verifyAccountEmailChangeToken(value, CHANGE.newEmail, NOW)).toBeNull();
      expect(readAccountEmailChangeToken(value, NOW)).toBeNull();
    }
    expect(verifyAccountEmailChangeToken(forge(validPayload({ userId: "not a valid id!" })), CHANGE.newEmail, NOW)).toBeNull();
    expect(verifyAccountEmailChangeToken(forge(validPayload({ exp: -1 })), CHANGE.newEmail, NOW)).toBeNull();
  });

  it("refuses to sign an invalid user, an unnormalized or invalid address, or a bad lifetime", () => {
    expect(() => createAccountEmailChangeToken({ userId: "bad id", newEmail: CHANGE.newEmail })).toThrow();
    expect(() => createAccountEmailChangeToken({ userId: CHANGE.userId, newEmail: "nope" })).toThrow();
    // Only the normalized form that will be stored can be bound.
    expect(() => createAccountEmailChangeToken({ userId: CHANGE.userId, newEmail: " New-Owner@Example.test " })).toThrow();
    expect(() => createAccountEmailChangeToken({ ...CHANGE, ttlMs: 0 })).toThrow();
    expect(() => createAccountEmailChangeToken({ ...CHANGE, ttlMs: Number.NaN })).toThrow();
  });

  it("builds the link on the canonical app URL, pointing at the confirm page", () => {
    const url = new URL(accountEmailChangeUrl("aec1.payload.signature", { NEXT_PUBLIC_APP_URL: "https://app.example.test", NODE_ENV: "test" }));
    expect(url.origin).toBe("https://app.example.test");
    expect(url.pathname).toBe(ACCOUNT_EMAIL_CHANGE_PATH);
    expect(url.pathname).toBe("/verify-email-change");
    expect(url.searchParams.get("token")).toBe("aec1.payload.signature");
  });
});

describe("normalizing a new login email (the registration rule)", () => {
  it("trims and lowercases a valid address", () => {
    expect(normalizeLoginEmail("  New.Owner+Tag@Example.TEST ")).toBe("new.owner+tag@example.test");
    expect(normalizeLoginEmail("a@b.co")).toBe("a@b.co");
  });

  it("rejects non-strings, empty input, invalid addresses and anything over 320 characters", () => {
    for (const value of [undefined, null, 42, {}, "", "   ", "not-an-email", "a@", "@example.test", "two@@example.test", "spa ce@example.test"]) {
      expect(normalizeLoginEmail(value)).toBeNull();
    }
    const local = "a".repeat(64);
    const longDomain = `${Array.from({ length: 5 }, () => "b".repeat(60)).join(".")}.test`;
    const tooLong = `${local}@${longDomain}`;
    expect(tooLong.length).toBeGreaterThan(320);
    expect(normalizeLoginEmail(tooLong)).toBeNull();
    // The same shape within the bound is accepted, so the length is what refused it.
    const withinBound = `${local}@${Array.from({ length: 3 }, () => "b".repeat(60)).join(".")}.test`;
    expect(withinBound.length).toBeLessThanOrEqual(320);
    expect(normalizeLoginEmail(withinBound)).toBe(withinBound);
  });
});
