import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmedLiveSessionFromCookies,
  createLiveSessionResultToken,
  LIVE_SESSION_RESULT_TTL_SECONDS,
  liveSessionResultCookieOptions,
  verifyLiveSessionResultToken,
} from "@/lib/live-session-result";
import { LIVE_SESSION_RESULT_COOKIE } from "@/lib/live-fixed-sessions";

const NOW = new Date("2030-10-30T05:00:00.000Z");
const result = { liveId: "live-1", id: "session-1", startAt: "2030-10-30T06:00:00.000Z", label: "10月30日（週三） 14:00" };

describe("signed fixed-session result cookie", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "live-session-result-test-secret-longer-than-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips only for the same Live within 30 minutes", () => {
    const token = createLiveSessionResultToken(result, NOW);
    expect(verifyLiveSessionResultToken(token, "live-1", NOW)).toEqual(result);
    expect(verifyLiveSessionResultToken(token, "live-2", NOW)).toBeNull();
    expect(verifyLiveSessionResultToken(token, "live-1", new Date(NOW.getTime() + LIVE_SESSION_RESULT_TTL_SECONDS * 1_000))).toBeNull();
    expect(confirmedLiveSessionFromCookies({ get: (name) => (name === LIVE_SESSION_RESULT_COOKIE ? { value: token } : undefined) }, "live-1", NOW)).toEqual(result);
    expect(confirmedLiveSessionFromCookies({ get: () => undefined }, "live-1", NOW)).toBeNull();
  });

  it("rejects forged, tampered or plain JSON values", () => {
    const token = createLiveSessionResultToken(result, NOW);
    const [version, payload, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ l: "live-1", i: "x", s: result.startAt, b: "偽造", e: Math.floor(NOW.getTime() / 1_000) + 60 })).toString("base64url");
    for (const value of [
      `${version}.${forgedPayload}.${signature}`,
      `${version}.${payload}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`,
      JSON.stringify(result),
      `${token}.extra`,
      "",
    ]) expect(verifyLiveSessionResultToken(value, "live-1", NOW)).toBeNull();
    // Another secret (another deployment) does not verify it either.
    vi.stubEnv("CSRF_SECRET", "another-deployment-secret-longer-than-32-bytes!!");
    expect(verifyLiveSessionResultToken(token, "live-1", NOW)).toBeNull();
  });

  it("produces a fixed token for a fixed secret and time (format and derived key are frozen)", () => {
    vi.stubEnv("CSRF_SECRET", "synthetic-kdf-golden-root-secret-0123456789");
    vi.stubEnv("JOB_SECRET", "");
    const token = createLiveSessionResultToken(result, NOW);
    expect(token).toBe(
      "lsr1.eyJsIjoibGl2ZS0xIiwiaSI6InNlc3Npb24tMSIsInMiOiIyMDMwLTEwLTMwVDA2OjAwOjAwLjAwMFoiLCJiIjoiMTDmnIgzMOaXpe-8iOmAseS4ie-8iSAxNDowMCIsImUiOjE5MTk1Njg2MDB9"
        + ".qrTjGxdPF18UDS0YUxbtCjBL40mPV3NAxJ1fV7pMs1s",
    );
    expect(verifyLiveSessionResultToken(token, "live-1", NOW)).toEqual(result);
  });

  it("is HttpOnly, Lax and scoped to the funnel pages that read it", () => {
    expect(liveSessionResultCookieOptions(true)).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/lp", maxAge: 1_800 });
  });
});
