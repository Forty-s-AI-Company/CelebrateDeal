import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), ip: vi.fn(), viewer: vi.fn(), admission: vi.fn(), cookie: vi.fn(), chat: vi.fn(), ingest: vi.fn(), clock: vi.fn(), ready: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ $queryRaw: mocks.clock }) }));
vi.mock("@/lib/trusted-entry-rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/live-chat-request-security", () => ({ getLiveChatClientIp: mocks.ip }));
vi.mock("@/lib/live-quota-admission", () => ({ liveViewerTokenFromRequest: mocks.cookie, hashLiveViewerToken: () => "synthetic-hash" }));
vi.mock("@/lib/live-chat", () => ({ chatSessionTokenFromRequest: mocks.chat, resolveVerifiedPrivateChatViewer: mocks.viewer, LiveChatError: class extends Error {} }));
vi.mock("@/lib/live-metric-session", async (original) => ({ ...await original<typeof import("@/lib/live-metric-session")>(), issueMetricSession: mocks.ingest }));
vi.mock("@/lib/live-metric-version", () => ({ resolveMetricSessionContext: vi.fn() }));
vi.mock("@/lib/live-metric-readiness", () => ({ metricCollectionReady: mocks.ready }));
import { POST, GET } from "./route";
import { LiveChatError } from "@/lib/live-chat";
import { MetricIngestError } from "@/lib/live-metric-ingestion";
import { parseMetricSessionRequest, MetricSessionLimitError } from "@/lib/live-metric-session";
const tx = { liveViewerSession: { findUnique: mocks.admission } };
const payload = { requestId: "de305d54-75b4-431b-adb2-eb6b9e546014" };
function request(body = JSON.stringify(payload), headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/live-metrics/vendor/live/sessions", { method: "POST", headers: { origin: "http://localhost", "x-celebratedeal-client": "web", ...headers }, body });
}
const context = () => ({ params: Promise.resolve({ vendorId: "vendor", liveId: "live" }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.clock.mockResolvedValue([{ now: new Date(5000) }]);
  mocks.limit.mockResolvedValue(null); mocks.ip.mockReturnValue("192.0.2.1");
  mocks.cookie.mockReturnValue("synthetic-admission"); mocks.chat.mockReturnValue("synthetic-chat");
  mocks.viewer.mockResolvedValue({ submissionId: "verified-submission" });
  mocks.admission.mockResolvedValue({ id: "admission", vendorId: "vendor", liveId: "live" });
  mocks.ready.mockImplementation(async (_db, authorize, resolveContext) => {
    expect(typeof resolveContext).toBe("function");
    expect(await authorize(tx, "resolve")).toEqual({ vendorId: "vendor", liveId: "live", submissionId: "verified-submission", admissionId: "admission" });
    await authorize(tx, "revalidate"); return true;
  });
  // Exercise the actual parser and route authorization callback; DB writes are covered separately.
  mocks.ingest.mockImplementation(async (_db, authorize, resolveContext, body, options) => {
    expect(options).toEqual({ requirePlaybackIntake: true, renewPlaybackIntake: true });
    parseMetricSessionRequest(body);
    expect(typeof resolveContext).toBe("function");
    expect(await authorize(tx, "resolve")).toEqual({ vendorId: "vendor", liveId: "live", submissionId: "verified-submission", admissionId: "admission" });
    await authorize(tx, "revalidate");
    return { sessionId: "synthetic-session" };
  });
});
describe("read-only metric eligibility", () => {
  const get = (headers: Record<string,string> = {}) => GET(new Request("http://localhost/api/live-metrics/vendor/live/sessions", {
    headers: { origin: "http://localhost", "x-celebratedeal-client": "web", ...headers },
  }),context());
  it("reauthorizes and returns only readiness without issuing a session", async () => {
    const response = await get(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ready: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.viewer).toHaveBeenCalledTimes(2); expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it("rejects cross-origin before resolving any identity", async () => {
    expect((await get({ origin: "https://foreign.example.test" })).status).toBe(403);
    expect(mocks.ready).not.toHaveBeenCalled(); expect(mocks.viewer).not.toHaveBeenCalled();
  });
  it.each(["cookie", "chat"] as const)("requires %s credential", async key => {
    mocks[key].mockReturnValue(null); const response = await get(); expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ready: false }); expect(mocks.ready).not.toHaveBeenCalled();
  });
  it("refuses revoked viewer and foreign admission without disclosing details", async () => {
    mocks.admission.mockResolvedValue({ id: "a", vendorId: "other", liveId: "live" });
    expect((await get()).status).toBe(403); expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it("returns false when collection cannot start", async () => {
    mocks.ready.mockResolvedValue(false); const response=await get();
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ready:false});
  });
  it("requires trusted request source", async () => {
    mocks.ip.mockReturnValue(null); expect((await get()).status).toBe(503); expect(mocks.ready).not.toHaveBeenCalled();
  });
  it("keeps rate limiting private", async () => {
    mocks.limit.mockResolvedValue(new Response("limited",{status:429})); const response=await get();
    expect(response.status).toBe(429); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.ready).not.toHaveBeenCalled();
  });
  it("does not expose unexpected errors", async () => {
    mocks.ready.mockRejectedValue(new Error("synthetic-private-SQL")); const response=await get();
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ready:false});
  });
  it("reports a retryable conflict as temporary unavailability", async () => {
    mocks.ready.mockRejectedValue(new MetricIngestError("retryable_conflict"));
    const response=await get();
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ready:false});
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});
describe("metric session HTTP boundary", () => {
  it("resolves server identity on the ingestion transaction and returns a private receipt", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, sessionId: "synthetic-session", serverNowAtMs: 5000 });
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
  it("returns a private retry response when the admission session quota is full", async () => {
    mocks.ingest.mockRejectedValue(new MetricSessionLimitError());
    const response = await POST(request(), context());
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(["admission_total", "registration_total"] as const)("does not advise retries for exhausted %s", async (reason) => {
    mocks.ingest.mockRejectedValue(new MetricSessionLimitError(reason));
    const response = await POST(request(), context());
    expect(response.status).toBe(409); expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.json()).toEqual({ error: "Metric session limit reached", retryable: false });
  });
  it("does not expose unexpected database errors", async () => {
    mocks.ingest.mockRejectedValue(new Error("synthetic-private-SQL")); const response = await POST(request(), context());
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("synthetic-private-SQL");
  });
});
