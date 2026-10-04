import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ wrap: vi.fn((config) => config) }));
vi.mock("@sentry/nextjs", () => ({ withSentryConfig: sentry.wrap }));

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
