import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTrackingDeliveryBinding, resolveTrackingExecutorMode } from "@/lib/tracking-executor-binding";

afterEach(() => vi.unstubAllEnvs());
describe("server-owned tracking execution binding", () => {
  it.each([
    [{}, null],
    [{ VERCEL_ENV: "preview", META_TRACKING_TEST_DELIVERY_ENABLED: "true" }, "test"],
    [{ VERCEL_ENV: "production", META_TRACKING_LIVE_DELIVERY_ENABLED: "true" }, "live"],
    [{ VERCEL_ENV: "production", META_TRACKING_TEST_DELIVERY_ENABLED: "true" }, null],
    [{ VERCEL_ENV: "preview", META_TRACKING_LIVE_DELIVERY_ENABLED: "true" }, null],
    [{ VERCEL_ENV: "development", META_TRACKING_TEST_DELIVERY_ENABLED: "true" }, null],
    [{ VERCEL_ENV: "production", META_TRACKING_TEST_DELIVERY_ENABLED: "true", META_TRACKING_LIVE_DELIVERY_ENABLED: "true" }, null],
  ] as const)("resolves only an explicitly enabled matching environment: %j", (environment, expected) => {
    expect(resolveTrackingExecutorMode(environment)).toBe(expected);
  });
  it("rejects a direct live call before explicit enablement and separates test codes", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "true");
    vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", "false");
    expect(() => assertTrackingDeliveryBinding("live", null)).toThrow(TypeError);
    expect(() => assertTrackingDeliveryBinding("test", null)).toThrow(TypeError);
    expect(() => assertTrackingDeliveryBinding("test", "TEST_SYNTHETIC")).not.toThrow();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "false");
    vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", "true");
    expect(() => assertTrackingDeliveryBinding("live", null)).not.toThrow();
    expect(() => assertTrackingDeliveryBinding("live", "TEST_SYNTHETIC")).toThrow(TypeError);
  });
});
