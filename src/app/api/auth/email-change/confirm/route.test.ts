import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/account-email-change", () => ({ confirmAccountEmailChange: mocks.confirm }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/app-url", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/app-url")>(), getBrowserReturnAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/api-security", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-security")>(),
  requireSameOriginRequest: (request: Request) => request.headers.get("origin") === "https://app.example.test" ? null : Response.json({ error: "Invalid request origin" }, { status: 403 }),
}));

import { POST } from "./route";

function request(body: string | null, origin: string | null = "https://app.example.test", cookie?: string) {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("origin", origin);
  if (cookie) headers.set("cookie", cookie);
  return new Request("https://app.example.test/api/auth/email-change/confirm", { method: "POST", headers, body });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(null);
  mocks.confirm.mockResolvedValue({ status: "changed" });
});

describe("POST /api/auth/email-change/confirm", () => {
  it.each(["changed", "invalid", "email_taken"] as const)("redirects with 303 to the %s result without caching or a Referer", async (status) => {
    mocks.confirm.mockResolvedValue({ status });
    const response = await POST(request("token=aec1.payload.signature"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://app.example.test/verify-email-change?status=${status}`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.confirm).toHaveBeenCalledWith("aec1.payload.signature");
  });

  it("never sets or clears a session cookie: it does not sign anyone in or out", async () => {
    const response = await POST(request("token=aec1.payload.signature", "https://app.example.test", "celebrate_session=someone-else"));
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses requests without an origin or from another origin", async () => {
    expect((await POST(request("token=x", null))).status).toBe(403);
    expect((await POST(request("token=x", "https://evil.example.test"))).status).toBe(403);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response before reading the token", async () => {
    mocks.limit.mockResolvedValue(Response.json({ error: "Too many requests" }, { status: 429 }));
    expect((await POST(request("token=x"))).status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(Request), "account-email-change-confirm", 20, 60_000);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("treats a missing, empty or oversized token as invalid", async () => {
    for (const body of ["", "token=", `token=${"a".repeat(1_025)}`]) {
      const response = await POST(request(body));
      expect(response.headers.get("location")).toBe("https://app.example.test/verify-email-change?status=invalid");
    }
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("reads only the token: other fields cannot name a user or an address", async () => {
    await POST(request("token=aec1.payload.signature&userId=other&newEmail=attacker%40example.test"));
    expect(mocks.confirm).toHaveBeenCalledWith("aec1.payload.signature");
    expect(mocks.confirm.mock.calls[0]).toHaveLength(1);
  });

  it("reports an unexpected failure as invalid", async () => {
    mocks.confirm.mockRejectedValue(new Error("database down"));
    const response = await POST(request("token=aec1.payload.signature"));
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-email-change?status=invalid");
  });
});
