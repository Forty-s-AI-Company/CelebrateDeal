import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormSubmissionChatSessionToken, verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { createLiveSessionSwitchToken, verifyLiveSessionSwitchToken } from "@/lib/live-session-switch-token";
import {
  appendPersonalWatchLink,
  createLiveWatchLinkToken,
  createLiveWatchLinkUrl,
  LIVE_WATCH_LINK_MAX_LIFETIME_SECONDS,
  LIVE_WATCH_LINK_TTL_AFTER_START_SECONDS,
  PERSONAL_WATCH_LINK_LABEL,
  verifyLiveWatchLinkToken,
} from "@/lib/live-watch-link-token";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const NOW = new Date("2026-11-01T02:00:00.000Z");
const DAY = 24 * 3_600_000;
const START = new Date(NOW.getTime() + 3 * DAY);
const BINDING = { vendorId: "vendor_a", liveId: "live_a", submissionId: "submission_a", sessionStartAt: START };

function split(token: string) {
  const [version, payload, signature] = token.split(".");
  return { version: version!, payload: payload!, signature: signature! };
}

describe("personal watch link token (Q-17)", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "live-watch-link-test-secret-longer-than-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  it("binds vendor, Live and registration, and expires 30 days after the session start", () => {
    const token = createLiveWatchLinkToken(BINDING, NOW);
    expect(LIVE_WATCH_LINK_TTL_AFTER_START_SECONDS).toBe(30 * 86_400);
    expect(verifyLiveWatchLinkToken(token, NOW)).toEqual({
      status: "valid",
      claim: { vendorId: "vendor_a", liveId: "live_a", submissionId: "submission_a", expiresAt: new Date(START.getTime() + 30 * DAY) },
    });
    // Anchored to the session, not to when the message was written: every
    // rendering of one reminder carries the same link.
    expect(createLiveWatchLinkToken(BINDING, new Date(NOW.getTime() + DAY))).toBe(token);
    // Each registration gets its own link.
    expect(createLiveWatchLinkToken({ ...BINDING, submissionId: "submission_b" }, NOW)).not.toBe(token);
    // No e-mail or other personal data: only the three ids and the expiry.
    expect(Object.keys(JSON.parse(Buffer.from(split(token).payload, "base64url").toString("utf8")))).toEqual(["v", "l", "s", "e"]);
  });

  it("counts from now for a session that already started, and caps the lifetime", () => {
    const started = createLiveWatchLinkToken({ ...BINDING, sessionStartAt: new Date(NOW.getTime() - 2 * 3_600_000) }, NOW);
    expect(verifyLiveWatchLinkToken(started, NOW)?.claim.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    const farFuture = createLiveWatchLinkToken({ ...BINDING, sessionStartAt: new Date(NOW.getTime() + 2_000 * DAY) }, NOW);
    expect(verifyLiveWatchLinkToken(farFuture, NOW)?.claim.expiresAt).toEqual(new Date(NOW.getTime() + LIVE_WATCH_LINK_MAX_LIFETIME_SECONDS * 1_000));
  });

  it("reports a genuine link past its expiry as expired, and refuses a lifetime beyond the cap", () => {
    const token = createLiveWatchLinkToken(BINDING, NOW);
    const expiry = START.getTime() + 30 * DAY;
    expect(verifyLiveWatchLinkToken(token, new Date(expiry - 1_000))?.status).toBe("valid");
    expect(verifyLiveWatchLinkToken(token, new Date(expiry))).toEqual({ status: "expired", claim: expect.objectContaining({ submissionId: "submission_a" }) });
    // Opened long before it could have been issued: longer than any link may live.
    expect(verifyLiveWatchLinkToken(token, new Date(expiry - LIVE_WATCH_LINK_MAX_LIFETIME_SECONDS * 1_000 - 1_000))).toBeNull();
  });

  it("refuses tampered claims, other keys, other versions, other token types and malformed tokens", () => {
    const token = createLiveWatchLinkToken(BINDING, NOW);
    const { version, payload, signature } = split(token);
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    for (const change of [{ s: "submission_b" }, { l: "live_b" }, { v: "vendor_b" }, { e: (claims.e as number) + 86_400 }]) {
      const forged = `${version}.${Buffer.from(JSON.stringify({ ...claims, ...change })).toString("base64url")}.${signature}`;
      expect(verifyLiveWatchLinkToken(forged, NOW), JSON.stringify(change)).toBeNull();
    }
    // The same payload MACed with another purpose's key (purpose separation).
    for (const purpose of ["form-submission-chat-session:r2:070a4f7ffaff8f24", "live-session-switch:r2:fb3e6e707aa6bd7b", "live-watch-link"]) {
      const otherKey = createHmac("sha256", deriveSensitiveDataKey(purpose)).update(`${version}.${payload}`).digest("base64url");
      expect(verifyLiveWatchLinkToken(`${version}.${payload}.${otherKey}`, NOW), purpose).toBeNull();
    }
    expect(verifyLiveWatchLinkToken(`lwl2.${payload}.${signature}`, NOW)).toBeNull();
    expect(verifyLiveWatchLinkToken(`${token}.extra`, NOW)).toBeNull();
    expect(verifyLiveWatchLinkToken("", NOW)).toBeNull();
    expect(verifyLiveWatchLinkToken(null, NOW)).toBeNull();
    expect(verifyLiveWatchLinkToken("x".repeat(601), NOW)).toBeNull();
    vi.stubEnv("CSRF_SECRET", "another-root-secret-that-is-longer-than-32-bytes");
    expect(verifyLiveWatchLinkToken(token, NOW)).toBeNull();
  });

  it("is not interchangeable with the registration cookie or the session switch link", () => {
    const watch = createLiveWatchLinkToken(BINDING, NOW);
    const cookie = createFormSubmissionChatSessionToken({ submissionId: "submission_a", now: NOW });
    const switchLink = createLiveSessionSwitchToken({ vendorId: "vendor_a", submissionId: "submission_a", sessionId: "session_a" }, NOW);
    expect(verifyLiveWatchLinkToken(cookie, NOW)).toBeNull();
    expect(verifyLiveWatchLinkToken(switchLink, NOW)).toBeNull();
    expect(verifyFormSubmissionChatSessionToken(watch, NOW)).toBeNull();
    expect(verifyLiveSessionSwitchToken(watch, NOW)).toBeNull();
  });

  it("refuses bindings that are not plain ids", () => {
    expect(() => createLiveWatchLinkToken({ ...BINDING, submissionId: "a/b" }, NOW)).toThrow("Invalid watch link binding.");
    expect(() => createLiveWatchLinkToken({ ...BINDING, liveId: "" }, NOW)).toThrow("Invalid watch link binding.");
    expect(() => createLiveWatchLinkToken({ ...BINDING, vendorId: "v".repeat(129) }, NOW)).toThrow("Invalid watch link binding.");
  });

  it("builds the link on the canonical app URL and appends it as its own labelled line", () => {
    const url = new URL(createLiveWatchLinkUrl(BINDING, NOW, { NEXT_PUBLIC_APP_URL: "https://app.example.test", NODE_ENV: "test" } as NodeJS.ProcessEnv));
    expect(url.origin).toBe("https://app.example.test");
    expect(url.pathname).toBe("/api/live-watch-link");
    expect([...url.searchParams.keys()]).toEqual(["token"]);
    expect(verifyLiveWatchLinkToken(url.searchParams.get("token"), NOW)?.status).toBe("valid");
    expect(appendPersonalWatchLink("  內文  ", "https://x.test/a")).toBe(`內文\n\n${PERSONAL_WATCH_LINK_LABEL}：https://x.test/a`);
    expect(appendPersonalWatchLink("", "https://x.test/a")).toBe(`${PERSONAL_WATCH_LINK_LABEL}：https://x.test/a`);
  });
});
