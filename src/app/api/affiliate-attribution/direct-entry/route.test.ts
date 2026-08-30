import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => null),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST } from "./route";

function request(headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/affiliate-attribution/direct-entry", {
    method: "POST",
    headers: {
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(null);
});

describe("direct-entry attribution reset", () => {
  it("clears only the server attribution cookie with a no-store response", async () => {
    const incoming = request();
    const response = await POST(incoming);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("celebratedeal_attribution=;");
    expect(cookies).toContain("celebratedeal_platform_referral=;");
    expect(cookies).toContain("Max-Age=0");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=lax");
    expect(cookies).toContain("Path=/");
    expect(cookies).not.toContain("celebratedeal_visitor=");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(incoming, "affiliate-attribution-direct-entry", 60, 60_000);
  });

  it("rejects a request without the trusted client marker before setting cookies", async () => {
    const response = await POST(request({ "x-celebratedeal-client": "" }));

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("fails closed for a foreign origin", async () => {
    const response = await POST(request({ origin: "https://attacker.example.test" }));

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });
});
