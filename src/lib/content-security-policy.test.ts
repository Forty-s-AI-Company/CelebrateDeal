import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  buildStylePreviewPolicy,
  contentSecurityPolicyHeaders,
  createCspNonce,
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  cspSurfaceForPath,
  FUNNEL_CUSTOM_CODE_SANDBOX_CSP,
  FUNNEL_CUSTOM_CODE_SANDBOX_HEADERS,
  isValidCspNonce,
  parseCspEnforce,
} from "./content-security-policy";

const NONCE = "AAAAAAAAAAAAAAAAAAAAAA==";

function directives(policy: string) {
  return new Map(policy.split("; ").map((part) => {
    const [name, ...sources] = part.split(" ");
    return [name!, sources] as const;
  }));
}

describe("site Content Security Policy (F-156)", () => {
  it("uses a nonce with 'strict-dynamic' and never 'unsafe-inline' or 'unsafe-eval' for production scripts", () => {
    for (const surface of ["app", "public-funnel"] as const) {
      const scriptSrc = directives(buildContentSecurityPolicy({ nonce: NONCE, surface })).get("script-src")!;
      expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
      expect(scriptSrc).toContain("'strict-dynamic'");
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain("'unsafe-eval'");
      expect(scriptSrc).not.toContain("https:");
      expect(scriptSrc).not.toContain("*");
    }
  });

  it("adds 'unsafe-eval' and the direct Sentry ingest only in development", () => {
    const development = directives(buildContentSecurityPolicy({ nonce: NONCE, surface: "app", development: true }));
    expect(development.get("script-src")).toContain("'unsafe-eval'");
    expect(development.get("connect-src")).toContain("https://*.sentry.io");
    const production = directives(buildContentSecurityPolicy({ nonce: NONCE, surface: "app" }));
    expect(production.get("connect-src")).not.toContain("https://*.sentry.io");
  });

  it("keeps the existing restrictive directives and adds object-src 'none'", () => {
    const policy = directives(buildContentSecurityPolicy({ nonce: NONCE, surface: "app" }));
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'self'", "https://api.payuni.com.tw", "https://sandbox-api.payuni.com.tw"]);
    expect(policy.get("report-uri")).toEqual([CSP_REPORT_PATH]);
    expect(policy.get("report-to")).toEqual([CSP_REPORT_GROUP]);
    // Style attributes and the funnel's inline <style> keep 'unsafe-inline'; a nonce would cancel it.
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("style-src")!.some((source) => source.startsWith("'nonce-"))).toBe(false);
  });

  it("allows Cloudflare Turnstile's script, iframe and calls", () => {
    const policy = directives(buildContentSecurityPolicy({ nonce: NONCE, surface: "app" }));
    for (const name of ["script-src", "frame-src", "connect-src"]) expect(policy.get(name)).toContain("https://challenges.cloudflare.com");
  });

  it("allows Cloudflare Stream playback, uploads and R2 presigned uploads (PR #538 hosts kept)", () => {
    const policy = directives(buildContentSecurityPolicy({ nonce: NONCE, surface: "app" }));
    for (const host of ["https://videodelivery.net", "https://*.videodelivery.net", "https://*.cloudflarestream.com"]) {
      expect(policy.get("media-src")).toContain(host);
      expect(policy.get("connect-src")).toContain(host);
    }
    expect(policy.get("media-src")).toEqual(expect.arrayContaining(["'self'", "blob:", "https:"]));
    expect(policy.get("connect-src")).toContain("https://*.r2.cloudflarestorage.com");
    expect(policy.get("worker-src")).toEqual(["'self'", "blob:"]);
  });

  it("frames only Turnstile, the privacy-enhanced YouTube player, Vimeo and this origin", () => {
    for (const surface of ["app", "public-funnel"] as const) {
      expect(directives(buildContentSecurityPolicy({ nonce: NONCE, surface })).get("frame-src")).toEqual([
        "'self'", "https://challenges.cloudflare.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com",
      ]);
    }
  });

  it("drops hosts the browser never contacts (server-only PostHog, PayUni API, Cloudflare API)", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, surface: "public-funnel" });
    for (const host of ["posthog.com", "api.cloudflare.com", "*.payuni.com.tw"]) expect(policy).not.toContain(host);
    expect(directives(policy).get("connect-src")).not.toContain("https:");
  });

  it("public funnel pages add only the analytics hosts and https styles for static custom-code frames", () => {
    const app = directives(buildContentSecurityPolicy({ nonce: NONCE, surface: "app" }));
    const funnel = directives(buildContentSecurityPolicy({ nonce: NONCE, surface: "public-funnel" }));
    expect(funnel.get("script-src")).toEqual([...app.get("script-src")!, "https://www.googletagmanager.com", "https://connect.facebook.net"]);
    expect(funnel.get("style-src")).toEqual(["'self'", "'unsafe-inline'", "https:"]);
    expect(funnel.get("font-src")).toEqual(app.get("font-src"));
    expect(funnel.get("connect-src")).toContain("https://www.google-analytics.com");
    expect(funnel.get("connect-src")).toContain("https://www.facebook.com");
    expect(app.get("font-src")).toEqual(["'self'", "data:", "https:"]);
    expect(app.get("connect-src")).not.toContain("https://www.google-analytics.com");
  });

  it("previews nonce-only <style> elements with nothing but the style and report directives", () => {
    const policy = directives(buildStylePreviewPolicy(NONCE));
    expect([...policy.keys()]).toEqual(["style-src-elem", "style-src-attr", "report-uri", "report-to"]);
    expect(policy.get("style-src-elem")).toEqual(["'self'", `'nonce-${NONCE}'`]);
    expect(policy.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
    expect(() => buildStylePreviewPolicy("bad")).toThrow("Invalid CSP nonce");
  });

  it("refuses a malformed nonce", () => {
    expect(() => buildContentSecurityPolicy({ nonce: "x'; script-src *", surface: "app" })).toThrow("Invalid CSP nonce");
  });
});

describe("CSP headers and the CSP_ENFORCE switch", () => {
  it("sends only Report-Only by default", () => {
    const set = contentSecurityPolicyHeaders({ nonce: NONCE, surface: "app", enforce: false });
    expect(set.response["Content-Security-Policy"]).toBeUndefined();
    expect(set.response["Content-Security-Policy-Report-Only"]).toBe(set.requestPolicy);
    expect(set.response["Reporting-Endpoints"]).toBe(`${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`);
  });

  it("enforces the policy and adds only the style preview on app pages when enabled", () => {
    const app = contentSecurityPolicyHeaders({ nonce: NONCE, surface: "app", enforce: true });
    expect(app.response["Content-Security-Policy"]).toBe(app.requestPolicy);
    expect(app.response["Content-Security-Policy-Report-Only"]).toBe(buildStylePreviewPolicy(NONCE));
    expect(app.response["Content-Security-Policy"]).not.toContain("style-src-elem");
    const funnel = contentSecurityPolicyHeaders({ nonce: NONCE, surface: "public-funnel", enforce: true });
    expect(funnel.response["Content-Security-Policy"]).toBe(funnel.requestPolicy);
    expect(funnel.response["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it.each([
    [undefined, { valid: true, enforce: false }],
    ["", { valid: true, enforce: false }],
    ["false", { valid: true, enforce: false }],
    [" TRUE ", { valid: true, enforce: true }],
    ["true", { valid: true, enforce: true }],
    ["1", { valid: false, enforce: false }],
    ["yes", { valid: false, enforce: false }],
    ["enforce", { valid: false, enforce: false }],
  ])("parses CSP_ENFORCE=%j", (value, expected) => {
    expect(parseCspEnforce(value)).toEqual(expected);
  });

  it("generates a fresh 128-bit base64 nonce per call", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createCspNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(isValidCspNonce(nonce)).toBe(true);
    expect(isValidCspNonce("short")).toBe(false);
    expect(isValidCspNonce(`${NONCE}'`)).toBe(false);
  });

  it("maps public funnel paths to their surface", () => {
    expect(cspSurfaceForPath("/lp/summer")).toBe("public-funnel");
    expect(cspSurfaceForPath("/browser-qa/funnel-elements")).toBe("public-funnel");
    expect(cspSurfaceForPath("/dashboard")).toBe("app");
    expect(cspSurfaceForPath("/lpx")).toBe("app");
  });
});

describe("custom-code sandbox document policy", () => {
  it("is sandboxed without same-origin, blocks network APIs and can only be framed by this origin", () => {
    const policy = directives(FUNNEL_CUSTOM_CODE_SANDBOX_CSP);
    expect(policy.get("sandbox")).toEqual(["allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox"]);
    expect(FUNNEL_CUSTOM_CODE_SANDBOX_CSP).not.toContain("allow-same-origin");
    expect(FUNNEL_CUSTOM_CODE_SANDBOX_CSP).not.toContain("allow-top-navigation");
    expect(FUNNEL_CUSTOM_CODE_SANDBOX_CSP).not.toContain("allow-forms");
    for (const name of ["connect-src", "form-action", "base-uri", "object-src", "worker-src"]) expect(policy.get(name)).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'self'"]);
    expect(policy.get("script-src")).toEqual(["'unsafe-inline'", "https:"]);
    expect(FUNNEL_CUSTOM_CODE_SANDBOX_HEADERS["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(FUNNEL_CUSTOM_CODE_SANDBOX_HEADERS["Content-Security-Policy"]).toBe(FUNNEL_CUSTOM_CODE_SANDBOX_CSP);
  });
});
