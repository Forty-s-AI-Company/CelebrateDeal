import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveSessionSwitchToken,
  createLiveSessionSwitchUrl,
  LIVE_SESSION_SWITCH_TTL_SECONDS,
  liveSessionSwitchRedemptionId,
  verifyLiveSessionSwitchToken,
} from "@/lib/live-session-switch-token";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const NOW = new Date("2026-11-01T02:00:00.000Z");
const BINDING = { vendorId: "vendor_a", submissionId: "submission_a", sessionId: "session_a" };

describe("live session switch token", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "live-session-switch-test-secret-longer-than-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips the binding with a fresh nonce and a 24-hour expiry", () => {
    const first = createLiveSessionSwitchToken(BINDING, NOW);
    const second = createLiveSessionSwitchToken(BINDING, NOW);
    expect(first).not.toBe(second);
    const claim = verifyLiveSessionSwitchToken(first, NOW);
    expect(claim).toEqual({ ...BINDING, nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u), expiresAt: new Date(NOW.getTime() + 24 * 3_600_000) });
    expect(LIVE_SESSION_SWITCH_TTL_SECONDS).toBe(86_400);
    expect(verifyLiveSessionSwitchToken(second, NOW)!.nonce).not.toBe(claim!.nonce);
  });

  it("expires after 24 hours and refuses a lifetime longer than that", () => {
    const token = createLiveSessionSwitchToken(BINDING, NOW);
    expect(verifyLiveSessionSwitchToken(token, new Date(NOW.getTime() + 24 * 3_600_000 - 1_000))).not.toBeNull();
    expect(verifyLiveSessionSwitchToken(token, new Date(NOW.getTime() + 24 * 3_600_000))).toBeNull();
    // Signed "in the future" (a longer lifetime than allowed) is refused too.
    expect(verifyLiveSessionSwitchToken(token, new Date(NOW.getTime() - 60_000))).toBeNull();
  });

  it("refuses tampered claims, other keys, other versions and malformed tokens", () => {
    const token = createLiveSessionSwitchToken(BINDING, NOW);
    const [version, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
    const forged = `${version}.${Buffer.from(JSON.stringify({ ...claims, s: "submission_b" })).toString("base64url")}.${signature}`;
    expect(verifyLiveSessionSwitchToken(forged, NOW)).toBeNull();
    // Signed with another purpose's key (e.g. the registration cookie key).
    const otherKey = createHmac("sha256", deriveSensitiveDataKey("form-submission-chat-session:r2:070a4f7ffaff8f24")).update(`${version}.${payload}`).digest("base64url");
    expect(verifyLiveSessionSwitchToken(`${version}.${payload}.${otherKey}`, NOW)).toBeNull();
    expect(verifyLiveSessionSwitchToken(`lsw2.${payload}.${signature}`, NOW)).toBeNull();
    expect(verifyLiveSessionSwitchToken(`${token}.extra`, NOW)).toBeNull();
    expect(verifyLiveSessionSwitchToken("", NOW)).toBeNull();
    expect(verifyLiveSessionSwitchToken(undefined, NOW)).toBeNull();
    expect(verifyLiveSessionSwitchToken("x".repeat(801), NOW)).toBeNull();
    vi.stubEnv("CSRF_SECRET", "another-root-secret-that-is-longer-than-32-bytes");
    expect(verifyLiveSessionSwitchToken(token, NOW)).toBeNull();
  });

  it("refuses bindings that are not plain ids", () => {
    expect(() => createLiveSessionSwitchToken({ ...BINDING, submissionId: "a/b" }, NOW)).toThrow("Invalid session switch binding.");
    expect(() => createLiveSessionSwitchToken({ ...BINDING, vendorId: "" }, NOW)).toThrow("Invalid session switch binding.");
  });

  it("keys redemptions by a hash of the nonce, never the nonce itself", () => {
    const id = liveSessionSwitchRedemptionId("AAAAAAAAAAAAAAAAAAAAAA");
    expect(id).toMatch(/^[0-9a-f]{64}$/u);
    expect(id).not.toContain("AAAA");
    expect(liveSessionSwitchRedemptionId("AAAAAAAAAAAAAAAAAAAAAA")).toBe(id);
    expect(liveSessionSwitchRedemptionId("AAAAAAAAAAAAAAAAAAAAAB")).not.toBe(id);
  });

  it("links to the confirmation page on the public app URL", () => {
    expect(createLiveSessionSwitchUrl("lsw1.payload.sig", { NEXT_PUBLIC_APP_URL: "https://app.example.test" } as NodeJS.ProcessEnv))
      .toBe("https://app.example.test/live-session-switch?token=lsw1.payload.sig");
    expect(() => createLiveSessionSwitchUrl("t", {} as NodeJS.ProcessEnv)).toThrow("Public application URL is not configured.");
    expect(() => createLiveSessionSwitchUrl("t", { NEXT_PUBLIC_APP_URL: "ftp://files.example.test" } as NodeJS.ProcessEnv)).toThrow("Public application URL is invalid.");
  });
});
