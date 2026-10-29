import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ vendorId: "" }));
const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => db.client }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: async () => ({ id: runtime.vendorId, timezone: "Asia/Taipei" }) }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/line-live-started", () => ({ dispatchLiveStartedLineNotificationsSafely: vi.fn() }));
vi.mock("@/lib/live-notification-delivery", () => ({ materializeLiveNotificationRules: vi.fn(), supersedeLiveNotificationDeliveriesForLifecycle: vi.fn() }));

import { upsertLiveAction } from "@/app/actions";
import { liveStudioDraftFromFormData } from "@/lib/live-studio-draft-client";

// Actual PostgreSQL writes; only request/session boundaries are synthetic.
const prisma = new PrismaClient();
const vendors: string[] = [];

async function vendor() {
  const id = randomUUID();
  const created = await prisma.vendor.create({ data: { name: "Synthetic live create", slug: id, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(created.id);
  return created.id;
}

async function product(vendorId: string, name: string) {
  return prisma.product.create({ data: {
    vendorId, name, slug: randomUUID(), priceCents: 129_000, inventory: 20,
    isActive: true, fulfillmentTypeConfirmed: true, fulfillmentType: "physical", commerceDomain: "merchant",
  } });
}

/** The 2026-10-29 staging state: VOD 33:41, one product, form, email and a published script. */
async function reportedStudioResources(vendorId: string) {
  const video = await prisma.video.create({ data: {
    vendorId, title: "Synthetic VOD", sourceType: "cloudflare_stream", status: "ready", cloudflareReadyToStream: true,
    cloudflareStreamUid: `synthetic-${randomUUID()}`, videoUrl: "https://video.example.test/synthetic.m3u8", durationSec: 33 * 60 + 41,
  } });
  const form = await prisma.registrationForm.create({ data: {
    vendorId, name: "Synthetic form", slug: randomUUID(), headline: "Register",
    fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
  } });
  const template = await prisma.messageTemplate.create({ data: {
    vendorId, name: "Synthetic confirmation", channel: "email", trigger: "registration_confirmed",
    subject: "{{live_title}} 報名成功", body: "{{name}} {{unsubscribe_url}}", isActive: true,
  } });
  const script = await prisma.interactionScript.create({ data: { vendorId, name: "Synthetic script", status: "published" } });
  return { video, form, template, script };
}

async function savedDraft(vendorId: string, fields: Record<string, string>, productIds: string[]) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    title: "我吃原型食物就好!?", slug: `whole-food-live-${randomUUID()}`, scheduledAt: "2026-11-29T20:00", streamMode: "vod",
    replayEnabled: "on", replayAvailableUntil: "2026-12-15T23:59", affiliateMode: "disabled", maxConcurrentViewers: "500",
    stopWhenCreditsBelow: "300", usageAttributionMode: "PROMOTER", quotaPayerScope: "VENDOR", splitOwnerBps: "3000",
    splitPromoterBps: "7000", status: "scheduled", ...fields,
  })) data.set(key, value);
  for (const productId of productIds) data.append("productIds", productId);
  const saved = await prisma.liveStudioDraft.create({ data: {
    vendorId, updatedByMemberId: "synthetic-member", payload: liveStudioDraftFromFormData(data, 7), expiresAt: new Date(Date.now() + 60_000),
  } });
  data.set("liveDraftId", saved.id);
  data.set("liveDraftRevision", String(saved.revision));
  return { data, id: saved.id };
}

beforeEach(async () => { db.client = prisma; runtime.vendorId = await vendor(); });
afterEach(async () => { await prisma.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } }); });
afterAll(async () => prisma.$disconnect());

describe("creating a live with products from the eight-step studio", () => {
  it("schedules a new commerce live and binds its product under the current vendor", async () => {
    const resources = await reportedStudioResources(runtime.vendorId);
    const offered = await product(runtime.vendorId, "Synthetic whole-food box");
    const draft = await savedDraft(runtime.vendorId, {
      videoId: resources.video.id, formId: resources.form.id, messageTemplateId: resources.template.id,
      interactionScriptId: resources.script.id, studioPreset: "COMMERCE",
    }, [offered.id]);

    await expect(upsertLiveAction(draft.data)).rejects.toThrow(/redirect:\/lives\/[^/]+\/preview/u);

    const live = await prisma.live.findFirstOrThrow({
      where: { vendorId: runtime.vendorId },
      select: { id: true, status: true, videoId: true, formId: true, messageTemplateId: true, interactionScriptId: true, replayAvailableUntil: true },
    });
    expect(live).toMatchObject({
      status: "scheduled",
      videoId: resources.video.id,
      formId: resources.form.id,
      messageTemplateId: resources.template.id,
      interactionScriptId: resources.script.id,
      replayAvailableUntil: new Date("2026-12-15T15:59:00.000Z"),
    });
    expect(await prisma.liveProduct.findMany({
      where: { liveId: live.id },
      select: { vendorId: true, productId: true, sortOrder: true, isPinned: true },
    })).toEqual([{ vendorId: runtime.vendorId, productId: offered.id, sortOrder: 1, isPinned: true }]);
    expect((await prisma.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).consumedAt).not.toBeNull();
  });

  it("lets the composite (vendorId, productId) FK refuse a foreign product even inside the nested create", async () => {
    const foreign = await product(await vendor(), "Foreign product");
    await expect(prisma.$transaction((tx) => tx.live.create({ data: {
      vendorId: runtime.vendorId, title: "Synthetic", slug: `fk-${randomUUID()}`, scheduledAt: new Date("2026-11-29T12:00:00.000Z"),
      products: { create: [{ productId: foreign.id, sortOrder: 1, isPinned: true }] },
    } }))).rejects.toMatchObject({ code: "P2003" });
    expect(await prisma.live.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });

  it("maps a tenant FK violation during the write to invalid_reference and keeps the draft", async () => {
    const resources = await reportedStudioResources(runtime.vendorId);
    const offered = await product(runtime.vendorId, "Synthetic whole-food box");
    const draft = await savedDraft(runtime.vendorId, {
      videoId: resources.video.id, formId: resources.form.id, messageTemplateId: resources.template.id,
    }, [offered.id]);
    // The product passed validation, then stopped matching this vendor before the INSERT.
    db.client = prisma.$extends({ query: { live: { async create() {
      throw Object.assign(new Error("synthetic foreign key violation"), { code: "P2003" });
    } } } });

    await expect(upsertLiveAction(draft.data)).rejects.toThrow("error=invalid_reference");
    expect(await prisma.live.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
    expect((await prisma.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).consumedAt).toBeNull();
  });

  it("refuses another vendor's product without creating a live or consuming the draft", async () => {
    const resources = await reportedStudioResources(runtime.vendorId);
    const foreign = await product(await vendor(), "Foreign product");
    const draft = await savedDraft(runtime.vendorId, {
      videoId: resources.video.id, formId: resources.form.id, messageTemplateId: resources.template.id, status: "draft",
    }, [foreign.id]);

    await expect(upsertLiveAction(draft.data)).rejects.toThrow("error=invalid_reference");
    expect(await prisma.live.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
    expect(await prisma.liveProduct.count({ where: { productId: foreign.id } })).toBe(0);
    expect((await prisma.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).consumedAt).toBeNull();
  });
});
