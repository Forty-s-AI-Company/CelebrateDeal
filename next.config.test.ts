import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ wrap: vi.fn((config) => config) }));
vi.mock("@sentry/nextjs/config", () => ({ withSentryConfig: sentry.wrap }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("isolated development build configuration", () => {
  it("keeps the default build directory and monitoring tunnel in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FUNNEL_ELEMENTS_E2E", "false");
    const { default: config } = await import("./next.config");
    expect(config).not.toHaveProperty("distDir");
    expect(sentry.wrap).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tunnelRoute: "/monitoring" }));
  });

  it("keeps every site-wide security header and leaves the per-request nonce CSP to the proxy (F-156)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: config } = await import("./next.config");
    const rules = await config.headers!();
    const site = rules.find((rule) => rule.source === "/:path*")!.headers;
    expect(Object.fromEntries(site.map((header) => [header.key, header.value]))).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    });
    // A static CSP here would carry no nonce and, as a configured header, would replace the proxy's.
    expect(rules.some((rule) => rule.headers.some((header) => /^Content-Security-Policy/u.test(header.key) && rule.source !== "/sandbox/custom-code"))).toBe(false);
  });

  it("gives public funnel pages COOP same-origin and nothing broader", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: config } = await import("./next.config");
    const rules = await config.headers!();
    const siteWide = rules.findIndex((rule) => rule.source === "/:path*");
    for (const source of ["/lp/:path*", "/browser-qa/:path*"]) {
      const index = rules.findIndex((rule) => rule.source === source);
      expect(index).toBeGreaterThan(siteWide);
      expect(rules[index]!.headers).toEqual([{ key: "Cross-Origin-Opener-Policy", value: "same-origin" }]);
    }
    expect(rules[siteWide]!.headers.some((item) => item.key === "Cross-Origin-Opener-Policy")).toBe(false);
  });

  it("lets only this origin frame the custom-code sandbox document, under its own sandbox CSP", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: config } = await import("./next.config");
    const rules = await config.headers!();
    const siteWide = rules.findIndex((rule) => rule.source === "/:path*");
    const index = rules.findIndex((rule) => rule.source === "/sandbox/custom-code");
    // Later rules override the site-wide X-Frame-Options: DENY for the same key.
    expect(index).toBeGreaterThan(siteWide);
    const header = (key: string) => rules[index]!.headers.find((item) => item.key === key)?.value;
    expect(header("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(header("Content-Security-Policy")).toMatch(/^sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none';/u);
    expect(header("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    expect(header("Content-Security-Policy")).toContain("connect-src 'none'");
    expect(header("Referrer-Policy")).toBe("no-referrer");
    // Only this one path relaxes X-Frame-Options.
    expect(rules.filter((rule) => rule.headers.some((item) => item.key === "X-Frame-Options" && item.value !== "DENY")).map((rule) => rule.source)).toEqual(["/sandbox/custom-code"]);
  });

  it("sends no Referer from the verification page and its confirm API, overriding the site-wide policy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: config } = await import("./next.config");
    const rules = await config.headers!();
    const siteWide = rules.findIndex((rule) => rule.source === "/:path*");
    for (const source of ["/verify-email", "/api/auth/email-verification/confirm", "/verify-email-change", "/api/auth/email-change/confirm", "/revert-email-change", "/api/auth/email-change/revert", "/api/live-session-switch"]) {
      const index = rules.findIndex((rule) => rule.source === source);
      // Next applies matching rules in order; the later one wins for the same key.
      expect(index).toBeGreaterThan(siteWide);
      expect(rules[index]!.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
  });

  it("keeps the session switch page's Referer same-origin so its confirm POST carries a real Origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: config } = await import("./next.config");
    const rules = await config.headers!();
    const siteWide = rules.findIndex((rule) => rule.source === "/:path*");
    const index = rules.findIndex((rule) => rule.source === "/live-session-switch");
    expect(index).toBeGreaterThan(siteWide);
    expect(rules[index]!.headers).toEqual([{ key: "Referrer-Policy", value: "same-origin" }]);
  });

  it("isolates explicitly requested funnel QA builds inside the project", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FUNNEL_ELEMENTS_E2E", "true");
    const { default: config } = await import("./next.config");
    expect(config.distDir).toBe(".next-funnel-elements");
    expect(config.images?.unoptimized).toBe(true);
  });

  it("disables only the development Sentry proxy and preserves local upload opt-out", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FUNNEL_ELEMENTS_E2E", "false");
    vi.stubEnv("SENTRY_DISABLE_AUTO_UPLOAD", "true");
    await import("./next.config");
    expect(sentry.wrap).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tunnelRoute: undefined,
      telemetry: false,
      widenClientFileUpload: false,
      sourcemaps: { disable: true },
    }));
  });
});
