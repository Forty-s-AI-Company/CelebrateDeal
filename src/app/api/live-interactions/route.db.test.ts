import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import * as dbModule from "@/lib/db";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
import { POST } from "./route";

const vendors: string[] = [];
beforeEach(() => vi.stubEnv("CSRF_SECRET", "disposable-interaction-database-secret-over-thirty-two-bytes"));
afterEach(async () => {
  vi.restoreAllMocks();
  await getDb().vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture() {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Interaction fixture", slug: suffix, email: `${suffix}@example.test`, passwordHash: "disposable-only" } });
  vendors.push(vendor.id);
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Fixture", slug: suffix, headline: "Fixture", fields: [] } });
  const live = await db.live.create({ data: { vendorId: vendor.id, formId: form.id, title: "Fixture", slug: suffix, scheduledAt: new Date(), status: "live" } });
  const run = await db.liveInteractionRun.create({ data: { vendorId: vendor.id, liveId: live.id, source: "manual", eventType: "flash_voucher", title: "One voucher", startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60000), configuration: { kind: "flash_voucher", durationSec: 60, maxClaims: 1, discountType: "fixed", discountValue: 100, productId: null } } });
  const tokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  await db.liveViewerSession.createMany({ data: tokens.map((token) => ({ vendorId: vendor.id, liveId: live.id, tokenHash: hashLiveViewerToken(token), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 60000) })) });
  const respond = (token: string) => POST(new Request("https://app.example.test/api/live-interactions", { method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${token}` }, body: JSON.stringify({ action: "respond", vendorId: vendor.id, liveId: live.id, runId: run.id, value: "claim" }) }));
  return { db, run, tokens, respond };
}

describe("advanced interactions isolated PostgreSQL", () => {
  it.each([
    { isActive: false },
    { fulfillmentTypeConfirmed: false },
    { checkoutUrl: "https://external.example.test/checkout" },
  ])("rejects bound products that are unavailable for native checkout: %j", async (overrides) => {
    const { db, run, tokens, respond } = await fixture();
    const product = await db.product.create({ data: { vendorId: run.vendorId, name: "Unavailable product", slug: randomUUID(), priceCents: 1000, ...overrides } });
    await db.liveProduct.create({ data: { vendorId: run.vendorId, liveId: run.liveId, productId: product.id } });
    await db.liveInteractionRun.update({ where: { id: run.id }, data: { configuration: { kind: "flash_voucher", durationSec: 60, maxClaims: 5, discountType: "fixed", discountValue: 100, productId: product.id } } });
    const response = await respond(tokens[0]!);
    expect(response.status).toBe(409);
    expect(response.cookies.has("celebratedeal_flash_voucher")).toBe(false);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
  });

  it("rejects an unbound voucher before creating a scheduled run, then permits binding", async () => {
    const { db, run, tokens } = await fixture();
    const product = await db.product.create({ data: { vendorId: run.vendorId, name: "Scoped product", slug: randomUUID(), priceCents: 1000, commerceDomain: "course" } });
    const script = await db.interactionScript.create({ data: { vendorId: run.vendorId, name: "Scoped script", status: "published" } });
    const event = await db.interactionEvent.create({ data: { scriptId: script.id, eventType: "flash_voucher", title: "Scoped voucher", productId: product.id, metadata: { kind: "flash_voucher", durationSec: 120, maxClaims: 2, discountType: "fixed", discountValue: 100, productId: product.id } } });
    await db.live.update({ where: { id: run.liveId }, data: { interactionScriptId: script.id, streamMode: "live", startedAt: new Date(Date.now() - 1000) } });
    const open = () => POST(new Request("https://app.example.test/api/live-interactions", { method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${tokens[0]}` }, body: JSON.stringify({ action: "open", vendorId: run.vendorId, liveId: run.liveId, eventId: event.id }) }));
    expect((await open()).status).toBe(409);
    expect(await db.liveInteractionRun.count({ where: { sourceEventId: event.id } })).toBe(0);
    await db.liveProduct.create({ data: { vendorId: run.vendorId, liveId: run.liveId, productId: product.id } });
    expect((await open()).status).toBe(200);
    expect(await db.liveInteractionRun.count({ where: { sourceEventId: event.id } })).toBe(1);
  });

  it("rechecks voucher product binding when claiming, including removed bindings", async () => {
    const { db, run, tokens, respond } = await fixture();
    const product = await db.product.create({ data: { vendorId: run.vendorId, name: "Scoped product", slug: randomUUID(), priceCents: 1000 } });
    await db.liveInteractionRun.update({ where: { id: run.id }, data: { configuration: { kind: "flash_voucher", durationSec: 60, maxClaims: 5, discountType: "fixed", discountValue: 100, productId: product.id } } });
    const rejected = await respond(tokens[0]!);
    expect(rejected.status).toBe(409);
    expect(rejected.cookies.has("celebratedeal_flash_voucher")).toBe(false);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
    const binding = await db.liveProduct.create({ data: { vendorId: run.vendorId, liveId: run.liveId, productId: product.id } });
    expect((await respond(tokens[0]!)).status).toBe(200);
    await db.liveProduct.delete({ where: { id: binding.id } });
    const removed = await respond(tokens[1]!);
    expect(removed.status).toBe(409);
    expect(removed.cookies.has("celebratedeal_flash_voucher")).toBe(false);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(1);
  });

  it("rejects a viewer session from another tenant before accepting a claim", async () => {
    const first = await fixture();
    const second = await fixture();
    expect((await first.respond(second.tokens[0]!)).status).toBe(401);
    expect(await first.db.liveInteractionResponse.count({ where: { runId: first.run.id } })).toBe(0);
  });

  it("rejects an expired viewer session before accepting a claim", async () => {
    const { db, run, tokens, respond } = await fixture();
    await db.liveViewerSession.update({ where: { tokenHash: hashLiveViewerToken(tokens[0]!) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await respond(tokens[0]!)).status).toBe(401);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
  });

  it("does not issue a second voucher when the same admitted viewer replays a claim", async () => {
    const { db, run, tokens, respond } = await fixture();
    expect((await respond(tokens[0]!)).status).toBe(200);
    const replay = await respond(tokens[0]!);
    expect(replay.status).toBe(409);
    expect(replay.cookies.has("celebratedeal_flash_voucher")).toBe(false);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(1);
  });

  it("rejects a run closed after the initial read but before the response transaction", async () => {
    const { db, run, tokens, respond } = await fixture();
    let closed = false;
    const interleaved = db.$extends({ query: { liveInteractionRun: { async findFirst({ args, query }) {
      const result = await query(args);
      if (!closed && result?.id === run.id) {
        closed = true;
        // Commit a real concurrent close before returning the stale initial read.
        await db.liveInteractionRun.update({ where: { id: run.id }, data: { status: "closed" } });
      }
      return result;
    } } } });
    vi.spyOn(dbModule, "getDb").mockReturnValue(interleaved as unknown as ReturnType<typeof getDb>);
    const response = await respond(tokens[0]!);
    expect(closed).toBe(true);
    expect(response.status).toBe(409);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
    expect(response.cookies.has("celebratedeal_flash_voucher")).toBe(false);
  });

  it("allows only one claim when two admitted viewers race for the final voucher", async () => {
    const { db, run, tokens, respond } = await fixture();
    const replies = await Promise.all(tokens.map(respond));
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(1);
    expect(replies.filter((reply) => reply.cookies.has("celebratedeal_flash_voucher"))).toHaveLength(1);
  });

  it("rejects closed and not-yet-started runs without persisting claims", async () => {
    const { db, run, tokens, respond } = await fixture();
    await db.liveInteractionRun.update({ where: { id: run.id }, data: { status: "closed" } });
    expect((await respond(tokens[0]!)).status).toBe(409);
    await db.liveInteractionRun.update({ where: { id: run.id }, data: { status: "active", startsAt: new Date(Date.now() + 30000) } });
    expect((await respond(tokens[0]!)).status).toBe(409);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
  });
});
