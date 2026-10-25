import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/merchant-email-verification", () => ({ confirmMerchantEmailVerification: mocks.confirm }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/app-url", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/app-url")>(), getBrowserReturnAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/api-security", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-security")>(),
  requireSameOriginRequest: (request: Request) => request.headers.get("origin") === "https://app.example.test" ? null : Response.json({ error: "Invalid request origin" }, { status: 403 }),
}));

import { POST } from "./route";

function request(body: string | null, origin: string | null = "https://app.example.test") {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("origin", origin);
  return new Request("https://app.example.test/api/auth/email-verification/confirm", { method: "POST", headers, body });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(null);
  mocks.confirm.mockResolvedValue({ status: "verified" });
});

describe("POST /api/auth/email-verification/confirm", () => {
  it.each(["verified", "already_verified", "invalid"] as const)("redirects with 303 to the %s result without caching", async (status) => {
    mocks.confirm.mockResolvedValue({ status });
    const response = await POST(request("token=mev1.payload.signature"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://app.example.test/verify-email?status=${status}`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.confirm).toHaveBeenCalledWith("mev1.payload.signature");
  });

  it("refuses requests without an origin or from another origin", async () => {
    expect((await POST(request("token=x", null))).status).toBe(403);
    expect((await POST(request("token=x", "https://evil.example.test"))).status).toBe(403);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response before reading the token", async () => {
    mocks.limit.mockResolvedValue(Response.json({ error: "Too many requests" }, { status: 429 }));
    expect((await POST(request("token=x"))).status).toBe(429);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("treats a missing, empty or oversized token as invalid", async () => {
    for (const body of ["", "token=", `token=${"a".repeat(1_025)}`]) {
      const response = await POST(request(body));
      expect(response.headers.get("location")).toBe("https://app.example.test/verify-email?status=invalid");
    }
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("reads only the token: other fields cannot name a user", async () => {
    await POST(request("token=mev1.payload.signature&userId=other&email=attacker%40example.test"));
    expect(mocks.confirm).toHaveBeenCalledWith("mev1.payload.signature");
    expect(mocks.confirm.mock.calls[0]).toHaveLength(1);
  });

  it("fails closed when confirmation throws", async () => {
    mocks.confirm.mockRejectedValue(new Error("database unavailable"));
    expect((await POST(request("token=x"))).headers.get("location")).toBe("https://app.example.test/verify-email?status=invalid");
  });
});
