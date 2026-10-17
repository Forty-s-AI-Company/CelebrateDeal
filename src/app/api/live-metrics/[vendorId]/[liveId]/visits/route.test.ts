import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { MetricVisitorError } from "@/lib/live-metric-visitor";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), prepare: vi.fn(), collect: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/trusted-entry-rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ synthetic: true }) }));
vi.mock("@/lib/live-metric-visit-collection", () => ({ prepareTrackedMetricVisit: mocks.prepare, collectPreparedMetricVisit: mocks.collect }));
vi.mock("@/lib/live-metric-visitor-config", () => ({ metricVisitorProofsFromConfig: mocks.config }));
const params = () => ({ params: Promise.resolve({ vendorId: "v", liveId: "l" }) });
const receipt = { proof: "synthetic-proof", visitorId: "synthetic-visitor", expiresAtMs: 1_900_000_000_000, cookieExpiresAtMs: 2_000_000_000_000, versionId: "version" };
function request(body = '{"action":"prepare","eventId":"10000000-0000-4000-8000-000000000001"}', origin = "https://example.test", cookie?: string) {
  return new NextRequest("https://example.test/api/live-metrics/v/l/visits", { method: "POST", headers: {
    origin, "x-celebratedeal-client": "web", "content-type": "application/json", ...(cookie ? { cookie } : {}),
  }, body });
}
beforeEach(() => { vi.clearAllMocks(); mocks.limit.mockResolvedValue(null); mocks.config.mockReturnValue({ synthetic: true }); mocks.prepare.mockResolvedValue(receipt); mocks.collect.mockResolvedValue(receipt); });
describe("metric visit HTTP", () => {
  it("sets a secure scoped HttpOnly cookie without disclosing identity in JSON", async () => {
    const response = await POST(request(), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, prepared: true, versionId: "version" });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-cd-metric-[0-9a-f]{32}=synthetic-proof;/);
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure");
    expect(cookie).toContain(`Expires=${new Date(receipt.cookieExpiresAtMs).toUTCString()}`);
    expect(cookie).toContain("SameSite=strict"); expect(cookie).toContain("Path=/");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledWith(expect.anything(), expect.anything(), {vendorId:"v",liveId:"l"}, null,
      {eventId:"10000000-0000-4000-8000-000000000001"});
  });
  it("carries the prepared cookie into the proven collector", async () => {
    const prepared = await POST(request(), params()); const cookie = prepared.headers.get("set-cookie")!.split(";")[0];
    const eventId = "10000000-0000-4000-8000-000000000001";
    const response = await POST(request(JSON.stringify({ action: "visit", eventId }), undefined, cookie), params());
    expect(response.status).toBe(200);
    expect(mocks.collect).toHaveBeenCalledWith(expect.anything(), expect.anything(), { vendorId: "v", liveId: "l" }, { eventId }, "synthetic-proof");
    expect(await response.json()).toEqual({ ok: true, eventId, versionId: "version" });
  });
  it("rejects cross-origin requests before any service or limit call", async () => {
    expect((await POST(request(undefined, "https://foreign.test"), params())).status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each(['{}', '{', '{"action":"prepare"}', '{"action":"prepare","visitorId":"forged"}', 'x'.repeat(1025)])("rejects malformed or injected body %#", async body => {
    expect((await POST(request(body), params())).status).toBe(400); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("fails closed for unavailable configuration and rate limiting", async () => {
    mocks.config.mockReturnValue(null); expect((await POST(request(), params())).status).toBe(503);
    mocks.limit.mockResolvedValue(new Response(null, { status: 429 }));
    const response = await POST(request(), params()); expect(response.status).toBe(429); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each([["PROOF_INVALID", 403], ["VISITOR_MISSING", 403], ["SCOPE_UNAVAILABLE", 404], ["PERSISTENCE_UNAVAILABLE", 503]] as const)("maps %s without setting a proof", async (code, status) => {
    mocks.prepare.mockRejectedValue(new MetricVisitorError(code));
    const response = await POST(request(), params()); expect(response.status).toBe(status); expect(response.headers.get("set-cookie")).toBeNull();
  });
});
