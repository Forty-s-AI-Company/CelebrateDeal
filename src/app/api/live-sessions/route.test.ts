import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPublicLiveSessions: vi.fn(),
  checkRateLimit: vi.fn(async () => null as Response | null),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({ marker: "db" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/live-fixed-sessions-store", () => ({ loadPublicLiveSessions: mocks.loadPublicLiveSessions }));

import { GET } from "@/app/api/live-sessions/route";

function request(query: string, headers: Record<string, string> = { origin: "https://app.example.test", "x-celebratedeal-client": "web" }) {
  return new Request(`https://app.example.test/api/live-sessions${query}`, { headers });
}

describe("GET /api/live-sessions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    mocks.loadPublicLiveSessions.mockReset();
    mocks.checkRateLimit.mockReset().mockResolvedValue(null);
  });

  it("returns the open sessions grouped by date without caching", async () => {
    const payload = {
      liveId: "live-a",
      timeZone: "Asia/Taipei",
      registrationClosesAfterStartMinutes: 0,
      days: [{ date: "2026-10-30", label: "10月30日（週五）", sessions: [{ id: "s1", startAt: "2026-10-30T06:00:00.000Z", timeLabel: "14:00", capacity: null, remaining: null, full: false }] }],
    };
    mocks.loadPublicLiveSessions.mockResolvedValueOnce(payload);
    const response = await GET(request("?liveId=live-a&vendorId=vendor-a"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(payload);
    expect(mocks.loadPublicLiveSessions).toHaveBeenCalledWith({ marker: "db" }, { liveId: "live-a", vendorId: "vendor-a" });
  });

  it("answers an unknown, foreign or single-start Live with the same 404", async () => {
    mocks.loadPublicLiveSessions.mockResolvedValueOnce(null);
    const response = await GET(request("?liveId=live-missing"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Live sessions unavailable" });
  });

  it("rejects a malformed or extra query before reading the database", async () => {
    for (const query of ["", "?liveId=", "?liveId=a%20b", `?liveId=${"x".repeat(129)}`]) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
    }
    expect(mocks.loadPublicLiveSessions).not.toHaveBeenCalled();
  });

  it("requires the same-origin client marker and honours the rate limit", async () => {
    expect((await GET(request("?liveId=live-a", { origin: "https://app.example.test" }))).status).toBe(403);
    expect((await GET(request("?liveId=live-a", { origin: "https://evil.example.test", "x-celebratedeal-client": "web" }))).status).toBe(403);
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await GET(request("?liveId=live-a"))).status).toBe(429);
    expect(mocks.loadPublicLiveSessions).not.toHaveBeenCalled();
  });
});
