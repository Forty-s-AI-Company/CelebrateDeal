import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  checkRateLimit: vi.fn(async (): Promise<Response | null> => null),
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/live-waiting-source", () => ({ resolveLiveWaitingSource: mocks.resolve }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { GET } from "@/app/api/live-waiting-source/route";

function request(query = "vendorId=vendor-1&liveId=live-1", headers: Record<string, string> = {}) {
  return new Request(`https://app.example.test/api/live-waiting-source?${query}`, {
    headers: {
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ playbackUrl: "https://video.example.test/waiting.mp4" });
});

describe("GET /api/live-waiting-source", () => {
  it("returns the Live's own waiting source without any admission cookie", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ playbackUrl: "https://video.example.test/waiting.mp4" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.resolve).toHaveBeenCalledWith({}, expect.objectContaining({ vendorId: "vendor-1", liveId: "live-1" }));
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "live-waiting-source", 60, 60_000);
  });

  it("answers every refusal with the same 403", async () => {
    mocks.resolve.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Waiting video unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("accepts only vendorId and liveId: a video id cannot be requested", async () => {
    for (const query of ["vendorId=vendor-1&liveId=live-1&videoId=video-9", "vendorId=&liveId=live-1", "liveId=live-1"]) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
    }
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("requires the same-origin client marker and honours the rate limit", async () => {
    const crossSite = await GET(request(undefined, { origin: "https://evil.example.test" }));
    expect(crossSite.status).toBe(403);
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const limited = await GET(request());
    expect(limited.status).toBe(429);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
