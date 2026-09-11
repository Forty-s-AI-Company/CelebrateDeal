import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyLocalTestDatabase } from "../../scripts/local-database-safety";
import { getDb } from "./db";
import { liveStudioDraftFromFormData } from "./live-studio-draft-client";
import { DEFAULT_PRESENTER_LAYOUT } from "./presenter-layout";

const boundary = vi.hoisted(() => ({ session: "", security: vi.fn(), monitoring: vi.fn() }));
// 只替換 Next request 邊界；會員角色、租戶查核、action 和 transaction 都走真實程式與 DB。
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "celebrate_session" && boundary.session ? { value: boundary.session } : undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: boundary.security }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: boundary.monitoring }));
import { upsertLiveAction } from "@/app/actions";

const vendorIds: string[] = [];
const userIds: string[] = [];

async function instructor(role = "owner") {
  const db = getDb(); const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic instructor", slug: `creation-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic", timezone: "Asia/Taipei" } });
  vendorIds.push(vendor.id);
  const user = await db.user.create({ data: { name: "Synthetic instructor", email: `user-${suffix}@example.test`, passwordHash: "synthetic" } });
  userIds.push(user.id);
  const member = await db.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role, status: "active" } });
  const session = `synthetic-creation-${suffix}`;
  await db.userSession.create({ data: { userId: user.id, vendorId: vendor.id, tokenHash: createHash("sha256").update(session).digest("hex"), expiresAt: new Date(Date.now() + 60_000) } });
  return { db, vendor, member, session };
}

async function draft(fixture: Awaited<ReturnType<typeof instructor>>, orientation: "landscape" | "portrait") {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    title: `Synthetic ${orientation} activity`, slug: `creation-live-${randomUUID()}`,
    scheduledAt: "2030-01-01T20:00", streamMode: "live", orientation, status: "draft",
    affiliateMode: "disabled", maxConcurrentViewers: "500", stopWhenCreditsBelow: "300",
    usageAttributionMode: "PROMOTER", quotaPayerScope: "VENDOR", splitOwnerBps: "3000", splitPromoterBps: "7000",
  })) form.set(key, value);
  const payload = liveStudioDraftFromFormData(form, 7);
  const row = await fixture.db.liveStudioDraft.create({ data: { vendorId: fixture.vendor.id, payload, revision: 1, updatedByMemberId: fixture.member.id, expiresAt: new Date(Date.now() + 60_000) } });
  form.set("liveDraftId", row.id); form.set("liveDraftRevision", "1");
  return { form, row };
}

describe.skipIf(process.env.RT01_D2_DISPOSABLE_DB !== "true" || !classifyLocalTestDatabase(process.env.DATABASE_URL).safe)("instructor activity creation through the real Server Action and PostgreSQL", () => {
  beforeEach(() => {
    boundary.session = ""; boundary.security.mockReset().mockResolvedValue(undefined); boundary.monitoring.mockReset();
    // 本組只建立 draft，不得寄信、發起付款或呼叫媒體服務。
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External request is forbidden in creation fixtures"); }));
  });
  afterEach(async () => {
    try {
      expect(fetch).not.toHaveBeenCalled();
      expect(boundary.monitoring).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals(); boundary.session = "";
      await getDb().user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
      await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
    }
  });
  afterAll(async () => { await getDb().$disconnect(); });

  it.each(["landscape", "portrait"] as const)("creates a %s activity with its persisted layout and consumes its exact draft once", async orientation => {
    const current = await instructor(); const other = await instructor(); const submitted = await draft(current, orientation);
    boundary.session = current.session;
    // 提交的 vendorId 不能覆寫登入講師所屬租戶。
    submitted.form.set("vendorId", other.vendor.id);
    const result = await upsertLiveAction(submitted.form).catch(error => error);
    const created = await current.db.live.findMany({ where: { vendorId: current.vendor.id } });
    expect(created).toHaveLength(1);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe(`redirect:/lives/${created[0]!.id}/preview`);
    expect(created[0]).toMatchObject({ vendorId: current.vendor.id, status: "draft", streamMode: "live", scheduledAt: new Date("2030-01-01T12:00:00.000Z"), presenterLayout: { ...DEFAULT_PRESENTER_LAYOUT, orientation } });
    expect(await current.db.live.count({ where: { vendorId: other.vendor.id } })).toBe(0);
    expect(await current.db.liveStudioDraft.findUniqueOrThrow({ where: { id: submitted.row.id } })).toMatchObject({ consumedAt: expect.any(Date), revision: 1 });
    await expect(upsertLiveAction(submitted.form)).rejects.toThrow(`redirect:/lives/new?error=draft_conflict&draft=${submitted.row.id}`);
    expect(await current.db.live.count({ where: { vendorId: current.vendor.id } })).toBe(1);
    expect(boundary.security).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-manager through the real role guard without creating a live or consuming the draft", async () => {
    const current = await instructor("support"); const submitted = await draft(current, "portrait");
    boundary.session = current.session;
    await expect(upsertLiveAction(submitted.form)).rejects.toThrow("redirect:/dashboard?error=insufficient_role");
    expect(await current.db.live.count({ where: { vendorId: current.vendor.id } })).toBe(0);
    expect(await current.db.liveStudioDraft.findUniqueOrThrow({ where: { id: submitted.row.id } })).toMatchObject({ consumedAt: null, revision: 1 });
  });

  it("cannot claim another tenant's matching creation draft", async () => {
    const current = await instructor(); const other = await instructor(); const submitted = await draft(other, "portrait");
    boundary.session = current.session;
    await expect(upsertLiveAction(submitted.form)).rejects.toThrow(`redirect:/lives/new?error=draft_conflict&draft=${submitted.row.id}`);
    expect(await current.db.live.count({ where: { vendorId: { in: [current.vendor.id, other.vendor.id] } } })).toBe(0);
    expect(await current.db.liveStudioDraft.findUniqueOrThrow({ where: { id: submitted.row.id } })).toMatchObject({ vendorId: other.vendor.id, consumedAt: null, revision: 1 });
  });
});
