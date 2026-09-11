import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyLocalTestDatabase } from "../../scripts/local-database-safety";
import { getDb } from "./db";
import { answerCard, commandCard, viewerCardSnapshot } from "./interaction-card";
import { GET, POST } from "@/app/api/live-interactions/cards/route";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "./live-quota-admission";

const boundary = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: boundary.auth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
const configuration = { version: 1 as const, kind: "interaction_card" as const, answerType: "text" as const, visibility: "instructor_only" as const, options: [] };
const now = new Date("2026-09-11T00:00:15Z");
async function fixture() {
  const db = getDb(); const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Timeline fixture", slug: id, email: `${id}@example.test`, passwordHash: "synthetic" } });
  const video = await db.video.create({ data: { vendorId: vendor.id, title: "Fixture", videoUrl: "https://example.test/fixture.webm", durationSec: 100 } });
  const live = await db.live.create({ data: { vendorId: vendor.id, videoId: video.id, title: "Timeline", slug: `live-${id}`, status: "live", scheduledAt: new Date("2026-09-11T00:00:00Z") } });
  const scope = { vendorId: vendor.id, liveId: live.id };
  const card = await commandCard(db, vendor.id, { action: "create", liveId: live.id, title: "既有卡片", configuration });
  const schedule = { enabled: true, startSeconds: 10, durationSeconds: 10 };
  const configure = () => commandCard(db, vendor.id, { action: "schedule", liveId: live.id, runId: card.id, schedule });
  return { db, scope, card, schedule, configure };
}
function request(scope: { vendorId: string; liveId: string }, body?: object, token?: string) {
  const query = token ? new URLSearchParams(scope).toString() : `mode=instructor${body ? "" : `&liveId=${scope.liveId}`}`;
  return new Request(`https://example.test/api/live-interactions/cards?${query}`, { method: body ? "POST" : "GET", headers: { origin: "https://example.test", "x-celebratedeal-client": "web", "content-type": "application/json", ...(token ? { cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
describe.skipIf(process.env.RT01_D2_DISPOSABLE_DB !== "true" || !classifyLocalTestDatabase(process.env.DATABASE_URL).safe)("timeline real database", () => {
  it("persists, edits and disables existing cards with duration validation", async () => {
    const f = await fixture(); await f.configure();
    expect((await viewerCardSnapshot(f.db, f.scope, "a", now)).timeline.cards[0]?.configuration.schedule).toEqual(f.schedule);
    await expect(commandCard(f.db, f.scope.vendorId, { action: "schedule", liveId: f.scope.liveId, runId: f.card.id, schedule: { ...f.schedule, startSeconds: 99 } })).rejects.toMatchObject({ status: 400 });
    await commandCard(f.db, f.scope.vendorId, { action: "schedule", liveId: f.scope.liveId, runId: f.card.id, schedule: { ...f.schedule, startSeconds: 30 } });
    expect((await viewerCardSnapshot(f.db, f.scope, "a", now)).timeline.cards[0]?.configuration.schedule?.startSeconds).toBe(30);
    await commandCard(f.db, f.scope.vendorId, { action: "schedule", liveId: f.scope.liveId, runId: f.card.id, schedule: { ...f.schedule, enabled: false } });
    expect((await viewerCardSnapshot(f.db, f.scope, "a", now)).timeline.cards).toEqual([]);
  });
  it("validates shared time on server and deduplicates simultaneous retries across reconnect", async () => {
    const f = await fixture(); await f.configure();
    await Promise.all(Array.from({ length: 4 }, () => answerCard(f.db, f.scope, "a", f.card.id, "A", 99, now)));
    expect(await f.db.liveInteractionResponse.count({ where: { runId: f.card.id } })).toBe(1);
    expect((await viewerCardSnapshot(f.db, f.scope, "a", now)).timeline.cards[0]?.ownValue).toBe("A");
    expect((await viewerCardSnapshot(f.db, f.scope, "b", now)).timeline.cards[0]?.ownValue).toBeNull();
    const expired = new Date("2026-09-11T00:00:20Z");
    await expect(answerCard(f.db, f.scope, "b", f.card.id, "B", 15, expired)).rejects.toMatchObject({ status: 409 });
    expect((await answerCard(f.db, f.scope, "a", f.card.id, "A", 15, expired)).ownValue).toBe("A");
  });
  it("uses personal replay media time without globally activating another viewer's card", async () => {
    const f = await fixture(); await f.configure(); const replay = new Date("2026-09-11T00:02:00Z");
    expect((await viewerCardSnapshot(f.db, f.scope, "a", replay)).timeline.clock.mode).toBe("personal");
    await expect(answerCard(f.db, f.scope, "a", f.card.id, "A", undefined, replay)).rejects.toMatchObject({ status: 409 });
    await answerCard(f.db, f.scope, "a", f.card.id, "A", 15, replay);
    await expect(answerCard(f.db, f.scope, "b", f.card.id, "B", 25, replay)).rejects.toMatchObject({ status: 409 });
    await answerCard(f.db, f.scope, "b", f.card.id, "B", 15, replay);
    await answerCard(f.db, f.scope, "a", f.card.id, "A", 15, replay);
    expect(await f.db.liveInteractionResponse.count({ where: { runId: f.card.id } })).toBe(2);
    expect((await f.db.liveInteractionRun.findUniqueOrThrow({ where: { id: f.card.id } })).status).toBe("draft");
  });
  it("gives manual questions priority and lets the instructor permanently end a scheduled question", async () => {
    const f = await fixture(); await f.configure();
    const manual = await commandCard(f.db, f.scope.vendorId, { action: "create", liveId: f.scope.liveId, title: "手動", configuration });
    await commandCard(f.db, f.scope.vendorId, { action: "start", liveId: f.scope.liveId, runId: manual.id });
    await expect(answerCard(f.db, f.scope, "a", f.card.id, "A", 15, now)).rejects.toMatchObject({ status: 409 });
    await commandCard(f.db, f.scope.vendorId, { action: "end", liveId: f.scope.liveId, runId: manual.id });
    await answerCard(f.db, f.scope, "a", f.card.id, "A", 15, now);
    await commandCard(f.db, f.scope.vendorId, { action: "end", liveId: f.scope.liveId, runId: f.card.id });
    await expect(answerCard(f.db, f.scope, "b", f.card.id, "B", 15, now)).rejects.toMatchObject({ status: 409 });
    expect((await viewerCardSnapshot(f.db, f.scope, "a", now)).timeline.cards).toEqual([]);
  });
  it("rejects live scheduling and ignores previously saved schedules after a mode switch", async () => {
    const f = await fixture(); await f.configure();
    await f.db.live.update({ where: { id: f.scope.liveId }, data: { streamMode: "live" } });
    await expect(f.configure()).rejects.toMatchObject({ status: 400 });
    expect((await viewerCardSnapshot(f.db, f.scope, "a", now)).timeline.cards).toEqual([]);
    await expect(answerCard(f.db, f.scope, "a", f.card.id, "A", 15, now)).rejects.toMatchObject({ status: 409 });
    await commandCard(f.db, f.scope.vendorId, { action: "start", liveId: f.scope.liveId, runId: f.card.id });
    await answerCard(f.db, f.scope, "a", f.card.id, "A");
    await f.db.live.update({ where: { id: f.scope.liveId }, data: { status: "ended" } });
    expect((await viewerCardSnapshot(f.db, f.scope, "b", now)).card).toBeNull();
    await expect(answerCard(f.db, f.scope, "b", f.card.id, "B")).rejects.toMatchObject({ status: 409 });
    await expect(commandCard(f.db, f.scope.vendorId, { action: "start", liveId: f.scope.liveId, runId: f.card.id })).rejects.toMatchObject({ status: 409 });
  });
  it("enforces instructor and admission scope for two viewers and cross-tenant requests", async () => {
    const f = await fixture(); const foreign = await fixture();
    const command = { action: "schedule", liveId: f.scope.liveId, runId: f.card.id, schedule: f.schedule };
    boundary.auth.mockResolvedValue(null); expect((await POST(request(f.scope, command))).status).toBe(403);
    boundary.auth.mockResolvedValue({ vendor: { id: f.scope.vendorId }, member: { status: "active", role: "accountant" } }); expect((await POST(request(f.scope, command))).status).toBe(403);
    boundary.auth.mockResolvedValue({ vendor: { id: f.scope.vendorId }, member: { status: "active", role: "owner" } }); expect((await POST(request(f.scope, command))).status).toBe(200);
    expect((await POST(request(f.scope, { ...command, liveId: foreign.scope.liveId, runId: foreign.card.id }))).status).toBe(404);
    expect((await POST(request(f.scope, { ...command, runId: foreign.card.id }))).status).toBe(404);
    const token = randomBytes(32).toString("base64url");
    await f.db.liveViewerSession.create({ data: { ...f.scope, tokenHash: hashLiveViewerToken(token), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } });
    expect((await GET(request(foreign.scope, undefined, token))).status).toBe(401);
    expect((await GET(request(f.scope, undefined, token))).status).toBe(200);
  });
});
