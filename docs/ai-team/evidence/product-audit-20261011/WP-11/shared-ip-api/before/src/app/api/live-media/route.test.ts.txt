import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), limit: vi.fn(), sameOrigin: vi.fn(), admission: vi.fn(), token: vi.fn(), hash: vi.fn(), readiness: vi.fn(), start: vi.fn(), stop: vi.fn(), live: vi.fn(), liveUpdate: vi.fn(), find: vi.fn(), expired: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: m.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ live: { findFirst: m.live, updateMany: m.liveUpdate }, liveMediaSession: { findFirst: m.find, findMany: m.expired, create: m.create, updateMany: m.update, deleteMany: m.remove } }) }));
vi.mock("@/lib/api-security", async (original) => ({ ...await original<typeof import("@/lib/api-security")>(), requireSameOriginRequest: m.sameOrigin }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.limit }));
vi.mock("@/lib/live-quota-admission", () => ({ hasActiveLiveViewerSession: m.admission, liveViewerTokenFromRequest: m.token, hashLiveViewerToken: m.hash }));
vi.mock("@/lib/live-runtime-readiness", () => ({ getRuntimeLivePublishReadiness: m.readiness }));
vi.mock("@/lib/live-media-provider", () => ({ mediaOrigin: m.origin, mediaPath: (vendor: string, live: string) => `${vendor}/${live}`, startMediaSession: m.start, stopMediaSession: m.stop }));
vi.mock("@/lib/live-media-cleanup", () => ({ cleanupMediaSessions: m.cleanup }));
import { POST } from "./route";

const offer = { action: "offer", liveId: "live-1", direction: "publish", sdp: "v=0\r\n" };
const live = { id: "live-1", videoId: "video-1", video: { vendorId: "vendor-1", sourceType: "browser_live" }, streamMode: "live", status: "scheduled" };
function request(body: unknown) { return new Request("https://app.example.test/api/live-media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ vendor: { id: "vendor-1" }, member: { id: "member-1", status: "active", role: "owner" } });
  m.origin.mockReturnValue("https://media.example.test"); m.sameOrigin.mockReturnValue(null); m.limit.mockResolvedValue(null);
  m.token.mockReturnValue("viewer-token-A"); m.hash.mockImplementation((token: string) => `hash-${token}`); m.admission.mockResolvedValue(true);
  m.live.mockResolvedValue(live); m.readiness.mockReturnValue({ ready: true }); m.expired.mockResolvedValue([]);
  m.start.mockResolvedValue({ answer: "v=0\r\nanswer", resourcePath: "/private/upstream-session" });
  m.create.mockResolvedValue({ id: "session-1" }); m.update.mockResolvedValue({ count: 1 }); m.remove.mockResolvedValue({ count: 1 }); m.stop.mockResolvedValue(undefined);
  m.find.mockResolvedValue(null); m.cleanup.mockResolvedValue(undefined);
});

describe("live media authorization and session scope", () => {
  it.each(["owner", "admin"])("allows active %s to publish without exposing upstream paths", async role => {
    m.auth.mockResolvedValue({ vendor: { id: "vendor-1" }, member: { id: "member-1", status: "active", role } });
    const result = await POST(request(offer));
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ answer: "v=0\r\nanswer", sessionId: "session-1" });
    expect(m.start).toHaveBeenCalledWith("https://media.example.test", "vendor-1/live-1", "publish", offer.sdp);
    expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: "vendor-1", principal: "instructor:member-1", direction: "publish" }) });
  });
  it.each([null, { vendor: { id: "vendor-1" }, member: { status: "inactive", role: "owner" } }, { vendor: { id: "vendor-1" }, member: { status: "active", role: "viewer" } }])("denies non-managers and inactive members", async auth => {
    m.auth.mockResolvedValue(auth); expect((await POST(request(offer))).status).toBe(403); expect(m.start).not.toHaveBeenCalled();
  });
  it("denies a mismatched tenant before reading live data", async () => {
    expect((await POST(request({ ...offer, vendorId: "another-vendor" }))).status).toBe(403); expect(m.live).not.toHaveBeenCalled();
  });
  it("requires active viewer admission and scopes read sessions to a token hash", async () => {
    m.admission.mockResolvedValueOnce(false);
    const read = { ...offer, vendorId: "vendor-1", direction: "read" };
    expect((await POST(request(read))).status).toBe(401); expect(m.start).not.toHaveBeenCalled();
    m.live.mockResolvedValue({ ...live, status: "live" });
    expect((await POST(request(read))).status).toBe(200);
    expect(m.admission).toHaveBeenCalledWith(expect.anything(), { vendorId: "vendor-1", liveId: "live-1", token: "viewer-token-A" });
    expect(m.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ principal: "viewer:hash-viewer-token-A", direction: "read" }) });
    expect(m.auth).not.toHaveBeenCalled();
  });
  it("does not stop a session belonging to a different viewer token", async () => {
    m.token.mockReturnValue("viewer-token-B"); m.find.mockResolvedValue(null);
    const result = await POST(request({ action: "stop", liveId: "live-1", vendorId: "vendor-1", direction: "read", sessionId: "session-of-A" }));
    expect(result.status).toBe(200);
    expect(m.find).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", liveId: "live-1", principal: "viewer:hash-viewer-token-B", direction: "read", id: "session-of-A" } });
    expect(m.stop).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
  });
  it("stops only the owned scoped session even after the live has ended", async () => {
    m.find.mockResolvedValue({ id: "session-1", resourcePath: "/owned" });
    expect((await POST(request({ action: "stop", liveId: "live-1", direction: "publish", sessionId: "session-1" }))).status).toBe(200);
    expect(m.stop).toHaveBeenCalledWith("https://media.example.test", "/owned");
    expect(m.update).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", liveId: "live-1", principal: "instructor:member-1", direction: "publish", id: "session-1" }, data: { closing: true } });
    expect(m.update.mock.invocationCallOrder[0]).toBeLessThan(m.stop.mock.invocationCallOrder[0]!);
    expect(m.remove).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", liveId: "live-1", principal: "instructor:member-1", direction: "publish", id: "session-1" } });
    expect(m.live).not.toHaveBeenCalled();
  });
  it.each([{ ...offer, extra: true }, { ...offer, sdp: "invalid" }, { ...offer, sdp: `v=0${"x".repeat(65000)}` }])("rejects malformed and oversized payloads", async payload => {
    expect((await POST(request(payload))).status).toBe(400); expect(m.start).not.toHaveBeenCalled();
  });
  it("fails closed on wrong video ownership and incomplete readiness", async () => {
    m.live.mockResolvedValueOnce({ ...live, video: { ...live.video, vendorId: "other" } });
    expect((await POST(request(offer))).status).toBe(409);
    m.readiness.mockReturnValue({ ready: false }); expect((await POST(request(offer))).status).toBe(409); expect(m.start).not.toHaveBeenCalled();
  });
  it("requires the instructor to be live before viewers connect", async () => {
    expect((await POST(request({ ...offer, direction: "read", vendorId: "vendor-1" }))).status).toBe(409); expect(m.start).not.toHaveBeenCalled();
  });
  it("does not revive expired heartbeat sessions", async () => {
    m.update.mockResolvedValue({ count: 0 });
    expect((await POST(request({ action: "heartbeat", direction: "publish", liveId: "live-1", sessionId: "expired" }))).status).toBe(410);
    expect(m.liveUpdate).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "expired", principal: "instructor:member-1", closing: false, expiresAt: { gt: expect.any(Date) } }) }));
  });
  it("rejects another offer for an existing scoped session after bounded cleanup", async () => {
    m.find.mockResolvedValue({ id: "existing-session" });
    expect((await POST(request(offer))).status).toBe(409);
    expect(m.cleanup).toHaveBeenCalledWith(expect.anything(), "https://media.example.test", { vendorId: "vendor-1", liveId: "live-1" });
    expect(m.cleanup.mock.invocationCallOrder[0]).toBeLessThan(m.find.mock.invocationCallOrder[0]!);
    expect(m.start).not.toHaveBeenCalled();
  });
  it("retains a closing session for cleanup retry if upstream stop fails", async () => {
    m.find.mockResolvedValue({ id: "session-1", resourcePath: "/owned" });
    m.stop.mockRejectedValue(new Error("synthetic unavailable"));
    expect((await POST(request({ action: "stop", liveId: "live-1", direction: "publish", sessionId: "session-1" }))).status).toBe(503);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { closing: true } }));
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("cleans up upstream allocation if persistence fails", async () => {
    m.create.mockRejectedValue(new Error("synthetic database failure"));
    const response = await POST(request(offer)); expect(response.status).toBe(503);
    expect(m.stop).toHaveBeenCalledWith("https://media.example.test", "/private/upstream-session");
    expect(await response.text()).not.toContain("synthetic");
  });
  it("short-circuits origin and rate-limit rejection", async () => {
    m.sameOrigin.mockReturnValueOnce(new Response(null, { status: 403 })); expect((await POST(request(offer))).status).toBe(403); expect(m.limit).not.toHaveBeenCalled();
    m.limit.mockResolvedValueOnce(new Response(null, { status: 429 })); expect((await POST(request(offer))).status).toBe(429); expect(m.auth).not.toHaveBeenCalled();
  });
});
