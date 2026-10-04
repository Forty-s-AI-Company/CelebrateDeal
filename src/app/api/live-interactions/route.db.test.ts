import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
import { POST } from "./route";

const vendors: string[] = [];
beforeEach(() => vi.stubEnv("CSRF_SECRET", "disposable-interaction-database-secret-over-thirty-two-bytes"));
afterEach(async () => {
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
