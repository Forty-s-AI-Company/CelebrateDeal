import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTER_LAYOUT } from "@/lib/presenter-layout";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), sameOrigin: vi.fn(), limit: vi.fn(), live: vi.fn(), update: vi.fn(), video: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: m.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ live: { findFirst: m.live }, $transaction: m.transaction }) }));
vi.mock("@/lib/api-security", async original => ({ ...await original<typeof import("@/lib/api-security")>(), requireSameOriginRequest: m.sameOrigin }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.limit }));
vi.mock("@/lib/live-media-provider", () => ({ mediaOrigin: m.origin }));
import { GET, POST } from "./route";

const live = { id: "live-1", title: "Workshop", slug: "test-live", streamMode: "vod", status: "scheduled", presenterLayout: null, video: { sourceType: "upload" } };
const payload = { liveId: "live-1", layout: DEFAULT_PRESENTER_LAYOUT };
function request(body?: unknown) { return new Request("https://app.example.test/api/live-presenter?liveId=live-1", body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ vendor: { id: "vendor-1" }, member: { status: "active", role: "owner" } });
  m.origin.mockReturnValue("https://media.example.test"); m.sameOrigin.mockReturnValue(null); m.limit.mockResolvedValue(null);
  m.live.mockResolvedValue(live); m.video.mockResolvedValue({ id: "new-browser-video" }); m.update.mockResolvedValue({ id: "live-1" });
  m.transaction.mockImplementation(async callback => callback({ video: { create: m.video }, live: { update: m.update } }));
});

describe("presenter layout persistence", () => {
  it("rejects stale instructor direction and preserves saved portrait settings", async () => {
    const layout = { ...DEFAULT_PRESENTER_LAYOUT, orientation: "portrait" };
    m.live.mockResolvedValue({ ...live, presenterLayout: layout });
    expect((await POST(request(payload))).status).toBe(409);
    expect(m.update).not.toHaveBeenCalled();
    expect((await POST(request({ ...payload, layout }))).status).toBe(200);
    expect(await (await GET(request())).json()).toMatchObject({ layout });
  });
  it.each(["owner", "admin"])("allows active %s to save tenant-scoped layout", async role => {
    m.auth.mockResolvedValue({ vendor: { id: "vendor-1" }, member: { status: "active", role } });
    expect((await POST(request(payload))).status).toBe(200);
    expect(m.live).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "live-1", vendorId: "vendor-1" } }));
    expect(m.update).toHaveBeenCalledWith({ where: { vendorId_id: { vendorId: "vendor-1", id: "live-1" }, status: "scheduled", presenterLayout: { equals: Prisma.DbNull } }, data: { presenterLayout: DEFAULT_PRESENTER_LAYOUT } });
    expect(m.video).not.toHaveBeenCalled();
  });
  it.each([null, { vendor: { id: "vendor-1" }, member: { status: "inactive", role: "owner" } }, { vendor: { id: "vendor-1" }, member: { status: "active", role: "viewer" } }])("denies layout reads and writes for non-managers", async auth => {
    m.auth.mockResolvedValue(auth); expect((await GET(request())).status).toBe(403); expect((await POST(request(payload))).status).toBe(403); expect(m.live).not.toHaveBeenCalled();
  });
  it("does not save an activity outside the current tenant", async () => {
    m.live.mockResolvedValue(null); expect((await POST(request(payload))).status).toBe(404); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("restores validated metadata and uses a safe default for corrupt metadata", async () => {
    const layout = { ...DEFAULT_PRESENTER_LAYOUT, cameraPercent: 35, corner: "top-left", mode: "picture-in-picture" };
    m.live.mockResolvedValueOnce({ ...live, presenterLayout: layout });
    const restored = await GET(request()); expect(await restored.json()).toMatchObject({ layout, viewerUrl: "/live/test-live", configured: true });
    m.live.mockResolvedValueOnce({ ...live, presenterLayout: { ...layout, cameraPercent: 200 } });
    expect(await (await GET(request())).json()).toMatchObject({ layout: DEFAULT_PRESENTER_LAYOUT });
  });
  it.each([{ ...payload, extra: true }, { ...payload, layout: { ...DEFAULT_PRESENTER_LAYOUT, cameraPercent: 14 } }, { ...payload, layout: { ...DEFAULT_PRESENTER_LAYOUT, cameraPercent: 36 } }, { ...payload, layout: { ...DEFAULT_PRESENTER_LAYOUT, version: 2 } }, { ...payload, padding: "x".repeat(5000) }])("rejects invalid, out-of-bounds and oversized payloads", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("creates a new browser source without mutating the prior video asset", async () => {
    expect((await POST(request({ ...payload, enableBroadcast: true }))).status).toBe(200);
    expect(m.video).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: "vendor-1", sourceType: "browser_live" }) });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { presenterLayout: DEFAULT_PRESENTER_LAYOUT, streamMode: "live", replayEnabled: false, isEvergreen: false, videoId: "new-browser-video" } }));
    // The mock exposes only create: any accidental update/delete on Video fails this test.
    expect(m.transaction).toHaveBeenCalledTimes(1);
  });
  it("reuses an existing browser source without allocating another video", async () => {
    m.live.mockResolvedValue({ ...live, video: { sourceType: "browser_live" } });
    expect((await POST(request({ ...payload, enableBroadcast: true }))).status).toBe(200); expect(m.video).not.toHaveBeenCalled();
  });
  it.each(["live", "ended"])("does not change the source once event is %s", async status => {
    m.live.mockResolvedValue({ ...live, status }); expect((await POST(request({ ...payload, enableBroadcast: true }))).status).toBe(409); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("does not enable broadcasting when media service is unconfigured", async () => {
    m.origin.mockReturnValue(null); expect((await POST(request({ ...payload, enableBroadcast: true }))).status).toBe(503); expect(m.video).not.toHaveBeenCalled();
  });
  it("reports transaction failure without returning internal database details", async () => {
    m.transaction.mockRejectedValue(new Error("private synthetic failure"));
    const result = await POST(request(payload)); expect(result.status).toBe(500); expect(await result.text()).not.toContain("private synthetic");
  });
  it("short-circuits origin and rate-limit failures before authentication", async () => {
    m.sameOrigin.mockReturnValueOnce(new Response(null, { status: 403 })); expect((await POST(request(payload))).status).toBe(403); expect(m.limit).not.toHaveBeenCalled();
    m.limit.mockResolvedValueOnce(new Response(null, { status: 429 })); expect((await GET(request())).status).toBe(429); expect(m.auth).not.toHaveBeenCalled();
  });
});
