import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyLocalTestDatabase } from "../../scripts/local-database-safety";
import { getDb } from "./db";
import { answerCard, commandCard, instructorCards, viewerCard } from "./interaction-card";
import { GET, POST } from "@/app/api/live-interactions/cards/route";
import { GET as legacyGet, POST as legacyPost } from "@/app/api/live-interactions/route";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "./live-quota-admission";

const boundary = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: boundary.auth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
const config = { version: 1 as const, kind: "interaction_card" as const, answerType: "text" as const, visibility: "instructor_only" as const, options: [] };
async function fixture() {
  const db = getDb(); const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Card fixture", slug: `card-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic" } });
  const live = await db.live.create({ data: { vendorId: vendor.id, title: "Card live", slug: `card-live-${suffix}`, scheduledAt: new Date() } });
  const scope = { vendorId: vendor.id, liveId: live.id };
  const tokens = await Promise.all([0, 1].map(async () => {
    const token = randomBytes(32).toString("base64url");
    await db.liveViewerSession.create({ data: { ...scope, tokenHash: hashLiveViewerToken(token), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 90_000) } }); return token;
  }));
  const draft = await commandCard(db, vendor.id, { action: "create", liveId: live.id, title: "你的想法", configuration: config });
  return { db, scope, draft, tokens, start: () => commandCard(db, vendor.id, { action: "start", liveId: live.id, runId: draft.id }) };
}
function request(scope: {vendorId:string;liveId:string}, token: string, body?: object, instructor = false) {
  const query = instructor ? `mode=instructor${body ? "" : `&liveId=${scope.liveId}`}` : body ? "" : new URLSearchParams(scope).toString();
  return new Request(`https://example.test/api/live-interactions/cards${query ? `?${query}` : ""}`, { method: body ? "POST" : "GET", headers: { origin: "https://example.test", "x-celebratedeal-client": "web", "content-type": "application/json", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
describe.skipIf(process.env.RT01_D2_DISPOSABLE_DB !== "true" || !classifyLocalTestDatabase(process.env.DATABASE_URL).safe)("interaction card real database", () => {
  it("converges concurrent retries and rejects changed or closed answers", async () => {
    const f = await fixture(); await f.start();
    const a = hashLiveViewerToken(f.tokens[0]!);
    await Promise.all(Array.from({ length: 4 }, () => answerCard(f.db, f.scope, a, f.draft.id, "private A")));
    expect(await f.db.liveInteractionResponse.count({ where: { runId: f.draft.id } })).toBe(1);
    await expect(answerCard(f.db, f.scope, a, f.draft.id, "changed")).rejects.toMatchObject({ status: 409 });
    await commandCard(f.db, f.scope.vendorId, { action: "end", liveId: f.scope.liveId, runId: f.draft.id });
    expect((await answerCard(f.db, f.scope, a, f.draft.id, "private A")).ownValue).toBe("private A");
    await expect(answerCard(f.db, f.scope, hashLiveViewerToken(f.tokens[1]!), f.draft.id, "late")).rejects.toMatchObject({ status: 409 });
  });
  it("switches exactly one active question and rejects stale submissions", async () => {
    const f = await fixture(); await f.start();
    const second = await commandCard(f.db, f.scope.vendorId, { action: "create", liveId: f.scope.liveId, title: "第二題", configuration: { ...config, answerType: "quick", options: ["111", "222"] } });
    await commandCard(f.db, f.scope.vendorId, { action: "start", liveId: f.scope.liveId, runId: second.id });
    await expect(answerCard(f.db, f.scope, "viewer", f.draft.id, "late")).rejects.toMatchObject({ status: 409 });
    await expect(answerCard(f.db, f.scope, "viewer", second.id, "invalid")).rejects.toMatchObject({ status: 400 });
    expect((await viewerCard(f.db, f.scope, "viewer"))?.id).toBe(second.id);
    expect(await f.db.liveInteractionRun.count({ where: { ...f.scope, eventType: "interaction_card", status: "active" } })).toBe(1);
    await expect(commandCard(f.db, f.scope.vendorId, { action: "start", liveId: f.scope.liveId, runId: f.draft.id })).rejects.toMatchObject({ status: 409 });
  });
  it("isolates two viewers, persists refreshes and blocks the legacy endpoint", async () => {
    const f = await fixture(); await f.start();
    const post = await POST(request(f.scope, f.tokens[0]!, { ...f.scope, runId: f.draft.id, value: "secret A" })); expect(post.status).toBe(200);
    const refreshed = await GET(request(f.scope, f.tokens[0]!)); expect((await refreshed.json()).card.ownValue).toBe("secret A");
    const second = await GET(request(f.scope, f.tokens[1]!)); const data = await second.json(); expect(data.card.ownValue).toBeNull(); expect(JSON.stringify(data)).not.toContain("secret A");
    expect(second.headers.get("cache-control")).toBe("private, no-store");
    const legacy = await legacyGet(request(f.scope, f.tokens[1]!)); expect((await legacy.json()).runs).toEqual([]);
    expect((await legacyPost(request(f.scope, f.tokens[1]!, { ...f.scope, action: "respond", runId: f.draft.id, value: "bypass" }))).status).toBe(409);
    expect(await f.db.interactionEvent.count({ where: { id: f.draft.id } })).toBe(0);
    expect((await instructorCards(f.db, f.scope, f.draft.id))[0]?.answers[0]?.value).toBe("secret A");
  });
  it("enforces manager role and tenant/activity identity on real API handlers", async () => {
    const f = await fixture(); const foreign = await fixture(); await f.start();
    boundary.auth.mockResolvedValue(null); expect((await GET(request(f.scope, "", undefined, true))).status).toBe(403);
    boundary.auth.mockResolvedValue({ vendor: { id: f.scope.vendorId }, member: { status: "active", role: "accountant" } }); expect((await GET(request(f.scope, "", undefined, true))).status).toBe(403);
    boundary.auth.mockResolvedValue({ vendor: { id: f.scope.vendorId }, member: { status: "active", role: "owner" } }); expect((await GET(request(f.scope, "", undefined, true))).status).toBe(200);
    expect((await GET(request(foreign.scope, "", undefined, true))).status).toBe(404);
    expect((await GET(request(foreign.scope, f.tokens[0]!))).status).toBe(401);
    const otherLive = await f.db.live.create({ data: { vendorId: f.scope.vendorId, title: "Other", slug: randomUUID(), scheduledAt: new Date() } });
    await expect(answerCard(f.db, { ...f.scope, liveId: otherLive.id }, "a", f.draft.id, "cross-live")).rejects.toMatchObject({ status: 404 });
    expect((await POST(request(f.scope, "", { action: "start", liveId: foreign.scope.liveId, runId: foreign.draft.id }, true))).status).toBe(404);
    expect((await POST(request(f.scope, f.tokens[0]!, { ...f.scope, runId: f.draft.id, value: "x", participantHash: "other" }))).status).toBe(400);
  });
  it("counts all choices while keeping public-display replies out of viewer DTOs", async () => {
    const f = await fixture();
    const card = await commandCard(f.db, f.scope.vendorId, { action: "create", liveId: f.scope.liveId, title: "選擇", configuration: { ...config, answerType: "single", visibility: "public_display", options: ["A", "B"] } });
    await commandCard(f.db, f.scope.vendorId, { action: "start", liveId: f.scope.liveId, runId: card.id });
    await answerCard(f.db, f.scope, "A", card.id, "A"); await answerCard(f.db, f.scope, "B", card.id, "B");
    const rows = await instructorCards(f.db, f.scope); const stats = rows.find(r => r.id === card.id)!;
    expect(stats.responseCount).toBe(2); expect(stats.options).toEqual([{ value: "A", count: 1 }, { value: "B", count: 1 }]);
    expect(await viewerCard(f.db, f.scope, "C")).not.toHaveProperty("answers");
  });
});
