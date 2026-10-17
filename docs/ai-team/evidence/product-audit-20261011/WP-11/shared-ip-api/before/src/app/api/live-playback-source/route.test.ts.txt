import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  tokenFromRequest: vi.fn(),
  checkRateLimit: vi.fn(async () => null),
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/live-playback-source", () => ({ resolveLivePlaybackSource: mocks.resolve }));
vi.mock("@/lib/live-quota-admission", () => ({ liveViewerTokenFromRequest: mocks.tokenFromRequest }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { GET } from "@/app/api/live-playback-source/route";

function request(query = "vendorId=vendor-1&liveId=live-1", headers: Record<string, string> = {}) {
  return new Request(`https://app.example.test/api/live-playback-source?${query}`, {
    headers: {
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tokenFromRequest.mockReturnValue("A".repeat(43));
  mocks.resolve.mockResolvedValue({ playbackUrl: "https://video.example.test/live.m3u8" });
});

describe("GET /api/live-playback-source", () => {
  it("returns the source only after the admission service accepts the cookie", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ playbackUrl: "https://video.example.test/live.m3u8" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.resolve).toHaveBeenCalledWith({}, expect.objectContaining({
      vendorId: "vendor-1",
      liveId: "live-1",
      token: "A".repeat(43),
    }));
  });

  it("does not disclose a source without a valid admission cookie", async () => {
    mocks.tokenFromRequest.mockReturnValue(null);
    const response = await GET(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Playback unavailable" });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("fails closed on invalid query data", async () => {
    const response = await GET(request("vendorId=&liveId=live-1"));
    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
