import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// O-11 review M-1: routes that authorize with getCurrentAuth directly answer
// 403 BETA_AGREEMENT_REQUIRED for writes until the session vendor accepts the
// 封測合作協議, then behave as before. Real PostgreSQL, real session lookup;
// only cookies, CSRF and the rate limiter are synthetic.
const cookieJar = vi.hoisted(() => ({ token: "" }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name.endsWith("celebrate_session") && cookieJar.token ? { value: cookieJar.token } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error(`redirect:${url}`); }, notFound: (): never => { throw new Error("not_found"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/csrf", () => ({
  CSRF_FIELD_NAME: "csrfToken",
  assertServerActionSecurity: vi.fn(async () => undefined),
  verifyCsrfToken: vi.fn(async () => true),
  getCsrfToken: vi.fn(async () => "synthetic-csrf"),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST as productUpsert } from "@/app/api/products/upsert/route";
import { POST as scriptedDanmaku } from "@/app/api/live-danmaku/scripted/route";
import { POST as danmaku } from "@/app/api/live-danmaku/route";
import { POST as cards } from "@/app/api/live-interactions/cards/route";
import { POST as instructorChat } from "@/app/api/live-chat/instructor/route";
import { POST as presenter } from "@/app/api/live-presenter/route";
import { POST as liveMedia } from "@/app/api/live-media/route";
import { POST as remunerationExport } from "@/app/api/affiliates/[affiliateId]/remuneration/[snapshotId]/export/route";
import { recordBetaAgreementAcceptance } from "@/lib/beta-agreement";
import { getDb } from "@/lib/db";

const db = getDb();
const origin = "http://127.0.0.1:3000";
const BETA_GRANTS = ["danmaku", "browser_live"];
const MODULES = ["live_webinar", "affiliate_program", "tax_remuneration"];
const vendorIds: string[] = [];
const userIds: string[] = [];

beforeAll(() => {
  vi.stubEnv("CELEBRATEDEAL_MEDIA_ORIGIN", "http://127.0.0.1:9");
});
afterEach(async () => {
  cookieJar.token = "";
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});
afterAll(() => { vi.unstubAllEnvs(); });

async function ownerSession() {
  const key = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Beta API ${key}`, slug: `beta-api-${key}`, email: `beta-api-${key}@example.test`, passwordHash: "synthetic-only", betaFeatureGrants: BETA_GRANTS, enabledFeatureModules: MODULES },
  });
  vendorIds.push(vendor.id);
  const owner = await db.user.create({ data: { name: "Owner", email: `beta-api-owner-${key}@example.test`, passwordHash: "synthetic-only" } });
  userIds.push(owner.id);
  await db.vendorMember.create({ data: { vendorId: vendor.id, userId: owner.id, role: "owner", status: "active" } });
  const token = randomBytes(32).toString("base64url");
  await db.userSession.create({ data: { userId: owner.id, vendorId: vendor.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  cookieJar.token = token;
  return { vendor, owner };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { origin, "x-celebratedeal-client": "web", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function formRequest(path: string, fields: Record<string, string>) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { origin, "x-celebratedeal-client": "web", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function agreementCode(response: Response) {
  if (response.status !== 403) return null;
  const body = await response.clone().json().catch(() => null) as { error?: { code?: string } } | null;
  return body?.error?.code ?? null;
}

const writes: Array<[string, () => Promise<Response>]> = [
  ["products/upsert", () => productUpsert(formRequest("/api/products/upsert", { csrfToken: "synthetic-csrf", name: "" }))],
  ["live-danmaku/scripted", () => scriptedDanmaku(jsonRequest("/api/live-danmaku/scripted", {}))],
  ["live-danmaku (instructor)", () => danmaku(jsonRequest("/api/live-danmaku?mode=instructor", { liveId: "missing-live", enabled: true }))],
  ["live-interactions/cards (instructor)", () => cards(jsonRequest("/api/live-interactions/cards?mode=instructor", {}))],
  ["live-chat/instructor", () => instructorChat(jsonRequest("/api/live-chat/instructor", {}))],
  ["live-presenter", () => presenter(jsonRequest("/api/live-presenter", {}))],
  ["live-media offer", () => liveMedia(jsonRequest("/api/live-media", { action: "offer", liveId: "missing-live", direction: "publish", sdp: "v=0 synthetic" }))],
  ["affiliate remuneration export", () => remunerationExport(formRequest("/api/affiliates/aff_1/remuneration/snap_1/export", { csrfToken: "synthetic-csrf" }), { params: Promise.resolve({ affiliateId: "aff_1", snapshotId: "snap_1" }) })],
];

describe("封測合作協議 gate on getCurrentAuth API routes (O-11 M-1)", () => {
  it.each(writes)("%s answers 403 BETA_AGREEMENT_REQUIRED until the owner accepts, then proceeds", async (_name, send) => {
    const { vendor, owner } = await ownerSession();

    const held = await send();
    expect(held.status).toBe(403);
    expect(held.headers.get("cache-control")).toContain("no-store");
    await expect(agreementCode(held)).resolves.toBe("BETA_AGREEMENT_REQUIRED");

    await recordBetaAgreementAcceptance(db, { userId: owner.id, vendorId: vendor.id, vendorName: vendor.name });
    const after = await send();
    // Past the agreement check; what follows (validation, missing live, MFA step-up) is the route's own answer.
    await expect(agreementCode(after)).resolves.not.toBe("BETA_AGREEMENT_REQUIRED");
  });

  it("keeps heartbeat and stop for a running broadcast open before acceptance", async () => {
    await ownerSession();
    for (const action of ["heartbeat", "stop"] as const) {
      const response = await liveMedia(jsonRequest("/api/live-media", { action, liveId: "missing-live", direction: "publish", sessionId: "missing-session" }));
      await expect(agreementCode(response), action).resolves.toBeNull();
    }
  });

  it("keeps instructor reads open before acceptance", async () => {
    await ownerSession();
    const get = (path: string) => new Request(`${origin}${path}`, { headers: { origin, "x-celebratedeal-client": "web" } });
    const { GET: danmakuGet } = await import("@/app/api/live-danmaku/route");
    const { GET: chatGet } = await import("@/app/api/live-chat/instructor/route");
    await expect(agreementCode(await danmakuGet(get("/api/live-danmaku?mode=instructor&liveId=missing-live")))).resolves.toBeNull();
    await expect(agreementCode(await chatGet(get("/api/live-chat/instructor?liveId=missing-live")))).resolves.toBeNull();
  });
});
