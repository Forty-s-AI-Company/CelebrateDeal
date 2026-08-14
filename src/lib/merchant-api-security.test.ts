import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAuth: vi.fn(),
  verifyCsrfToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.getCurrentAuth }));
vi.mock("@/lib/csrf", () => ({ verifyCsrfToken: mocks.verifyCsrfToken }));

import { MERCHANT_API_CSRF_HEADER, requireMerchantApiActor } from "./merchant-api-security";

function request(headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/media/images/presign", {
    method: "POST",
    headers: {
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      [MERCHANT_API_CSRF_HEADER]: "csrf-token",
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  mocks.getCurrentAuth.mockResolvedValue({
    vendor: { id: "session-vendor" },
    member: { id: "member-1", status: "active", role: "owner" },
  });
  mocks.verifyCsrfToken.mockResolvedValue(true);
});

afterEach(() => vi.unstubAllEnvs());

describe("requireMerchantApiActor", () => {
  it("rejects invalid browser boundaries before reading session state", async () => {
    const result = await requireMerchantApiActor(request({ origin: "https://attacker.example.test" }));

    expect(result.response?.status).toBe(403);
    expect(mocks.getCurrentAuth).not.toHaveBeenCalled();
    expect(mocks.verifyCsrfToken).not.toHaveBeenCalled();
  });

  it("returns 401 only when the session is absent", async () => {
    mocks.getCurrentAuth.mockResolvedValue(null);

    const result = await requireMerchantApiActor(request());

    expect(result.response?.status).toBe(401);
    await expect(result.response?.json()).resolves.toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(mocks.verifyCsrfToken).not.toHaveBeenCalled();
  });

  it.each([
    { member: { id: "member-1", status: "inactive", role: "owner" } },
    { member: { id: "member-1", status: "active", role: "member" } },
    { vendor: null, member: { id: "member-1", status: "active", role: "admin" } },
  ])("fails closed for an inactive or insufficient tenant membership", async (auth) => {
    mocks.getCurrentAuth.mockResolvedValue(auth);

    const result = await requireMerchantApiActor(request());

    expect(result.response?.status).toBe(403);
    expect(mocks.verifyCsrfToken).not.toHaveBeenCalled();
  });

  it("requires CSRF and derives vendor identity from the session", async () => {
    mocks.verifyCsrfToken.mockResolvedValueOnce(false);
    const denied = await requireMerchantApiActor(request());
    expect(denied.response?.status).toBe(403);

    const allowed = await requireMerchantApiActor(request());
    expect(allowed.actor).toEqual({ vendorId: "session-vendor", memberId: "member-1" });
    expect(mocks.verifyCsrfToken).toHaveBeenLastCalledWith("csrf-token");
  });
});
