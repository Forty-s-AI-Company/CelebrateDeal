import { randomUUID } from "node:crypto";
import { PrismaClient, type Vendor } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The edit page and the studio save against PostgreSQL; only the request,
// session and client-component boundaries are synthetic.
const runtime = vi.hoisted(() => ({ vendor: null as unknown, stepperProps: [] as Array<Record<string, unknown>> }));
const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => db.client }));
vi.mock("@/lib/auth", () => ({
  requireVendorManager: async () => runtime.vendor,
  requireVendorManagerContext: async () => ({
    auth: { user: { id: "synthetic-user" }, member: { id: "synthetic-member", role: "owner" } },
    vendor: runtime.vendor,
  }),
}));
vi.mock("@/lib/sales-project-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sales-project-scope")>()),
  getSalesProjectScope: async () => ({ projectId: null, projectName: null, isAggregate: false, isLegacyWorkspace: true }),
}));
vi.mock("@/lib/csrf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csrf")>()),
  assertServerActionSecurity: async () => undefined,
  getCsrfToken: async () => "synthetic-csrf",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error("not_found"); },
}));
vi.mock("@/lib/line-live-started", () => ({ dispatchLiveStartedLineNotificationsSafely: vi.fn() }));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: vi.fn() }));
vi.mock("@/components/live-stepper-form", () => ({
  LiveStepperForm: (props: Record<string, unknown>) => { runtime.stepperProps.push(props); return null; },
}));
vi.mock("@/components/live-interaction-studio", () => ({ LiveInteractionStudio: () => null }));
vi.mock("@/components/evergreen-webinar-settings", () => ({ EvergreenWebinarSettings: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import { upsertLiveAction } from "@/app/actions";
import { liveStudioDraftFromFormData } from "@/lib/live-studio-draft-client";
import type { LiveStudioDraftEnvelope, LiveStudioDraftPayload } from "@/lib/live-studio-draft";
import { LIVE_STUDIO_LAST_STEP_INDEX } from "@/lib/live-studio-steps";
import EditLivePage from "./page";

const prisma = new PrismaClient();
const vendors: string[] = [];

beforeEach(async () => {
  db.client = prisma;
  runtime.stepperProps = [];
  const id = randomUUID();
  const vendor = await prisma.vendor.create({ data: { name: "Synthetic pin order", slug: id, email: `${id}@example.test`, passwordHash: "synthetic-only", timezone: "Asia/Taipei" } });
  vendors.push(vendor.id);
  runtime.vendor = vendor;
});
afterEach(async () => { await prisma.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } }); });
afterAll(async () => prisma.$disconnect());

const vendorId = () => (runtime.vendor as Vendor).id;

async function resources() {
  const video = await prisma.video.create({ data: { vendorId: vendorId(), title: "Recording", sourceType: "url", status: "ready", videoUrl: "https://video.example.test/r.m3u8", durationSec: 3_600 } });
  const form = await prisma.registrationForm.create({ data: {
    vendorId: vendorId(), name: "Form", slug: randomUUID(), headline: "Register",
    fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
  } });
  const template = await prisma.messageTemplate.create({ data: {
    vendorId: vendorId(), name: "Confirmed", channel: "email", trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} {{unsubscribe_url}}", isActive: true,
  } });
  // Created oldest first, so the studio lists them C, B, A (newest first).
  const products = [];
  for (const name of ["商品甲", "商品乙", "商品丙"]) {
    products.push(await prisma.product.create({ data: {
      vendorId: vendorId(), name, slug: randomUUID(), priceCents: 129_000, inventory: 20,
      isActive: true, fulfillmentTypeConfirmed: true, fulfillmentType: "physical", commerceDomain: "merchant",
      createdAt: new Date(Date.UTC(2026, 10, 1 + products.length)),
    } }));
  }
  const [a, b, c] = products as [typeof products[number], typeof products[number], typeof products[number]];
  return { video, form, template, a, b, c };
}

type Resources = Awaited<ReturnType<typeof resources>>;

function scheduleIn(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return `${day}T20:00`;
}

/** The studio's submit: its hidden productIds fields in selection order, after the draft it saved. */
async function studioSubmit(input: { liveId?: string; slug: string; res: Resources; productIds: string[] }) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    title: "置頂順序直播", slug: input.slug, scheduledAt: scheduleIn(7), streamMode: "vod",
    replayEnabled: "on", affiliateMode: "disabled", maxConcurrentViewers: "500", stopWhenCreditsBelow: "300",
    usageAttributionMode: "PROMOTER", quotaPayerScope: "VENDOR", splitOwnerBps: "3000", splitPromoterBps: "7000", studioPreset: "COMMERCE",
    videoId: input.res.video.id, formId: input.res.form.id, messageTemplateId: input.res.template.id, status: "scheduled",
  })) data.set(key, value);
  for (const productId of input.productIds) data.append("productIds", productId);
  if (input.liveId) data.set("id", input.liveId);
  const saved = await prisma.liveStudioDraft.create({ data: {
    vendorId: vendorId(), liveId: input.liveId ?? null, updatedByMemberId: "synthetic-member",
    payload: liveStudioDraftFromFormData(data, LIVE_STUDIO_LAST_STEP_INDEX), expiresAt: new Date(Date.now() + 60_000),
  } });
  data.set("liveDraftId", saved.id);
  data.set("liveDraftRevision", String(saved.revision));
  return data;
}

async function bindings(liveId: string) {
  return prisma.liveProduct.findMany({ where: { liveId }, orderBy: { sortOrder: "asc" }, select: { vendorId: true, productId: true, sortOrder: true, isPinned: true } });
}

async function renderEditPage(liveId: string) {
  runtime.stepperProps = [];
  renderToStaticMarkup(await EditLivePage({ params: Promise.resolve({ id: liveId }), searchParams: Promise.resolve({}) }));
  expect(runtime.stepperProps).toHaveLength(1);
  const props = runtime.stepperProps[0]!;
  return {
    listed: (props.products as Array<{ id: string }>).map((product) => product.id),
    initialValues: props.initialValues as LiveStudioDraftPayload,
    initialDraft: props.initialDraft as LiveStudioDraftEnvelope | undefined,
  };
}

describe("live product pin order through the studio", () => {
  it("opens the edit studio in the bound order and keeps the first submitted product pinned on save", async () => {
    const res = await resources();
    const slug = `pin-order-${randomUUID()}`;
    // Ticked 乙, then 甲, then 丙: neither list order nor creation order.
    await expect(upsertLiveAction(await studioSubmit({ slug, res, productIds: [res.b.id, res.a.id, res.c.id] }))).rejects.toThrow(/redirect:\/lives\/[^/]+\/preview/u);
    const live = await prisma.live.findFirstOrThrow({ where: { vendorId: vendorId(), slug }, select: { id: true } });
    expect(await bindings(live.id)).toEqual([
      { vendorId: vendorId(), productId: res.b.id, sortOrder: 1, isPinned: true },
      { vendorId: vendorId(), productId: res.a.id, sortOrder: 2, isPinned: false },
      { vendorId: vendorId(), productId: res.c.id, sortOrder: 3, isPinned: false },
    ]);

    const opened = await renderEditPage(live.id);
    expect(opened.listed).toEqual([res.c.id, res.b.id, res.a.id]);
    expect(opened.initialDraft).toBeUndefined();
    expect(opened.initialValues.productIds).toEqual([res.b.id, res.a.id, res.c.id]);

    // 設為置頂 on 丙 and 乙 unticked: the studio submits 丙, 甲.
    await expect(upsertLiveAction(await studioSubmit({ liveId: live.id, slug, res, productIds: [res.c.id, res.a.id] })))
      .rejects.toThrow(new RegExp(`redirect:/lives/${live.id}/edit`, "u"));
    expect(await bindings(live.id)).toEqual([
      { vendorId: vendorId(), productId: res.c.id, sortOrder: 1, isPinned: true },
      { vendorId: vendorId(), productId: res.a.id, sortOrder: 2, isPinned: false },
    ]);
    expect((await renderEditPage(live.id)).initialValues.productIds).toEqual([res.c.id, res.a.id]);
  });

  it("puts the pinned binding first even when its sort order is not the lowest", async () => {
    const res = await resources();
    const live = await prisma.live.create({ data: {
      vendorId: vendorId(), title: "既有直播", slug: `pin-legacy-${randomUUID()}`, scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
      products: { create: [
        { productId: res.a.id, sortOrder: 0, isPinned: false },
        { productId: res.b.id, sortOrder: 1, isPinned: false },
        { productId: res.c.id, sortOrder: 2, isPinned: true },
      ] },
    } });
    expect((await renderEditPage(live.id)).initialValues.productIds).toEqual([res.c.id, res.a.id, res.b.id]);
  });

  it("resumes an unsaved edit draft in the draft's own order", async () => {
    const res = await resources();
    const slug = `pin-draft-${randomUUID()}`;
    await expect(upsertLiveAction(await studioSubmit({ slug, res, productIds: [res.a.id, res.b.id] }))).rejects.toThrow(/redirect:\/lives\/[^/]+\/preview/u);
    const live = await prisma.live.findFirstOrThrow({ where: { vendorId: vendorId(), slug }, select: { id: true } });
    // The merchant pinned 乙 and the autosave stored it, without submitting yet.
    await studioSubmit({ liveId: live.id, slug, res, productIds: [res.b.id, res.a.id] });

    const opened = await renderEditPage(live.id);
    expect(opened.initialValues.productIds).toEqual([res.a.id, res.b.id]);
    expect(opened.initialDraft?.payload.productIds).toEqual([res.b.id, res.a.id]);
  });

  it("refuses another vendor's product in the submitted order and keeps the bound order", async () => {
    const res = await resources();
    const slug = `pin-foreign-${randomUUID()}`;
    await expect(upsertLiveAction(await studioSubmit({ slug, res, productIds: [res.a.id] }))).rejects.toThrow(/redirect:\/lives\/[^/]+\/preview/u);
    const live = await prisma.live.findFirstOrThrow({ where: { vendorId: vendorId(), slug }, select: { id: true } });
    const otherId = randomUUID();
    const other = await prisma.vendor.create({ data: { name: "Synthetic other", slug: otherId, email: `${otherId}@example.test`, passwordHash: "synthetic-only" } });
    vendors.push(other.id);
    const foreign = await prisma.product.create({ data: {
      vendorId: other.id, name: "他家商品", slug: randomUUID(), priceCents: 1_000, inventory: 1,
      isActive: true, fulfillmentTypeConfirmed: true, fulfillmentType: "physical", commerceDomain: "merchant",
    } });

    await expect(upsertLiveAction(await studioSubmit({ liveId: live.id, slug, res, productIds: [foreign.id, res.a.id] })))
      .rejects.toThrow("error=invalid_reference");
    expect(await bindings(live.id)).toEqual([{ vendorId: vendorId(), productId: res.a.id, sortOrder: 1, isPinned: true }]);
    expect(await prisma.liveProduct.count({ where: { productId: foreign.id } })).toBe(0);
  });
});
