import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revert: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/account-email-change", async (importOriginal) => ({
  isTransientTransactionError: (await importOriginal<typeof import("@/lib/account-email-change")>()).isTransientTransactionError,
  revertAccountEmailChange: mocks.revert,
}));
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
  return new Request("https://app.example.test/api/auth/email-change/revert", { method: "POST", headers, body });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(null);
  mocks.revert.mockResolvedValue({ status: "reverted" });
});

describe("POST /api/auth/email-change/revert", () => {
  it.each(["reverted", "held", "cancelled", "invalid", "conflict", "retry"] as const)("redirects with 303 to the %s result without caching or a Referer", async (status) => {
    mocks.revert.mockResolvedValue({ status });
    const response = await POST(request("token=aer1.payload.signature"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://app.example.test/revert-email-change?status=${status}`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.revert).toHaveBeenCalledWith("aer1.payload.signature");
  });

  it("refuses requests without an origin or from another origin", async () => {
    expect((await POST(request("token=x", null))).status).toBe(403);
    expect((await POST(request("token=x", "https://evil.example.test"))).status).toBe(403);
    expect(mocks.revert).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response before reading the token", async () => {
    mocks.limit.mockResolvedValue(Response.json({ error: "Too many requests" }, { status: 429 }));
    expect((await POST(request("token=x"))).status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(Request), "account-email-change-revert", 20, 60_000);
    expect(mocks.revert).not.toHaveBeenCalled();
  });

  it("treats a missing, empty or oversized token as invalid and reads only the token", async () => {
    for (const body of ["", "token=", `token=${"a".repeat(1_025)}`]) {
      expect((await POST(request(body))).headers.get("location")).toBe("https://app.example.test/revert-email-change?status=invalid");
    }
    expect(mocks.revert).not.toHaveBeenCalled();
    await POST(request("token=aer1.payload.signature&userId=other&previousEmail=attacker%40example.test"));
    expect(mocks.revert.mock.calls[0]).toEqual(["aer1.payload.signature"]);
  });

  it("maps a transient database failure to retry and anything else to invalid", async () => {
    mocks.revert.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("deadlock", { code: "P2034", clientVersion: "synthetic" }));
    expect((await POST(request("token=aer1.payload.signature"))).headers.get("location")).toBe("https://app.example.test/revert-email-change?status=retry");
    mocks.revert.mockRejectedValueOnce(new Error("database down"));
    expect((await POST(request("token=aer1.payload.signature"))).headers.get("location")).toBe("https://app.example.test/revert-email-change?status=invalid");
  });
});
