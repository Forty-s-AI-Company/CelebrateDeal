import { beforeEach, describe, expect, it, vi } from "vitest";

const resolve = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://example.test" }));
vi.mock("@/lib/buyer-support-access", () => ({ resolveBuyerSupportGrant: resolve }));
import { GET } from "./route";

describe("post-purchase entry before streaming", () => {
  beforeEach(() => resolve.mockReset());
  it.each(["", "?grant=foreign/id", "?grant=a&grant=b", "?grant=a&offer=foreign"])("rejects invalid locators %s", async query => {
    const response = await GET(new Request(`https://example.test/checkout/upsell${query}`));
    expect(response.status).toBe(404);
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each([null, { order: { status: "paid", refundedAmountCents: 1 } }, { order: { status: "payment_failed", refundedAmountCents: 0 } }])("does not redirect unauthorized or refunded buyers", async grant => {
    resolve.mockResolvedValue(grant);
    const response = await GET(new Request("https://example.test/checkout/upsell?grant=original"));
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("preserves only the current authorized grant and scoped offer kind", async () => {
    resolve.mockResolvedValue({ order: { status: "paid", refundedAmountCents: 0 } });
    const response = await GET(new Request("http://internal-next.test/checkout/upsell?grant=original&offer=downsell&redirect=https://foreign.test"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/checkout/offer?grant=original&offer=downsell");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(resolve).toHaveBeenCalledWith({}, expect.anything(), "original");
  });
});
