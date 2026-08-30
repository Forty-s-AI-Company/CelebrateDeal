import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  withSentryConfig: (config: unknown) => config,
}));

import nextConfig from "./next.config";

describe("Next production security configuration", () => {
  it("does not expose the built-in optimizer as an arbitrary remote image proxy", () => {
    expect(nextConfig.images).toEqual({ unoptimized: true });
  });

  it("sets HSTS and the existing browser security headers on every route", async () => {
    const rules = await nextConfig.headers?.();
    const headers = new Map(rules?.[0]?.headers.map((header) => [header.key, header.value]));

    expect(rules?.[0]?.source).toBe("/:path*");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy-Report-Only")).toContain("frame-ancestors 'none'");
  });
});
