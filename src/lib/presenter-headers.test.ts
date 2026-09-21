import { describe, expect, it, vi } from "vitest";
vi.mock("@sentry/nextjs", () => ({ withSentryConfig: (config: unknown) => config }));
import config from "../../next.config";
describe("studio capture permissions", () => {
  it("keeps global capture denied and only overrides the instructor document after the global rule", async () => {
    const rules = await config.headers!();
    const global = rules.findIndex(rule => rule.source === "/:path*");
    const studio = rules.findIndex(rule => rule.source === "/lives/:id/presenter");
    expect(studio).toBeGreaterThan(global);
    expect(rules[global]?.headers.find(header => header.key === "Permissions-Policy")?.value).toContain("camera=(), microphone=()");
    expect(rules[studio]?.headers.find(header => header.key === "Permissions-Policy")?.value).toBe("camera=(self), microphone=(self), display-capture=(self), geolocation=(), browsing-topics=()");
    expect(rules.filter(rule => rule.headers.some(header => header.value.includes("camera=(self)")))).toHaveLength(1);
  });
});
