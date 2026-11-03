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
        "content-length": String(64 * 1024 + 1),
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

describe("POST /api/security/csp-report de-identified logging (F-156)", () => {
  const SECRET_PARTS = ["reset-token-value", "visitor@example.test", "sessionsecret", "privatepath", "alert(document.cookie)", "Mozilla", "clxyz1234567890abcdefghij", "9f2b7c1e-1111-4222-8333-944445555666"];

  function logged(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls.map((call: unknown[]) => {
      expect(call[0]).toBe("csp_violation");
      return JSON.parse(call[1] as string) as Record<string, unknown>;
    });
  }

  it("logs only the whitelisted, reduced fields of a report-uri report", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(cspReportRequest(JSON.stringify({
      "csp-report": {
        "document-uri": "https://app.example.test/invitations/clxyz1234567890abcdefghij/accept?token=reset-token-value#visitor@example.test",
        referrer: "https://app.example.test/privatepath?sessionsecret=1",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "original-policy": "script-src 'nonce-sessionsecret'",
        disposition: "report",
        "blocked-uri": "https://evil.example.test/privatepath/payload.js?sessionsecret=1",
        "source-file": "https://cdn.example.test/privatepath/app.js?sessionsecret=1",
        "script-sample": "alert(document.cookie)",
        "line-number": 12,
        "status-code": 200,
      },
    })));

    expect(response.status).toBe(204);
    expect(logged(warn)).toEqual([{
      disposition: "report",
      directive: "script-src-elem",
      blocked: "https://evil.example.test",
      source: "https://cdn.example.test",
      documentPath: "/invitations/:id/accept",
      count: 1,
    }]);
    const output = JSON.stringify(warn.mock.calls);
    for (const part of SECRET_PARTS) expect(output).not.toContain(part);
  });

  it("accepts Reporting API batches, keeps keywords and schemes, collapses duplicates and drops non-http documents or malformed directives", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = (body: Record<string, unknown>) => ({ type: "csp-violation", age: 1, url: "https://app.example.test/x?sessionsecret=1", user_agent: "Mozilla/5.0", body });
    const body = [
      report({ documentURL: "https://app.example.test/lp/summer-sale/9f2b7c1e-1111-4222-8333-944445555666", blockedURL: "inline", effectiveDirective: "script-src-elem", disposition: "enforce", sample: "alert(document.cookie)" }),
      report({ documentURL: "https://app.example.test/lp/summer-sale/9f2b7c1e-1111-4222-8333-944445555666", blockedURL: "inline", effectiveDirective: "script-src-elem", disposition: "enforce" }),
      report({ documentURL: "https://app.example.test/dashboard", blockedURL: "data:image/png;base64,AAAA", effectiveDirective: "img-src", disposition: "report", sourceFile: "chrome-extension://abcdef/content.js" }),
      { type: "deprecation", body: { documentURL: "https://app.example.test/" } },
      report({ documentURL: "javascript:alert(1)", blockedURL: "eval", effectiveDirective: "script-src" }),
      report({ documentURL: "https://app.example.test/", blockedURL: "eval", effectiveDirective: "script-src; injected" }),
    ];
    const request = new Request("https://app.example.test/api/security/csp-report", {
      method: "POST",
      headers: { "content-type": "application/reports+json" },
      body: JSON.stringify(body),
    });

    expect((await POST(request)).status).toBe(204);
    expect(logged(warn)).toEqual([
      { disposition: "enforce", directive: "script-src-elem", blocked: "inline", source: null, documentPath: "/lp/summer-sale/:id", count: 2 },
      { disposition: "report", directive: "img-src", blocked: "data", source: "chrome-extension", documentPath: "/dashboard", count: 1 },
    ]);
    const output = JSON.stringify(warn.mock.calls);
    for (const part of SECRET_PARTS) expect(output).not.toContain(part);
  });

  it("ignores unknown content types, malformed JSON and unexpected shapes without logging", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const valid = JSON.stringify({ "csp-report": { "document-uri": "https://app.example.test/", "effective-directive": "img-src", "blocked-uri": "https://x.example.test/a.png" } });
    for (const [type, body] of [["text/plain", valid], ["application/csp-report", "{not json"], ["application/csp-report", "[1,2,3]"], ["application/json", '{"csp-report":"x"}']] as const) {
      const request = new Request("https://app.example.test/api/security/csp-report", { method: "POST", headers: { "content-type": type }, body });
      expect((await POST(request)).status).toBe(204);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("processes at most 20 reports from one request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = Array.from({ length: 40 }, (_, index) => ({ type: "csp-violation", body: { documentURL: `https://app.example.test/page-${String.fromCharCode(97 + (index % 26))}${index}`, blockedURL: "inline", effectiveDirective: "script-src-elem" } }));
    const request = new Request("https://app.example.test/api/security/csp-report", { method: "POST", headers: { "content-type": "application/reports+json" }, body: JSON.stringify(body) });
    expect((await POST(request)).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(20);
  });
});
