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

  it("allows Cloudflare Turnstile's script, iframe and calls in the report-only CSP", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: config } = await import("./next.config");
    const rules = await config.headers!();
    const csp = rules.find((rule) => rule.source === "/:path*")!.headers.find((header) => header.key === "Content-Security-Policy-Report-Only")!.value;
    const directive = (name: string) => csp.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
    for (const name of ["script-src", "frame-src", "connect-src"]) expect(directive(name)).toContain("https://challenges.cloudflare.com");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("allows only the privacy-enhanced YouTube host as an extra frame source", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: config } = await import("./next.config");
    const rules = await config.headers!();
    const csp = rules.find((rule) => rule.source === "/:path*")!.headers.find((header) => header.key === "Content-Security-Policy-Report-Only")!.value;
    const frameSrc = csp.split("; ").find((part) => part.startsWith("frame-src ")) ?? "";
    expect(frameSrc).toBe("frame-src 'self' https://challenges.cloudflare.com https://www.youtube-nocookie.com");
  });

  it("sends no Referer from the verification page and its confirm API, overriding the site-wide policy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: config } = await import("./next.config");
    const rules = await config.headers!();
    const siteWide = rules.findIndex((rule) => rule.source === "/:path*");
    for (const source of ["/verify-email", "/api/auth/email-verification/confirm"]) {
      const index = rules.findIndex((rule) => rule.source === source);
      // Next applies matching rules in order; the later one wins for the same key.
      expect(index).toBeGreaterThan(siteWide);
      expect(rules[index]!.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
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
