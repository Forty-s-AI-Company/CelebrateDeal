import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyLocalTestDatabase } from "../../scripts/local-database-safety";
import { getDb } from "./db";
import { answerCard, commandCard } from "./interaction-card";
import { readDanmaku, setDanmaku } from "./live-danmaku";
import { GET, POST } from "@/app/api/live-danmaku/route";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "./live-quota-admission";

const boundary = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: boundary.auth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
const config = { version: 1 as const, kind: "interaction_card" as const, answerType: "text" as const, visibility: "public_display" as const, options: [] };
async function fixture() {
  const db = getDb(); const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Danmaku fixture", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic" } });
  const live = await db.live.create({ data: { vendorId: vendor.id, title: "Danmaku", slug: randomUUID(), scheduledAt: new Date(), streamMode: "live", status: "live" } });
  const scope = { vendorId: vendor.id, liveId: live.id };
  const tokens = await Promise.all([0, 1].map(async () => {
    const token = randomBytes(32).toString("base64url");
    await db.liveViewerSession.create({ data: { ...scope, tokenHash: hashLiveViewerToken(token), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 120_000) } }); return token;
  }));
  async function card(visibility: "public_display" | "instructor_only" = "public_display") {
    const draft = await commandCard(db, vendor.id, { action: "create", liveId: live.id, title: "互動", configuration: { ...config, visibility } });
    await commandCard(db, vendor.id, { action: "start", liveId: live.id, runId: draft.id }); return draft;
  }
  return { db, scope, tokens, card };
}
function request(scope: { vendorId: string; liveId: string }, token = "", query = "", body?: object) {
  return new Request(`http://localhost:31023/api/live-danmaku?${query || new URLSearchParams(scope)}`, { method: body ? "POST" : "GET", headers: { origin: "http://localhost:31023", "x-celebratedeal-client": "web", "content-type": "application/json", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const enabled = process.env.RT01_D2_DISPOSABLE_DB === "true" && classifyLocalTestDatabase(process.env.DATABASE_URL).safe;
describe.skipIf(!enabled)("danmaku real API and PostgreSQL", () => {
  it("public feed isolates two viewers, private cards, chat and identity fields", async () => {
    const f = await fixture(); await setDanmaku(f.db, f.scope, true);
    const first = await readDanmaku(f.db, f.scope);
    const form = await f.db.registrationForm.create({ data: { vendorId: f.scope.vendorId, name: "Private", slug: randomUUID(), headline: "Private", fields: [] } });
    const submission = await f.db.formSubmission.create({ data: { formId: form.id, liveId: f.scope.liveId, name: "PRIVATE NAME", email: "private@example.test" } });
    for (const source of ["private_viewer", "private_instructor", "viewer"]) await f.db.liveChatMessage.create({ data: { ...f.scope, source, formSubmissionId: submission.id, authorName: "PRIVATE NAME", body: `PRIVATE CHAT ${source}` } });
    const privateCard = await f.card("instructor_only"); await answerCard(f.db, f.scope, "private-person", privateCard.id, "PRIVATE ANSWER");
    const publicCard = await f.card(); await answerCard(f.db, f.scope, "private-hash", publicCard.id, "公開鼓勵");
    await f.db.liveInteractionResponse.updateMany({ where: { runId: publicCard.id }, data: { displayName: "private@example.test" } });
    const q = new URLSearchParams({ ...f.scope, cursor: first.cursor, epoch: first.state.epoch }).toString();
    for (const token of f.tokens) {
      const response = await GET(request(f.scope, token, q)); expect(response.status).toBe(200);
      const value = await response.json(); expect(value.items).toHaveLength(1); expect(value.items[0].displayName).toBe("觀眾");
      expect(JSON.stringify(value)).not.toMatch(/PRIVATE|private-person|private-hash|private@example|participantHash|formSubmissionId/);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    // Private chat is a separate table: this feed queries only explicitly public card responses.
    expect((await readDanmaku(f.db, f.scope)).items).toEqual([]);
  });
  it("requires admission and owner/admin scope, denies viewer writes and injected fields", async () => {
    const f = await fixture(); const other = await fixture();
    expect((await GET(request(f.scope))).status).toBe(401);
    expect((await GET(request(other.scope, f.tokens[0]))).status).toBe(401);
    expect((await POST(request(f.scope, f.tokens[0], "", { enabled: true }))).status).toBe(403);
    for (const role of [null, "accountant", "owner", "admin"]) {
      boundary.auth.mockResolvedValue(role ? { vendor: { id: f.scope.vendorId }, member: { status: "active", role } } : null);
      expect((await GET(request(f.scope, "", `mode=instructor&liveId=${f.scope.liveId}`))).status).toBe(role === "owner" || role === "admin" ? 200 : 403);
    }
    expect((await POST(request(f.scope, "", "mode=instructor", { liveId: other.scope.liveId, enabled: true }))).status).toBe(404);
    expect((await POST(request(f.scope, "", "mode=instructor", { liveId: f.scope.liveId, enabled: true, vendorId: other.scope.vendorId }))).status).toBe(400);
    const secondLive = await f.db.live.create({ data: { vendorId: f.scope.vendorId, title: "Other", slug: randomUUID(), scheduledAt: new Date() } });
    expect((await GET(request({ ...f.scope, liveId: secondLive.id }, f.tokens[0]))).status).toBe(401);
  });
  it("clears off/reopen history, synchronizes entrances and handles repeated commands", async () => {
    const f = await fixture(); const state = await setDanmaku(f.db, f.scope, true); const before = await readDanmaku(f.db, f.scope);
    const card = await f.card(); await answerCard(f.db, f.scope, "a", card.id, "OLD");
    expect((await readDanmaku(f.db, f.scope, before.cursor, state.epoch)).items).toHaveLength(1);
    await setDanmaku(f.db, f.scope, false); expect((await readDanmaku(f.db, f.scope, before.cursor, state.epoch)).items).toEqual([]);
    const next = await setDanmaku(f.db, f.scope, true); expect(next.epoch).not.toBe(state.epoch);
    expect(await setDanmaku(f.db, f.scope, true)).toEqual(next);
    expect((await readDanmaku(f.db, f.scope, before.cursor, state.epoch)).items).toEqual([]);
    expect((await readDanmaku(f.db, f.scope, before.cursor, next.epoch)).items).toEqual([]);
    boundary.auth.mockResolvedValue({ vendor: { id: f.scope.vendorId }, member: { status: "active", role: "owner" } });
    const response = await POST(request(f.scope, "", "mode=instructor", { liveId: f.scope.liveId, enabled: false }));
    const fromOtherEntrance = await GET(request(f.scope, "", `mode=instructor&liveId=${f.scope.liveId}`));
    expect((await response.json()).state).toEqual((await fromOtherEntrance.json()).state);
  });
  it("bounds bursts, converges retries and limits one participant across cards in live and vod", async () => {
    const f = await fixture(); await f.db.live.update({ where: { id: f.scope.liveId }, data: { streamMode: "vod" } });
    await setDanmaku(f.db, f.scope, true); const before = await readDanmaku(f.db, f.scope); const card = await f.card();
    await Promise.all(Array.from({ length: 30 }, (_, i) => answerCard(f.db, f.scope, `person-${i}`, card.id, `${i}`)));
    expect((await readDanmaku(f.db, f.scope, before.cursor, before.state.epoch)).items).toHaveLength(20);
    await Promise.all([0, 1].map(() => answerCard(f.db, f.scope, "same", card.id, "same")));
    expect(await f.db.liveInteractionResponse.count({ where: { runId: card.id, participantHash: "same" } })).toBe(1);
    for (let i = 0; i < 2; i++) { const next = await f.card(); await answerCard(f.db, f.scope, "same", next.id, "same"); }
    const last = await f.card(); await expect(answerCard(f.db, f.scope, "same", last.id, "same")).rejects.toMatchObject({ status: 429 });
  });
});
