import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyLocalTestDatabase } from "../../scripts/local-database-safety";
import { getDb } from "./db";
import { commandWarmup } from "./scripted-roles";
import { readDanmaku, setDanmaku } from "./live-danmaku";
import { GET as feed } from "@/app/api/live-danmaku/route";
import { GET, POST } from "@/app/api/live-danmaku/scripted/route";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "./live-quota-admission";
const boundary = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: boundary.auth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
async function fixture() {
  const db = getDb(); const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic warmup", slug: id, email: `${id}@example.test`, passwordHash: "synthetic" } });
  const live = await db.live.create({ data: { vendorId: vendor.id, title: "Warmup", slug: randomUUID(), scheduledAt: new Date(), streamMode: "live", status: "live" } });
  const scope = { vendorId: vendor.id, liveId: live.id };
  const role = await db.interactionRole.create({ data: { vendorId: vendor.id, name: "暖場角色", isActive: true, isScheduled: true } });
  const script = await db.interactionScript.create({ data: { vendorId: vendor.id, name: "暖場腳本", status: "published" } });
  const events = await Promise.all([10, 20].map(triggerSec => db.interactionEvent.create({ data: { scriptId: script.id, roleId: role.id, eventType: "chat_message", title: "暖場", message: `暖場 ${triggerSec}`, triggerSec } })));
  const tokens = await Promise.all([0, 1].map(async () => { const token = randomBytes(32).toString("base64url"); await db.liveViewerSession.create({ data: { ...scope, tokenHash: hashLiveViewerToken(token), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 120000) } }); return token; }));
  await setDanmaku(db, scope, true);
  const select = (scheduled = false) => commandWarmup(db, vendor.id, { action: "select", liveId: live.id, scriptId: script.id, scheduled });
  const send = (eventId = events[0].id, requestId = randomUUID()) => commandWarmup(db, vendor.id, { action: "send", liveId: live.id, eventId, requestId });
  return { db, scope, role, script, events, tokens, select, send };
}
function req(query = "", body?: object, token = "", endpoint = "live-danmaku/scripted") {
  return new Request(`http://localhost:31023/api/${endpoint}${query ? `?${query}` : ""}`, { method: body ? "POST" : "GET", headers: { origin: "http://localhost:31023", "x-celebratedeal-client": "web", "content-type": "application/json", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const enabled = process.env.RT01_D2_DISPOSABLE_DB === "true" && classifyLocalTestDatabase(process.env.DATABASE_URL).safe;
describe.skipIf(!enabled)("scripted roles real API and PostgreSQL", () => {
  it("manual send converges retries, rate limits and reaches two admitted viewers without statistics pollution", async () => {
    const f = await fixture(); await f.select(); const before = await readDanmaku(f.db, f.scope); const requestId = randomUUID();
    await Promise.all([f.send(f.events[0].id, requestId), f.send(f.events[0].id, requestId)]);
    await expect(f.send(f.events[1].id, requestId)).rejects.toMatchObject({ status: 409 });
    await expect(f.send()).rejects.toMatchObject({ status: 429 });
    for (const token of f.tokens) {
      const response = await feed(req(new URLSearchParams({ ...f.scope, cursor: before.cursor, epoch: before.state.epoch }).toString(), undefined, token, "live-danmaku"));
      expect(response.status).toBe(200); const value = await response.json();
      expect(value.items).toHaveLength(1); expect(value.items[0]).toMatchObject({ source: "scripted_role", value: "暖場 10", displayName: "暖場角色" });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(await f.db.liveInteractionResponse.count({ where: f.scope })).toBe(0);
    expect(await f.db.liveInteractionRun.count({ where: f.scope })).toBe(0);
    expect(await f.db.liveChatMessage.count({ where: f.scope })).toBe(0);
  });
  it("authorizes owner and admin, rejects viewer/accountant and foreign live/script/event", async () => {
    const f = await fixture(); const other = await fixture();
    for (const role of [null, "viewer", "accountant", "owner", "admin"]) {
      boundary.auth.mockResolvedValue(role ? { vendor: { id: f.scope.vendorId }, member: { status: "active", role } } : null);
      const allowed = role === "owner" || role === "admin";
      expect((await GET(req(`liveId=${f.scope.liveId}`))).status).toBe(allowed ? 200 : 403);
      expect((await POST(req("", { action: "select", liveId: f.scope.liveId, scriptId: f.script.id, scheduled: false }))).status).toBe(allowed ? 200 : 403);
    }
    expect((await POST(req("", { action: "stop", liveId: other.scope.liveId }))).status).toBe(404);
    expect((await POST(req("", { action: "select", liveId: f.scope.liveId, scriptId: other.script.id, scheduled: false }))).status).toBe(404);
    await expect(f.send(other.events[0].id)).rejects.toMatchObject({ status: 404 });
    const alternate = await f.db.interactionScript.create({ data: { vendorId: f.scope.vendorId, name: "未選腳本" } });
    const alternateEvent = await f.db.interactionEvent.create({ data: { scriptId: alternate.id, roleId: f.role.id, eventType: "chat_message", title: "未選事件", message: "不可發送" } });
    await expect(f.send(alternateEvent.id)).rejects.toMatchObject({ status: 404 });
    await expect(commandWarmup(f.db, f.scope.vendorId, { action: "select", liveId: f.scope.liveId, scriptId: alternate.id, scheduled: false })).rejects.toMatchObject({ status: 404 });
    expect((await feed(req(new URLSearchParams(f.scope).toString(), undefined, "", "live-danmaku"))).status).toBe(401);
    expect((await feed(req(new URLSearchParams(other.scope).toString(), undefined, f.tokens[0], "live-danmaku"))).status).toBe(401);
  });
  it("stops immediately, respects global switch and invalidates a disabled role", async () => {
    const f = await fixture(); await f.select(); const before = await readDanmaku(f.db, f.scope); await f.send();
    expect((await readDanmaku(f.db, f.scope, before.cursor, before.state.epoch)).items).toHaveLength(1);
    await setDanmaku(f.db, f.scope, false);
    expect((await readDanmaku(f.db, f.scope, before.cursor, before.state.epoch)).items).toEqual([]);
    await expect(f.send()).rejects.toMatchObject({ status: 409 });
    await setDanmaku(f.db, f.scope, true); const reopened = await readDanmaku(f.db, f.scope);
    expect((await readDanmaku(f.db, f.scope, reopened.cursor, reopened.state.epoch)).items).toEqual([]);
    await commandWarmup(f.db, f.scope.vendorId, { action: "stop", liveId: f.scope.liveId });
    expect((await readDanmaku(f.db, f.scope, reopened.cursor, reopened.state.epoch)).items).toEqual([]);
    await expect(f.send()).rejects.toMatchObject({ status: 409 });
    await f.select(); const selected = await readDanmaku(f.db, f.scope);
    await f.db.interactionRole.update({ where: { id: f.role.id }, data: { isActive: false } });
    const disabled = await readDanmaku(f.db, f.scope, selected.cursor, selected.state.epoch);
    expect(disabled.state.epoch).not.toBe(selected.state.epoch); expect(disabled.items).toEqual([]);
    await expect(f.select()).rejects.toMatchObject({ status: 409 });
  });
  it("synchronized schedule ignores client position and personal replay follows seek without catch-up", async () => {
    const f = await fixture(); const video = await f.db.video.create({ data: { vendorId: f.scope.vendorId, title: "Synthetic", videoUrl: "https://example.test/synthetic.mp4", durationSec: 120 } });
    await f.db.live.update({ where: { id: f.scope.liveId }, data: { videoId: video.id, streamMode: "vod", scheduledAt: new Date(Date.now() - 11000) } });
    await f.select(true);
    // 以 DB 時鐘建立窗口，避免 migration/CI 負載或主機時間差影響測試。
    await f.db.$executeRaw`UPDATE "Live" SET "scheduledAt"=clock_timestamp() - interval '10 seconds' WHERE "id"=${f.scope.liveId}`;
    const before = await readDanmaku(f.db, f.scope);
    expect((await readDanmaku(f.db, f.scope, before.cursor, before.state.epoch, 21)).items[0]?.value).toBe("暖場 10");
    await f.db.live.update({ where: { id: f.scope.liveId }, data: { scheduledAt: new Date(Date.now() - 180000), status: "ended", endedAt: new Date(Date.now() - 60000), replayEnabled: true } });
    for (const [position, value] of [[21, "暖場 20"], [50, null], [11, "暖場 10"]] as const) {
      const response = await feed(req(new URLSearchParams({ ...f.scope, cursor: before.cursor, epoch: before.state.epoch, positionSeconds: String(position) }).toString(), undefined, f.tokens[0], "live-danmaku"));
      expect(response.status).toBe(200); const result = await response.json();
      if (value) expect(result.items[0]?.value).toBe(value); else expect(result.items).toEqual([]);
    }
  });
});
