import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  recordPlatformReferralClick: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/platform-referral", () => ({
  PLATFORM_REFERRAL_COOKIE: "celebratedeal_platform_referral",
  platformReferralCookieOptions: () => ({
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 2_592_000,
  }),
  recordPlatformReferralClick: mocks.recordPlatformReferralClick,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("platform referral entry route", () => {
  it("creates a server-side click and sets an httpOnly attribution cookie", async () => {
    mocks.getDb.mockReturnValue({});
    mocks.recordPlatformReferralClick.mockResolvedValue({ id: "click-1" });

    const response = await GET(new Request("https://app.example.test/r/EDEN10"), { params: Promise.resolve({ code: "EDEN10" }) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.test/billing/plans?referral=1");
    expect(response.headers.get("set-cookie")).toContain("celebratedeal_platform_referral=click-1");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(mocks.recordPlatformReferralClick).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: "EDEN10", landingPath: "/billing/plans" }));
  });

  it("redirects malformed codes without touching the database", async () => {
    const response = await GET(new Request("https://app.example.test/r/"), { params: Promise.resolve({ code: "   " }) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.test/billing/plans?error=invalid_referral");
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.recordPlatformReferralClick).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("celebratedeal_platform_referral=;");
  });
});
