import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Route layer of the personal watch link (Q-17): the resolver, limiter and
// monitoring are mocked here; route.db.test.ts runs the real ones on PostgreSQL.
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), rate: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/live-watch-link", () => ({ resolveLiveWatchLink: mocks.resolve }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.capture }));

import { GET } from "./route";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";

const APP_URL = "https://watch-route.example.test";
const NAME = "celebratedeal_la_0123456789abcdef01234567";

function open(query: string, origin = APP_URL) {
  return GET(new Request(`${origin}/api/live-watch-link${query}`));
}

describe("GET /api/live-watch-link route layer (Q-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
    mocks.rate.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sets only the attendance cookie with its narrow attributes and redirects to the clean viewer page", async () => {
    const expiresAt = new Date(Date.now() + 10 * 86_400_000);
    mocks.resolve.mockResolvedValue({ kind: "admit", submissionId: "s1", liveSlug: "spring-live", attendanceCookie: { name: NAME, value: "lat1.payload.sig", expiresAt } });

    const response = await open("?token=lwl1.payload.sig");

    expect(mocks.resolve).toHaveBeenCalledWith({ token: "lwl1.payload.sig", now: expect.any(Date) });
    expect(mocks.rate).toHaveBeenCalledWith(expect.any(Request), "live-watch-link", 60, 60_000);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP_URL}/live/spring-live`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(new RegExp(`^${NAME}=lat1\\.payload\\.sig;`, "u"));
    expect(cookies[0]).toMatch(/; Path=\/api\/live-admission(?:;|$)/u);
    expect(cookies[0]).toMatch(/HttpOnly/u);
    expect(cookies[0]).toMatch(/SameSite=lax/iu);
    expect(cookies[0]).toMatch(/Secure/u);
    const maxAge = Number(cookies[0]!.match(/Max-Age=(\d+)/u)?.[1]);
    expect(Math.abs(maxAge - 10 * 86_400)).toBeLessThan(5);
    expect(cookies.some((value) => value.startsWith(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=`))).toBe(false);
  });

  it("on a fixed-session Live also sets the session hint site-wide, with the same lifetime (A2-10)", async () => {
    const expiresAt = new Date(Date.now() + 10 * 86_400_000);
    const HINT = "celebratedeal_lsh_0123456789abcdef01234567";
    mocks.resolve.mockResolvedValue({
      kind: "admit", submissionId: "s1", liveSlug: "spring-live",
      attendanceCookie: { name: NAME, value: "lat1.payload.sig", expiresAt },
      sessionHintCookie: { name: HINT, value: "lsh1.payload.sig", expiresAt },
    });
    const cookies = (await open("?token=lwl1.payload.sig")).headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/; Path=\/api\/live-admission(?:;|$)/u);
    const hint = cookies.find((value) => value.startsWith(`${HINT}=lsh1.payload.sig;`))!;
    expect(hint).toMatch(/; Path=\/(?:;|$)/u);
    expect(hint).toMatch(/HttpOnly/u);
    expect(hint).toMatch(/SameSite=lax/iu);
    expect(hint).toMatch(/Secure/u);
    expect(Math.abs(Number(hint.match(/Max-Age=(\d+)/u)?.[1]) - 10 * 86_400)).toBeLessThan(5);
    expect(cookies.some((value) => value.startsWith(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=`))).toBe(false);
  });

  it("encodes the slug into a same-site path and leaves Secure off over plain http", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:31023");
    mocks.resolve.mockResolvedValue({ kind: "admit", submissionId: "s1", liveSlug: "春季-直播", attendanceCookie: { name: NAME, value: "v", expiresAt: new Date(Date.now() + 86_400_000) } });
    const response = await open("?token=t", "http://localhost:31023");
    expect(response.headers.get("location")).toBe(`http://localhost:31023/live/${encodeURIComponent("春季-直播")}`);
    expect(response.headers.getSetCookie()[0]).not.toMatch(/Secure/u);
  });

  it("redirects a refused link without any cookie: to its Live when known, otherwise home", async () => {
    mocks.resolve.mockResolvedValueOnce({ kind: "fallback", liveSlug: "spring-live" });
    const known = await open("?token=expired");
    expect(known.headers.get("location")).toBe(`${APP_URL}/live/spring-live`);
    expect(known.headers.getSetCookie()).toEqual([]);

    mocks.resolve.mockResolvedValueOnce({ kind: "fallback", liveSlug: null });
    const unknown = await open("?token=forged");
    expect(unknown.status).toBe(303);
    expect(unknown.headers.get("location")).toBe(`${APP_URL}/`);
    expect(unknown.headers.getSetCookie()).toEqual([]);
  });

  it("passes no token when it is missing or longer than any link", async () => {
    mocks.resolve.mockResolvedValue({ kind: "fallback", liveSlug: null });
    await open("");
    await open(`?token=${"x".repeat(601)}`);
    expect(mocks.resolve.mock.calls.map(([input]) => (input as { token: string | null }).token)).toEqual([null, null]);
  });

  it("fails closed to the home page and reports only a fixed context when resolving throws", async () => {
    const failure = new Error("database unavailable");
    mocks.resolve.mockRejectedValue(failure);
    const response = await open("?token=t");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP_URL}/`);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(mocks.capture).toHaveBeenCalledWith(failure, { source: "live_watch_link", operation: "resolve", status: "failed" });
  });

  it("returns the limiter's answer, uncached, before reading the token", async () => {
    mocks.rate.mockResolvedValue(new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }));
    const response = await open("?token=t");
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
