import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rateLimit: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/api-security", () => ({
  readJsonBody: vi.fn(),
  requireSameOriginRequest: vi.fn(() => null),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));

import { GET, POST } from "./route";

describe("live interaction cards route", () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue(null);
    mocks.rateLimit.mockReset().mockResolvedValue(null);
  });

  it("拒絕未授權的講師卡片讀寫，並禁止快取", async () => {
    const getResponse = await GET(new Request("https://app.example.test/api/live-interactions/cards?mode=instructor&liveId=live-1"));
    const postResponse = await POST(new Request("https://app.example.test/api/live-interactions/cards?mode=instructor", { method: "POST" }));

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(getResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(postResponse.headers.get("cache-control")).toBe("private, no-store");
  });
});
