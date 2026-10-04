import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ vendorId: "", database: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => runtime.database }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: async () => ({ id: runtime.vendorId, timezone: "Asia/Taipei" }) }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

vi.mock("@/lib/line-live-started", () => ({ dispatchLiveStartedLineNotificationsSafely: vi.fn() }));
vi.mock("@/lib/live-notification-delivery", () => ({ materializeLiveNotificationRules: vi.fn(), supersedeLiveNotificationDeliveriesForLifecycle: vi.fn() }));

import { upsertLiveAction } from "@/app/actions";
import { liveStudioDraftFromFormData } from "@/lib/live-studio-draft-client";
import { mutateProduct } from "./product-actions";
import { upsertFormBuilderAction } from "./form-actions";
import { initialProductActionState } from "@/lib/product-action-state";

// Actual PostgreSQL writes; only request/session boundaries are synthetic.
const db = new PrismaClient();
const vendors: string[] = [];
async function owner() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic binding", slug: id, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  return vendor.id;
}
async function project(vendorId: string, archived = false) {
  return db.salesProject.create({ data: { vendorId, name: "Synthetic project", slug: randomUUID(), mode: "live_course", primaryFlow: "live", status: archived ? "archived" : "draft" } });
}
function productForm(projectId: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ projectId, name: "Synthetic product", slug: randomUUID(), price: "12", inventory: "12", currency: "TWD", fulfillmentType: "physical" })) data.set(key, value);
  return data;
}
function registrationForm(projectId: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ projectId, name: "Synthetic form", slug: randomUUID(), headline: "Register", description: "Synthetic", submitLabel: "Submit", successMessage: "Saved", isActive: "on", fields: JSON.stringify([{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }]) })) data.set(key, value);
  return data;
}
beforeEach(async () => { runtime.database = db; runtime.vendorId = await owner(); });
afterEach(async () => { runtime.database = db; await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } }); });
afterAll(async () => db.$disconnect());

describe("project resource binding PostgreSQL transactions", () => {
  it("persists the product and tenant-qualified project link together", async () => {
    const selected = await project(runtime.vendorId);
    const result = await mutateProduct(runtime.vendorId, initialProductActionState, productForm(selected.id));
    expect(result.ok).toBe(true);
    const links = await db.salesProjectProduct.findMany({ where: { vendorId: runtime.vendorId }, include: { product: true } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ projectId: selected.id, vendorId: runtime.vendorId, product: { vendorId: runtime.vendorId } });
  });

  it("rolls back the inserted product when the later project link fails", async () => {
    const selected = await project(runtime.vendorId);
    // Inject failure after the real product INSERT within the actual transaction.
    runtime.database = db.$extends({ query: { salesProjectProduct: { async create() { throw new Error("synthetic link failure"); } } } });
    await expect(mutateProduct(runtime.vendorId, initialProductActionState, productForm(selected.id))).rejects.toThrow("synthetic link failure");
    expect(await db.product.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
    expect(await db.salesProjectProduct.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });

  it.each(["foreign", "archived"])("rejects %s projects without persisting either resource", async (kind) => {
    const selected = await project(kind === "foreign" ? await owner() : runtime.vendorId, kind === "archived");
    expect((await mutateProduct(runtime.vendorId, initialProductActionState, productForm(selected.id))).ok).toBe(false);
    expect((await upsertFormBuilderAction({ status: "idle", message: "" }, registrationForm(selected.id))).status).toBe("error");
    expect(await db.product.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
    expect(await db.registrationForm.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
    expect(await db.salesProjectProduct.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });

  it("persists the form relation to the validated current tenant project", async () => {
    const selected = await project(runtime.vendorId);
    await expect(upsertFormBuilderAction({ status: "idle", message: "" }, registrationForm(selected.id))).rejects.toThrow("redirect:/forms");
    expect(await db.registrationForm.findMany({ where: { vendorId: runtime.vendorId }, select: { projectId: true } })).toEqual([{ projectId: selected.id }]);
  });
});

async function liveDraft(projectId?: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ title: "Synthetic live", slug: randomUUID(), scheduledAt: "2026-12-01T12:00", streamMode: "vod", affiliateMode: "disabled", maxConcurrentViewers: "500", stopWhenCreditsBelow: "300", usageAttributionMode: "PROMOTER", quotaPayerScope: "VENDOR", splitOwnerBps: "3000", splitPromoterBps: "7000", status: "draft", ...(projectId ? { projectId } : {}) })) data.set(key, value);
  const saved = await db.liveStudioDraft.create({ data: { vendorId: runtime.vendorId, updatedByMemberId: "synthetic-member", payload: liveStudioDraftFromFormData(data, 7), expiresAt: new Date(Date.now() + 60_000) } });
  data.set("liveDraftId", saved.id); data.set("liveDraftRevision", String(saved.revision));
  return { data, id: saved.id };
}

describe("live project binding PostgreSQL draft atomicity", () => {
  it("creates one project live and consumes its matching draft exactly once", async () => {
    const selected = await project(runtime.vendorId);
    const draft = await liveDraft(selected.id);
    await expect(upsertLiveAction(draft.data)).rejects.toThrow(/redirect:\/lives\/[^/]+\/preview/u);
    expect(await db.live.count({ where: { vendorId: runtime.vendorId, projectId: selected.id } })).toBe(1);
    expect((await db.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).consumedAt).not.toBeNull();
    await expect(upsertLiveAction(draft.data)).rejects.toThrow("error=draft_conflict");
    expect(await db.live.count({ where: { vendorId: runtime.vendorId } })).toBe(1);
  });

  it("rolls back draft consumption when live creation fails after the claim", async () => {
    const selected = await project(runtime.vendorId);
    const draft = await liveDraft(selected.id);
    runtime.database = db.$extends({ query: { live: { async create() { throw new Error("synthetic live failure"); } } } });
    await expect(upsertLiveAction(draft.data)).rejects.toThrow("synthetic live failure");
    expect((await db.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).consumedAt).toBeNull();
    expect(await db.live.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });

  it.each(["foreign", "archived"])("rejects %s project without consuming the saved draft", async (kind) => {
    const selected = await project(kind === "foreign" ? await owner() : runtime.vendorId, kind === "archived");
    const draft = await liveDraft(selected.id);
    await expect(upsertLiveAction(draft.data)).rejects.toThrow("error=invalid_reference");
    expect((await db.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).consumedAt).toBeNull();
    expect(await db.live.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });

  it("rejects forged project context that differs from the saved payload", async () => {
    const selected = await project(runtime.vendorId);
    const another = await project(runtime.vendorId);
    const draft = await liveDraft(selected.id);
    draft.data.set("projectId", another.id);
    await expect(upsertLiveAction(draft.data)).rejects.toThrow("error=draft_conflict");
    expect((await db.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).consumedAt).toBeNull();
    expect(await db.live.count({ where: { vendorId: runtime.vendorId } })).toBe(0);
  });

  it("still consumes legacy drafts without a project field", async () => {
    const draft = await liveDraft();
    await expect(upsertLiveAction(draft.data)).rejects.toThrow(/redirect:\/lives\/[^/]+\/preview/u);
    expect(await db.live.count({ where: { vendorId: runtime.vendorId, projectId: null } })).toBe(1);
  });
});
