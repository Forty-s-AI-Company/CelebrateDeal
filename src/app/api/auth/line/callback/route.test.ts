import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  completeLineLogin: vi.fn(),
  createUserSessionForLineIdentity: vi.fn(),
  getCurrentAuth: vi.fn(),
}));

vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE: "session",
  createUserSessionForLineIdentity: mocks.createUserSessionForLineIdentity,
  getCurrentAuth: mocks.getCurrentAuth,
  sessionCookieOptions: () => ({ httpOnly: true, sameSite: "lax" as const }),
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/line-login", () => ({
  completeLineLogin: mocks.completeLineLogin,
  LineFetchLoginProvider: class {},
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { GET } from "./route";

const callback = () => GET(new Request("https://app.example.test/api/auth/line/callback?state=opaque&code=opaque"));
const userIdentity = { id: "identity-1", vendorId: "vendor-1", subjectType: "user", subjectId: "user-1" };

describe("GET /api/auth/line/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue(null);
    mocks.getCurrentAuth.mockResolvedValue(null);
    mocks.createUserSessionForLineIdentity.mockResolvedValue({ token: "synthetic-session-token", expiresAt: new Date(Date.now() + 60_000) });
  });

  it("links a buyer identity and returns only the bounded redirect state", async () => {
    mocks.completeLineLogin.mockResolvedValue({
      identity: { vendorId: "vendor-1", subjectType: "buyer_registration", subjectId: "submission-1" },
      redirectPath: "/live/safe-live",
      login: false,
    });

    const response = await callback();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/live/safe-live?line=linked");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.completeLineLogin).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      state: "opaque",
      code: "opaque",
      linkingUserId: null,
    });
    expect(mocks.createUserSessionForLineIdentity).not.toHaveBeenCalled();
  });

  it("signs in a linked user identity through the locked session insert", async () => {
    mocks.completeLineLogin.mockResolvedValue({ identity: userIdentity, redirectPath: "/dashboard", login: true });
    const response = await callback();
    expect(response.headers.get("location")).toBe("https://app.example.test/dashboard?line=authenticated");
    expect(mocks.createUserSessionForLineIdentity).toHaveBeenCalledWith(expect.objectContaining({ identityId: "identity-1", userId: "user-1", vendorId: "vendor-1" }));
    expect(response.headers.get("set-cookie")).toContain("session=synthetic-session-token");
  });

  it("creates no session when the locked re-check fails (identity revoked or account not active)", async () => {
    mocks.completeLineLogin.mockResolvedValue({ identity: userIdentity, redirectPath: "/dashboard", login: true });
    mocks.createUserSessionForLineIdentity.mockResolvedValue(null);
    const response = await callback();
    expect(response.headers.get("location")).toBe("https://app.example.test/login?line=error");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("links in link mode only for the signed-in account and never creates a session", async () => {
    mocks.getCurrentAuth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.completeLineLogin.mockResolvedValue({ identity: userIdentity, redirectPath: "/settings/line", login: false });
    const response = await callback();
    expect(mocks.completeLineLogin).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ linkingUserId: "user-1" }));
    expect(response.headers.get("location")).toBe("https://app.example.test/settings/line?line=linked");
    expect(mocks.createUserSessionForLineIdentity).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not log in when link mode has no matching session (no identity comes back)", async () => {
    mocks.completeLineLogin.mockResolvedValue({ identity: null, redirectPath: "/settings/line", login: false });
    const response = await callback();
    expect(response.headers.get("location")).toBe("https://app.example.test/login?line=error");
    expect(mocks.createUserSessionForLineIdentity).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed to a generic login redirect when state exchange fails", async () => {
    mocks.completeLineLogin.mockRejectedValue(new Error("provider detail must stay private"));

    const response = await callback();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/login?line=error");
    expect(mocks.createUserSessionForLineIdentity).not.toHaveBeenCalled();
  });
});
