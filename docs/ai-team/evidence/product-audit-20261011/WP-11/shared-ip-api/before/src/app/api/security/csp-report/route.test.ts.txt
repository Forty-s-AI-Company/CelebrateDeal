import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));

import { POST } from "@/app/api/security/csp-report/route";

function cspReportRequest(body = '{"csp-report":{"blocked-uri":"https://example.test"}}') {
  return new Request("https://app.example.test/api/security/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/security/csp-report", () => {
  it("returns 204, consumes an accepted report body, and applies the CSP report limit", async () => {
    const request = cspReportRequest();

    const response = await POST(request);

    expect(response.status).toBe(204);
    expect(request.bodyUsed).toBe(true);
    expect(checkRateLimit).toHaveBeenCalledWith(request, "csp-report", 120, 60_000);
  });

  it("returns the rate-limit response unchanged without consuming or logging the report body", async () => {
    const limited = new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
    const reportBody = '{"csp-report":{"document-uri":"https://private.example.test/token"}}';
    const request = cspReportRequest(reportBody);
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    checkRateLimit.mockResolvedValue(limited);

    const response = await POST(request);

    expect(response).toBe(limited);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(request.bodyUsed).toBe(false);
    expect(consoleDebug).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleInfo).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("rejects oversized reports after rate limiting without logging their content", async () => {
    const request = new Request("https://app.example.test/api/security/csp-report", {
      method: "POST",
      headers: {
        "content-type": "application/csp-report",
        "content-length": String(16 * 1024 + 1),
      },
      body: "{}",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "CSP report payload too large" });
    expect(checkRateLimit).toHaveBeenCalledWith(request, "csp-report", 120, 60_000);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });
});
