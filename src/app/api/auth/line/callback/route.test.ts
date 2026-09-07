import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  completeLineLogin: vi.fn(),
  createUserSession: vi.fn(),
}));

vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE: "session",
  createUserSession: mocks.createUserSession,
  sessionCookieOptions: () => ({ httpOnly: true, sameSite: "lax" as const }),
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/line-login", () => ({
  completeLineLogin: mocks.completeLineLogin,
  LineFetchLoginProvider: class {},
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { GET } from "./route";

describe("GET /api/auth/line/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue(null);
  });

  it("links a buyer identity and returns only the bounded redirect state", async () => {
    mocks.completeLineLogin.mockResolvedValue({
      identity: { vendorId: "vendor-1", subjectType: "buyer_registration", subjectId: "submission-1" },
      redirectPath: "/live/safe-live",
      login: false,
    });

    const response = await GET(new Request("https://app.example.test/api/auth/line/callback?state=opaque&code=opaque"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/live/safe-live?line=linked");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.completeLineLogin).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      state: "opaque",
      code: "opaque",
    });
    expect(mocks.createUserSession).not.toHaveBeenCalled();
  });

  it("fails closed to a generic login redirect when state exchange fails", async () => {
    mocks.completeLineLogin.mockRejectedValue(new Error("provider detail must stay private"));

    const response = await GET(new Request("https://app.example.test/api/auth/line/callback?state=bad&code=bad"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/login?line=error");
    expect(mocks.createUserSession).not.toHaveBeenCalled();
  });
});
