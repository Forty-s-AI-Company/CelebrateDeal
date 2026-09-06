import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  completeLineLogin: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE: "session",
  createUserSession: vi.fn(),
  sessionCookieOptions: vi.fn(),
}));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ affiliate: { findFirst: vi.fn() } }) }));
vi.mock("@/lib/line-login", () => ({
  completeLineLogin: mocks.completeLineLogin,
  LineFetchLoginProvider: class LineFetchLoginProvider {},
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));

import { GET } from "./route";

describe("GET /api/auth/line/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(null);
  });

  it("maps invalid provider state to a fixed same-origin error redirect", async () => {
    mocks.completeLineLogin.mockRejectedValue(new Error("provider detail must stay private"));

    const response = await GET(new Request("https://app.example.test/api/auth/line/callback?state=bad&code=bad"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/login?line=error");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
