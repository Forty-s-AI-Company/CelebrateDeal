import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), ip: vi.fn(), viewer: vi.fn(), admission: vi.fn(), cookie: vi.fn(), chat: vi.fn(), ingest: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/trusted-entry-rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/live-chat-request-security", () => ({ getLiveChatClientIp: mocks.ip }));
vi.mock("@/lib/live-quota-admission", () => ({ liveViewerTokenFromRequest: mocks.cookie, hashLiveViewerToken: () => "synthetic-hash" }));
vi.mock("@/lib/live-chat", () => ({ chatSessionTokenFromRequest: mocks.chat, resolveVerifiedPrivateChatViewer: mocks.viewer, LiveChatError: class extends Error {} }));
vi.mock("@/lib/live-metric-close", async (original) => ({ ...await original<typeof import("@/lib/live-metric-close")>(), closeMetricSession: mocks.ingest }));
vi.mock("@/lib/live-metric-version", () => ({ resolveMetricSessionContext: vi.fn() }));
import { POST } from "./route";
import { LiveChatError } from "@/lib/live-chat";
import { MetricIngestError } from "@/lib/live-metric-ingestion";
import { parseMetricClose } from "@/lib/live-metric-close";
const tx = { liveViewerSession: { findUnique: mocks.admission } };
const payload = { sessionId: "session-1", finalSequence: 0 };
function request(body = JSON.stringify(payload), headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/live-metrics/vendor/live/close", { method: "POST", headers: { origin: "http://localhost", "x-celebratedeal-client": "web", ...headers }, body });
}
const context = () => ({ params: Promise.resolve({ vendorId: "vendor", liveId: "live" }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(null); mocks.ip.mockReturnValue("192.0.2.1");
  mocks.cookie.mockReturnValue("synthetic-admission"); mocks.chat.mockReturnValue("synthetic-chat");
  mocks.viewer.mockResolvedValue({ submissionId: "verified-submission" });
  mocks.admission.mockResolvedValue({ id: "admission", vendorId: "vendor", liveId: "live" });
  // Exercise the actual parser and route authorization callback; DB writes are covered separately.
  mocks.ingest.mockImplementation(async (_db, authorize, body, resolveVersion) => {
    parseMetricClose(body);
    expect(typeof resolveVersion).toBe("function");
    expect(await authorize(tx, "resolve")).toEqual({ vendorId: "vendor", liveId: "live", submissionId: "verified-submission", admissionId: "admission" });
    await authorize(tx, "revalidate");
    return { deliveryComplete: true };
  });
});
describe("metric close HTTP boundary", () => {
  it("resolves server identity on the ingestion transaction and returns a private receipt", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, deliveryComplete: true });
    expect(mocks.viewer).toHaveBeenCalledWith(tx, expect.objectContaining({ vendorId: "vendor", liveId: "live", ipAddress: "192.0.2.1" }));
  });
  it.each<Record<string, string>>([{ origin: "https://invalid.example" }, { "x-celebratedeal-client": "" }])("rejects cross-origin or untrusted clients", async (headers) => {
    expect((await POST(request(undefined, headers), context())).status).toBe(403);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it("preserves limiter retry headers", async () => {
    mocks.limit.mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    const response = await POST(request(), context());
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it("rejects missing trusted source", async () => { mocks.ip.mockReturnValue(null); expect((await POST(request(), context())).status).toBe(503); });
  it("rejects invalid path scope", async () => { expect((await POST(request(), { params: Promise.resolve({ vendorId: "../x", liveId: "live" }) })).status).toBe(400); });
  it("rejects missing admission", async () => { mocks.cookie.mockReturnValue(null); expect((await POST(request(), context())).status).toBe(403); expect(mocks.ingest).not.toHaveBeenCalled(); });
  it("rejects missing registration credential", async () => { mocks.chat.mockReturnValue(null); expect((await POST(request(), context())).status).toBe(403); expect(mocks.ingest).not.toHaveBeenCalled(); });
  it("rejects failed canonical viewer verification", async () => { mocks.viewer.mockRejectedValue(Object.assign(Object.create(LiveChatError.prototype), { message: "synthetic-denial" })); expect((await POST(request(), context())).status).toBe(403); expect(mocks.admission).not.toHaveBeenCalled(); });
  it("returns 403 when locked revalidation detects a newly blocked viewer", async () => { mocks.viewer.mockResolvedValueOnce({ submissionId: "verified-submission" }).mockRejectedValueOnce(Object.create(LiveChatError.prototype)); expect((await POST(request(), context())).status).toBe(403); expect(mocks.viewer).toHaveBeenCalledTimes(2); });
  it("rejects admission belonging to another tenant", async () => { mocks.admission.mockResolvedValue({ id: "admission", vendorId: "other", liveId: "live" }); expect((await POST(request(), context())).status).toBe(403); });
  it.each(["{", "x".repeat(1025), JSON.stringify({ ...payload, submissionId: "forged" })])("rejects malformed, oversized and identity-bearing payloads", async (body) => {
    expect((await POST(request(body), context())).status).toBe(400); expect(mocks.viewer).not.toHaveBeenCalled();
  });
  it.each([ ["not_authorized", 403], ["invalid_segment", 422], ["sequence_conflict", 409], ["session_closed", 409], ["evidence_rejected", 409], ["retryable_conflict", 503] ] as const)("maps %s without internal details", async (code, status) => {
    mocks.ingest.mockRejectedValue(new MetricIngestError(code)); const response = await POST(request(), context());
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("returns 202 for a declared close that is still missing sequences", async () => { mocks.ingest.mockResolvedValue({ deliveryComplete: false, appendOpen: true }); expect((await POST(request(), context())).status).toBe(202); });
  it("returns 200 with an incomplete terminal receipt when appends are no longer possible", async () => { mocks.ingest.mockResolvedValue({ deliveryComplete: false, appendOpen: false }); const response = await POST(request(), context()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, deliveryComplete: false, appendOpen: false }); });
  it("does not expose unexpected database errors", async () => {
    mocks.ingest.mockRejectedValue(new Error("synthetic-private-SQL")); const response = await POST(request(), context());
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("synthetic-private-SQL");
  });
});
