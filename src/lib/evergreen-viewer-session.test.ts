import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEvergreenSessionToken,
  evergreenScheduleForLive,
  EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS,
  evergreenSessionCookieMaxAgeSeconds,
  evergreenSessionCookieName,
  evergreenSessionCookieOptions,
  evergreenSessionTokenFromCookieHeader,
  evergreenSessionTokenFromRequest,
  publicEvergreenSession,
  resolveEvergreenViewerSession,
  resolveViewerLiveRuntime,
  verifyEvergreenSessionToken,
  type EvergreenLiveRecord,
} from "@/lib/evergreen-viewer-session";

const ENTERED_AT = new Date("2026-10-29T06:03:00.000Z");

function evergreenLive(overrides: Partial<EvergreenLiveRecord> = {}): EvergreenLiveRecord & {
  scheduledAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
} {
  return {
    id: "live-evergreen-1",
    vendorId: "vendor-1",
    status: "scheduled",
    streamMode: "vod",
    isEvergreen: true,
    evergreenScheduleMode: "just_in_time",
    evergreenIntervalMinutes: 15,
    evergreenDailyTimes: [],
    evergreenSessionStartAt: null,
    replayEnabled: false,
    replayAvailableUntil: null,
    video: { durationSec: 1_800 },
    scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

function claim(live = evergreenLive(), now = ENTERED_AT, token: string | null = null) {
  const session = resolveEvergreenViewerSession({ live, vendorTimezone: "Asia/Taipei", token, intent: "claim", now });
  if (!session) throw new Error("Expected an evergreen session");
  return session;
}

function read(token: string | null, now: Date, live = evergreenLive()) {
  return resolveEvergreenViewerSession({ live, vendorTimezone: "Asia/Taipei", token, intent: "read", now });
}

function reencode(token: string, change: (claims: Record<string, unknown>) => void) {
  const [version, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
  change(claims);
  return `${version}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.${signature}`;
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-evergreen-session-root-secret-0123456789");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("evergreen schedule activation", () => {
  it("only governs an evergreen VOD the merchant has not ended", () => {
    expect(evergreenScheduleForLive(evergreenLive(), "Asia/Taipei")).toMatchObject({ mode: "just_in_time", durationSeconds: 1_800, timezone: "Asia/Taipei" });
    expect(evergreenScheduleForLive(evergreenLive({ isEvergreen: false }), "Asia/Taipei")).toBeNull();
    expect(evergreenScheduleForLive(evergreenLive({ streamMode: "live" }), "Asia/Taipei")).toBeNull();
    expect(evergreenScheduleForLive(evergreenLive({ status: "ended" }), "Asia/Taipei")).toBeNull();
    expect(evergreenScheduleForLive(evergreenLive({ video: null }), "Asia/Taipei")).toBeNull();
    expect(evergreenScheduleForLive(evergreenLive({ video: { durationSec: 0 } }), "Asia/Taipei")).toBeNull();
    expect(evergreenScheduleForLive(evergreenLive({ evergreenScheduleMode: "mystery" }), "Asia/Taipei")).toBeNull();
    expect(evergreenScheduleForLive(evergreenLive({ evergreenScheduleMode: "recurring_daily", evergreenDailyTimes: [] }), "Asia/Taipei")).toBeNull();
    expect(evergreenScheduleForLive(evergreenLive({ evergreenScheduleMode: "recurring_daily", evergreenDailyTimes: ["25:00"] }), "Asia/Taipei")).toBeNull();
  });

  it("falls back to Asia/Taipei for an invalid merchant timezone", () => {
    expect(evergreenScheduleForLive(evergreenLive(), "Not/AZone")?.timezone).toBe("Asia/Taipei");
  });
});

describe("per-visitor evergreen session", () => {
  it("assigns the next cohort once and keeps it stable across refreshes", () => {
    const first = claim();
    expect(first.assigned).toBe(true);
    expect(first.sessionStartAt.toISOString()).toBe("2026-10-29T06:15:00.000Z");
    expect(first.runtimeState).toBe("waiting");
    expect(first.issuedToken).toEqual(expect.any(String));

    // Refreshing later with the cookie keeps the original cohort and plays from its offset.
    const later = read(first.issuedToken, new Date("2026-10-29T06:20:00.000Z"));
    expect(later).toMatchObject({ assigned: true, runtimeState: "playing", issuedToken: null });
    expect(later?.sessionStartAt.toISOString()).toBe("2026-10-29T06:15:00.000Z");
    expect(later?.playback.offsetSeconds).toBe(300);

    // A repeated claim never reassigns an existing session.
    const again = claim(evergreenLive(), new Date("2026-10-29T06:20:00.000Z"), first.issuedToken);
    expect(again.issuedToken).toBeNull();
    expect(again.sessionStartAt.toISOString()).toBe("2026-10-29T06:15:00.000Z");
  });

  it("never assigns from a read and previews the cohort a new visitor would get", () => {
    const preview = read(null, new Date("2026-10-29T06:20:00.000Z"));
    expect(preview).toMatchObject({ assigned: false, runtimeState: "waiting", issuedToken: null, canRejoin: false });
    expect(preview?.sessionStartAt.toISOString()).toBe("2026-10-29T06:30:00.000Z");
  });

  it("starts on-demand at the first entry", () => {
    const live = evergreenLive({ evergreenScheduleMode: "on_demand" });
    const first = claim(live);
    expect(first.sessionStartAt.toISOString()).toBe(ENTERED_AT.toISOString());
    expect(first.runtimeState).toBe("playing");
    expect(read(first.issuedToken, new Date(ENTERED_AT.getTime() + 90_000), live)?.playback.offsetSeconds).toBe(90);
  });

  it("uses the merchant anchor as one shared session without a cookie", () => {
    const live = evergreenLive({ evergreenSessionStartAt: new Date("2026-10-29T07:00:00.000Z") });
    const session = read(null, ENTERED_AT, live);
    expect(session).toMatchObject({ assigned: true, issuedToken: null, canRejoin: false, runtimeState: "waiting" });
    expect(session?.sessionStartAt.toISOString()).toBe("2026-10-29T07:00:00.000Z");
  });

  it("maps an ended session to replay only while the replay window is open", () => {
    const token = claim().issuedToken;
    const afterEnd = new Date("2026-10-29T06:50:00.000Z");
    expect(read(token, afterEnd)).toMatchObject({ runtimeState: "unavailable", canRejoin: true });
    expect(read(token, afterEnd, evergreenLive({ replayEnabled: true }))?.runtimeState).toBe("replay");
    expect(read(token, afterEnd, evergreenLive({ replayEnabled: true, replayAvailableUntil: new Date("2026-10-29T06:40:00.000Z") }))?.runtimeState)
      .toBe("unavailable");
  });

  it("rejoins only after the visitor's own session ended", () => {
    const token = claim().issuedToken;
    const playing = resolveEvergreenViewerSession({ live: evergreenLive(), vendorTimezone: "Asia/Taipei", token, intent: "rejoin", now: new Date("2026-10-29T06:20:00.000Z") });
    expect(playing?.issuedToken).toBeNull();
    expect(playing?.sessionStartAt.toISOString()).toBe("2026-10-29T06:15:00.000Z");

    const ended = resolveEvergreenViewerSession({ live: evergreenLive(), vendorTimezone: "Asia/Taipei", token, intent: "rejoin", now: new Date("2026-10-29T06:50:00.000Z") });
    expect(ended?.issuedToken).toEqual(expect.any(String));
    expect(ended?.sessionStartAt.toISOString()).toBe("2026-10-29T07:00:00.000Z");
    expect(ended?.runtimeState).toBe("waiting");
  });
});

describe("evergreen session anti-tamper", () => {
  const binding = (live = evergreenLive()) => {
    const schedule = evergreenScheduleForLive(live, "Asia/Taipei");
    if (!schedule) throw new Error("Expected schedule");
    return { vendorId: live.vendorId, liveId: live.id, schedule, now: new Date("2026-10-29T06:20:00.000Z") };
  };

  it("rejects an edited start time even with the original signature", () => {
    const token = claim().issuedToken!;
    expect(verifyEvergreenSessionToken(token, binding())?.toISOString()).toBe("2026-10-29T06:15:00.000Z");
    const earlier = reencode(token, (claims) => { claims.s = new Date("2026-10-29T05:00:00.000Z").getTime(); });
    expect(verifyEvergreenSessionToken(earlier, binding())).toBeNull();
    // A tampered cookie is ignored: the visitor gets only what a new visitor would get, never an earlier start.
    const session = read(earlier, new Date("2026-10-29T06:20:00.000Z"));
    expect(session?.assigned).toBe(false);
    expect(session?.sessionStartAt.toISOString()).toBe("2026-10-29T06:30:00.000Z");
  });

  it("binds the session to its tenant, live and schedule", () => {
    const token = claim().issuedToken!;
    expect(verifyEvergreenSessionToken(token, { ...binding(), vendorId: "vendor-2" })).toBeNull();
    expect(verifyEvergreenSessionToken(token, binding(evergreenLive({ id: "live-evergreen-2" })))).toBeNull();
    expect(verifyEvergreenSessionToken(token, binding(evergreenLive({ evergreenIntervalMinutes: 30 })))).toBeNull();
    expect(verifyEvergreenSessionToken(token, binding(evergreenLive({ video: { durationSec: 1_200 } })))).toBeNull();
    expect(read(token, new Date("2026-10-29T06:20:00.000Z"), evergreenLive({ id: "live-evergreen-2" }))?.assigned).toBe(false);
  });

  it("rejects forged, malformed, future-issued and expired tokens", () => {
    const token = claim().issuedToken!;
    const [version, payload] = token.split(".");
    expect(verifyEvergreenSessionToken(`${version}.${payload}.${"A".repeat(43)}`, binding())).toBeNull();
    for (const value of [null, undefined, "", "eg1", "eg1.a.b.c", `eg2.${payload}.x`, "x".repeat(2_000)]) {
      expect(verifyEvergreenSessionToken(value, binding())).toBeNull();
    }
    const schedule = binding().schedule;
    const future = createEvergreenSessionToken({ vendorId: "vendor-1", liveId: "live-evergreen-1", schedule, sessionStartAt: new Date("2026-10-29T08:00:00.000Z"), now: new Date("2026-10-29T07:00:00.000Z") });
    expect(verifyEvergreenSessionToken(future, binding())).toBeNull();
    // Tokens live at most seven days, matching the cookie cap.
    expect(verifyEvergreenSessionToken(token, { ...binding(), now: new Date("2026-11-05T06:02:00.000Z") })?.toISOString()).toBe("2026-10-29T06:15:00.000Z");
    expect(verifyEvergreenSessionToken(token, { ...binding(), now: new Date("2026-11-05T06:03:00.000Z") })).toBeNull();
    const farStart = createEvergreenSessionToken({ vendorId: "vendor-1", liveId: "live-evergreen-1", schedule, sessionStartAt: new Date("2026-10-20T00:00:00.000Z"), now: ENTERED_AT });
    expect(verifyEvergreenSessionToken(farStart, binding())).toBeNull();
  });

  it("keeps the cookie httpOnly, per live, and out of the public projection", () => {
    const session = claim();
    const name = evergreenSessionCookieName("live-evergreen-1");
    expect(name).toMatch(/^celebratedeal_eg_[0-9a-f]{24}$/u);
    expect(name).not.toContain("live-evergreen-1");
    expect(evergreenSessionCookieName("live-evergreen-2")).not.toBe(name);
    const request = new Request("https://app.example.test/api/live-admission", { headers: { cookie: `other=1; ${name}=${session.issuedToken}` } });
    expect(evergreenSessionTokenFromRequest(request, "live-evergreen-1")).toBe(session.issuedToken);
    expect(evergreenSessionTokenFromRequest(request, "live-evergreen-2")).toBeNull();
    expect(evergreenSessionCookieOptions(request, 3_600)).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 3_600 });
    expect(JSON.stringify(publicEvergreenSession(session, ENTERED_AT))).not.toContain(session.issuedToken!);
  });
});

describe("evergreen session cookie lifetime", () => {
  // Claimed at 06:03 for the 06:15 cohort of a 30-minute video: the session ends at 06:45.
  const session = () => claim();

  it("expires one hour after the session ends when replay is closed", () => {
    expect(evergreenSessionCookieMaxAgeSeconds(session(), { replayEnabled: false, replayAvailableUntil: null }, ENTERED_AT))
      .toBe((42 + 60) * 60);
  });

  it("follows a dated replay window and never exceeds seven days", () => {
    const until = new Date("2026-10-30T06:03:00.000Z");
    expect(evergreenSessionCookieMaxAgeSeconds(session(), { replayEnabled: true, replayAvailableUntil: until }, ENTERED_AT)).toBe(24 * 60 * 60);
    expect(evergreenSessionCookieMaxAgeSeconds(session(), { replayEnabled: true, replayAvailableUntil: new Date("2027-01-01T00:00:00.000Z") }, ENTERED_AT))
      .toBe(EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS);
    expect(evergreenSessionCookieMaxAgeSeconds(session(), { replayEnabled: true, replayAvailableUntil: null }, ENTERED_AT))
      .toBe(EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS);
    expect(EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it("ignores an already closed replay window and clamps the cookie options", () => {
    expect(evergreenSessionCookieMaxAgeSeconds(session(), { replayEnabled: true, replayAvailableUntil: new Date("2026-10-29T06:00:00.000Z") }, ENTERED_AT))
      .toBe((42 + 60) * 60);
    const request = new Request("http://localhost:3000/live/x");
    expect(evergreenSessionCookieOptions(request, 10 * 24 * 60 * 60)).toMatchObject({ secure: false, maxAge: EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS });
    expect(evergreenSessionCookieOptions(request, 0).maxAge).toBe(60);
    expect(evergreenSessionCookieOptions(request, Number.NaN).maxAge).toBe(60);
  });
});

describe("evergreen session cookie parser", () => {
  const name = evergreenSessionCookieName("live-evergreen-1");

  it("finds the token after more than one hundred other cookies", () => {
    const token = claim().issuedToken!;
    const others = Array.from({ length: 150 }, (_, index) => `c${index}=v${index}`).join("; ");
    expect(evergreenSessionTokenFromCookieHeader(`${others}; ${name}=${token}`, "live-evergreen-1")).toBe(token);
    const request = new Request("https://app.example.test/api/live-admission", { headers: { cookie: `${others}; ${name}=${token}` } });
    expect(evergreenSessionTokenFromRequest(request, "live-evergreen-1")).toBe(token);
  });

  it("returns the first matching value and fails closed on malformed or oversized values", () => {
    expect(evergreenSessionTokenFromCookieHeader(`${name}=first; ${name}=second`, "live-evergreen-1")).toBe("first");
    expect(evergreenSessionTokenFromCookieHeader(`${name}=%E0%A4%A`, "live-evergreen-1")).toBeNull();
    expect(evergreenSessionTokenFromCookieHeader(`${name}=${"a".repeat(1_025)}`, "live-evergreen-1")).toBeNull();
    expect(evergreenSessionTokenFromCookieHeader(null, "live-evergreen-1")).toBeNull();
    expect(evergreenSessionTokenFromCookieHeader(`x${name}=value`, "live-evergreen-1")).toBeNull();
  });
});

describe("viewer-facing runtime", () => {
  it("keeps an evergreen visitor without a session in the waiting room", () => {
    expect(resolveViewerLiveRuntime(evergreenLive(), { vendorTimezone: "Asia/Taipei", evergreenToken: null, now: new Date("2026-10-29T06:20:00.000Z") }))
      .toMatchObject({ state: "waiting", playbackStartSeconds: null });
  });

  it("plays an evergreen session from its server offset and nowhere else", () => {
    const token = claim().issuedToken;
    expect(resolveViewerLiveRuntime(evergreenLive(), { vendorTimezone: "Asia/Taipei", evergreenToken: token, now: new Date("2026-10-29T06:20:30.000Z") }))
      .toMatchObject({ state: "playing", playbackStartSeconds: 330 });
    expect(resolveViewerLiveRuntime(evergreenLive(), { vendorTimezone: "Asia/Taipei", evergreenToken: token, now: new Date("2026-10-29T06:10:00.000Z") }))
      .toMatchObject({ state: "waiting", playbackStartSeconds: null });
  });

  it("leaves non-evergreen lives on the shared scheduledAt lifecycle", () => {
    const live = evergreenLive({ isEvergreen: false });
    expect(resolveViewerLiveRuntime({ ...live, scheduledAt: new Date("2026-10-29T06:00:00.000Z") }, { vendorTimezone: "Asia/Taipei", evergreenToken: null, now: new Date("2026-10-29T06:05:00.000Z") }))
      .toMatchObject({ state: "playing", playbackStartSeconds: 300, evergreen: null });
  });
});
