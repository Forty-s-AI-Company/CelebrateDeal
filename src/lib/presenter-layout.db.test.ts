import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { classifyLocalTestDatabase } from "../../scripts/local-database-safety";
import { getDb } from "./db";
import { DEFAULT_PRESENTER_LAYOUT, PresenterLayoutSchema } from "./presenter-layout";
import { cleanupMediaSessions } from "./live-media-cleanup";

const boundary = vi.hoisted(() => ({ stop: vi.fn(), auth: vi.fn() }));
vi.mock("./live-media-provider", () => ({ stopMediaSession: boundary.stop, mediaOrigin: () => "https://media.example.test" }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: boundary.auth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => null }));
import { POST } from "@/app/api/live-presenter/route";

async function fixture() {
  const db = getDb(); const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic presenter", slug: `presenter-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic" } });
  const live = await db.live.create({ data: { vendorId: vendor.id, title: "Synthetic presenter", slug: `presenter-live-${suffix}`, scheduledAt: new Date(), status: "scheduled" } });
  const scope = { vendorId: vendor.id, liveId: live.id };
  const session = (principal = "instructor:synthetic") => ({ ...scope, principal, direction: "publish", resourcePath: "/synthetic/session", expiresAt: new Date(Date.now() - 1000) });
  return { db, vendor, live, scope, session };
}

// Disposable DB suites are deliberately opt-in, matching the repository's DB safety gate.
describe.skipIf(process.env.RT01_D2_DISPOSABLE_DB !== "true" || !classifyLocalTestDatabase(process.env.DATABASE_URL).safe)("presenter real PostgreSQL", () => {
  afterAll(async () => { await getDb().$disconnect(); });
  it("restores portrait orientation and saves its presenter settings through the real API", async () => {
    const f = await fixture();
    const layout = { ...DEFAULT_PRESENTER_LAYOUT, orientation: "portrait" as const };
    await f.db.live.update({ where: { id: f.live.id }, data: { presenterLayout: layout } });
    boundary.auth.mockResolvedValue({ vendor: { id: f.vendor.id }, member: { status: "active", role: "owner" } });
    const saved = { ...layout, cameraPercent: 35 };
    const response = await POST(new Request("https://example.test/api/live-presenter", { method: "POST", headers: { origin: "https://example.test", "x-celebratedeal-client": "web", "content-type": "application/json" }, body: JSON.stringify({ liveId: f.live.id, layout: saved }) }));
    expect(response.status).toBe(200);
    expect((await f.db.live.findUniqueOrThrow({ where: { id: f.live.id } })).presenterLayout).toEqual(saved);
  });
  it("rejects a stale layout save if activity orientation changed after reading", async () => {
    const f = await fixture();
    boundary.auth.mockResolvedValue({ vendor: { id: f.vendor.id }, member: { status: "active", role: "owner" } });
    const original = f.db.live.findFirst.bind(f.db.live);
    const layout = { ...DEFAULT_PRESENTER_LAYOUT, orientation: "portrait" as const };
    const spy = vi.spyOn(f.db.live, "findFirst").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const snapshot = await original(args);
      await f.db.live.update({ where: { id: f.live.id }, data: { presenterLayout: layout } });
      return snapshot;
    }) as typeof original);
    try {
      const response = await POST(new Request("https://example.test/api/live-presenter", { method: "POST", headers: { origin: "https://example.test", "x-celebratedeal-client": "web", "content-type": "application/json" }, body: JSON.stringify({ liveId: f.live.id, layout: DEFAULT_PRESENTER_LAYOUT }) }));
      expect(response.status).toBe(500);
    } finally { spy.mockRestore(); }
    expect((await f.db.live.findUniqueOrThrow({ where: { id: f.live.id } })).presenterLayout).toEqual(layout);
  });
  it("persists and restores layout JSON with tenant scoped reads", async () => {
    const f = await fixture(); const other = await fixture();
    const layout = { ...DEFAULT_PRESENTER_LAYOUT, mode: "picture-in-picture" as const, corner: "top-left" as const, cameraPercent: 35 };
    await f.db.live.update({ where: { vendorId_id: { vendorId: f.vendor.id, id: f.live.id } }, data: { presenterLayout: layout } });
    const restored = await f.db.live.findFirst({ where: { id: f.live.id, vendorId: f.vendor.id } });
    expect(PresenterLayoutSchema.parse(restored?.presenterLayout)).toEqual(layout);
    expect(await f.db.live.findFirst({ where: { id: f.live.id, vendorId: other.vendor.id } })).toBeNull();
    expect((await f.db.live.findUniqueOrThrow({ where: { id: other.live.id } })).presenterLayout).toBeNull();
  });
  it("rejects a media session whose tenant disagrees with its live composite foreign key", async () => {
    const f = await fixture(); const other = await fixture();
    await expect(f.db.liveMediaSession.create({ data: { ...f.session(), vendorId: other.vendor.id } })).rejects.toMatchObject({ code: "P2003" });
    expect(await f.db.liveMediaSession.count({ where: { liveId: f.live.id } })).toBe(0);
  });
  it("permits exactly one concurrent session per tenant live principal direction", async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => f.db.liveMediaSession.create({ data: f.session() })));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    for (const result of attempts) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "P2002" });
    expect(await f.db.liveMediaSession.count({ where: f.scope })).toBe(1);
    await f.db.liveMediaSession.create({ data: { ...f.session(), direction: "monitor" } });
    expect(await f.db.liveMediaSession.count({ where: f.scope })).toBe(2);
  });
  it("does not claim an expired scan result after its lease has been renewed", async () => {
    const f = await fixture(); const row = await f.db.liveMediaSession.create({ data: f.session() });
    boundary.stop.mockReset();
    const original = f.db.liveMediaSession.findMany.bind(f.db.liveMediaSession);
    // Only awaited query results are used here; the injected race does not use Prisma's fluent API.
    const spy = vi.spyOn(f.db.liveMediaSession, "findMany").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const scanned = await original(args);
      await f.db.liveMediaSession.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
      return scanned;
    }) as typeof original);
    try { expect(await cleanupMediaSessions(f.db, "https://media.example.test", f.scope)).toEqual({ scanned: 1, stopped: 0 }); }
    finally { spy.mockRestore(); }
    expect(boundary.stop).not.toHaveBeenCalled();
    expect((await f.db.liveMediaSession.findUniqueOrThrow({ where: { id: row.id } })).closing).toBe(false);
  });
  it("prevents heartbeat renewal after claim and retains failed closes for retry", async () => {
    const f = await fixture(); const row = await f.db.liveMediaSession.create({ data: f.session() });
    let closingAtDisconnect: boolean | undefined;
    let heartbeatCount: number | undefined;
    boundary.stop.mockReset().mockImplementationOnce(async () => {
      closingAtDisconnect = (await f.db.liveMediaSession.findUniqueOrThrow({ where: { id: row.id } })).closing;
      heartbeatCount = (await f.db.liveMediaSession.updateMany({ where: { id: row.id, closing: false }, data: { expiresAt: new Date(Date.now() + 60_000) } })).count;
      throw new Error("synthetic upstream retry");
    });
    expect(await cleanupMediaSessions(f.db, "https://media.example.test", f.scope)).toEqual({ scanned: 1, stopped: 0 });
    // Assert outside the provider callback: cleanup intentionally catches upstream failures.
    expect(closingAtDisconnect).toBe(true);
    expect(heartbeatCount).toBe(0);
    expect((await f.db.liveMediaSession.findUniqueOrThrow({ where: { id: row.id } })).closing).toBe(true);
    boundary.stop.mockResolvedValueOnce(undefined);
    expect(await cleanupMediaSessions(f.db, "https://media.example.test", f.scope)).toEqual({ scanned: 1, stopped: 1 });
    expect(await f.db.liveMediaSession.findUnique({ where: { id: row.id } })).toBeNull();
  });
  it("rolls back a new source when live status changes after API read, preserving the old video", async () => {
    const f = await fixture();
    const old = await f.db.video.create({ data: { vendorId: f.vendor.id, title: "Original VOD", videoUrl: "https://example.test/original.mp4", sourceType: "upload", status: "ready" } });
    await f.db.live.update({ where: { id: f.live.id }, data: { videoId: old.id } });
    boundary.auth.mockResolvedValue({ vendor: { id: f.vendor.id }, member: { status: "active", role: "owner" } });
    const original = f.db.live.findFirst.bind(f.db.live);
    const spy = vi.spyOn(f.db.live, "findFirst").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const snapshot = await original(args);
      await f.db.live.update({ where: { id: f.live.id }, data: { status: "live" } });
      return snapshot;
    }) as typeof original);
    try {
      const response = await POST(new Request("https://example.test/api/live-presenter", { method: "POST", headers: { origin: "https://example.test", "x-celebratedeal-client": "web", "content-type": "application/json" }, body: JSON.stringify({ liveId: f.live.id, layout: DEFAULT_PRESENTER_LAYOUT, enableBroadcast: true }) }));
      expect(response.status).toBe(500);
    } finally { spy.mockRestore(); }
    expect(await f.db.video.count({ where: { vendorId: f.vendor.id } })).toBe(1);
    expect(await f.db.video.findUniqueOrThrow({ where: { id: old.id } })).toEqual(old);
    expect((await f.db.live.findUniqueOrThrow({ where: { id: f.live.id } })).videoId).toBe(old.id);
  });
});
