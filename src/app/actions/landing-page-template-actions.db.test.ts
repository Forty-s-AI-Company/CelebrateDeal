import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";

// 範本庫 against PostgreSQL with the real session, role and project-scope
// guards: only cookies, redirects, CSRF and cache revalidation are synthetic.
const state = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "celebrate_session" && state.token ? { value: state.token } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => { throw new Error(`redirect:${url}`); },
  notFound: (): never => { throw new Error("not_found"); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));

import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import type { FunnelNode } from "@/lib/funnel-page-document";
import { parseFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { instantiateFunnelTemplate } from "@/lib/funnel-template-gallery";
import { LANDING_PAGE_MAX_CONTENT_BYTES, landingPageContentBytes } from "@/lib/landing-page-limits";
import { LANDING_PAGE_TEMPLATE_VENDOR_LIMIT, readStoredTemplateDocument } from "@/lib/landing-page-template-document";
import { getLandingPageTemplateName, listLandingPageTemplates, listLandingPageTemplateTargets, TEMPLATE_THUMBNAIL_SECTIONS } from "@/lib/landing-page-template-service";
import {
  applyLandingPageTemplateAction,
  createLandingPageFromTemplateAction,
  deleteLandingPageTemplateAction,
  readLandingPageTemplateDocumentAction,
  readLandingPageTemplateTargetAction,
  renameLandingPageTemplateAction,
  saveLandingPageTemplateAction,
} from "./landing-page-template-actions";

type Tenant = { vendorId: string; projectId: string; ownerId: string; formId: string };
const created = { vendorIds: [] as string[], userIds: [] as string[] };
const idle = { status: "idle" as const, message: "" };

function form(entries: Record<string, string | number>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, String(value));
  return data;
}

async function createUser(label: string) {
  const user = await getDb().user.create({ data: { name: label, email: `${label}-${randomUUID()}@example.test`, passwordHash: "synthetic-only" } });
  created.userIds.push(user.id);
  return user;
}

async function signIn(userId: string, vendorId: string | null) {
  const token = randomBytes(32).toString("base64url");
  await getDb().userSession.create({
    data: { userId, vendorId, tokenHash: createHash("sha256").update(token).digest("hex"), mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000) },
  });
  state.token = token;
}

async function selectProject(userId: string, vendorId: string, projectId: string) {
  await getDb().userOnboardingPreference.upsert({
    where: { userId_vendorId: { userId, vendorId } },
    create: { userId, vendorId, selectedProjectId: projectId },
    update: { selectedProjectId: projectId },
  });
}

async function createTenant(label: string): Promise<Tenant> {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Template ${label}`, slug: `template-${label}-${suffix}`, email: `template-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  created.vendorIds.push(vendor.id);
  const owner = await createUser(`owner-${label}`);
  await db.vendorMember.create({ data: { vendorId: vendor.id, userId: owner.id, role: "owner" } });
  const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "Synthetic project", slug: `project-${suffix}`, mode: "live_course", primaryFlow: "live" } });
  await selectProject(owner.id, vendor.id, project.id);
  const registration = await db.registrationForm.create({
    data: { vendorId: vendor.id, projectId: project.id, name: "Synthetic form", slug: `form-${suffix}`, headline: "Register", fields: [{ key: "name", label: "姓名", type: "text", required: true }], isActive: true },
  });
  return { vendorId: vendor.id, projectId: project.id, ownerId: owner.id, formId: registration.id };
}

const node = (id: string, type: FunnelNode["type"], props: Record<string, unknown> = {}, children?: FunnelNode[], actions: FunnelNode["actions"] = []): FunnelNode => ({
  schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions, attributes: {}, ...(children ? { children } : {}),
});

/** An audience funnel whose opt-in page references the tenant's form, a consultation event and a next step. */
async function createFunnelPage(tenant: Tenant, label = "source") {
  const content = createGoalFunnelStepPages({ id: "funnel_flow", name: `網站 ${label}`, goal: "audience", domain: `site-${label}` })!;
  const optIn = content.flow.steps.find((step) => step.type === "opt_in_page")!;
  const next: FunnelStepPages = structuredClone(content);
  next.pages[optIn.id]!.root = [node(`${label}_section`, "section", {}, [node(`${label}_row`, "row", {}, [
    node(`${label}_headline`, "headline", { text: `${label} 的名單頁標題`, level: "h1" }),
    node(`${label}_calendar`, "calendar", { eventId: `event-${tenant.vendorId}` }),
    node(`${label}_register`, "button", { label: "立即報名" }, undefined, [{ type: "registration", formId: tenant.formId, useBoundLive: true }]),
    node(`${label}_next`, "button", { label: "下一步" }, undefined, [{ type: "next_step", stepId: "opt_in_thank_you" }]),
    node(`${label}_raw`, "raw_html", { html: "<p>保留</p>" }),
  ])])];
  const parsed = parseFunnelStepPages(next);
  if (!parsed) throw new Error("fixture funnel must be valid");
  const page = await getDb().landingPage.create({
    data: { vendorId: tenant.vendorId, projectId: tenant.projectId, name: `網站 ${label}`, slug: `lp-${label}-${randomUUID()}`, draftContent: parsed as never },
  });
  return { page, stepId: optIn.id, thankYouStepId: content.flow.steps.find((step) => step.type === "opt_in_thank_you_page")!.id };
}

async function saveTemplate(pageId: string, stepId: string, name = "我的名單頁") {
  return saveLandingPageTemplateAction(idle, form({ pageId, stepId, name }));
}

async function templateRows(vendorId: string) {
  return getDb().landingPageTemplate.findMany({ where: { vendorId }, orderBy: { createdAt: "asc" } });
}

async function storedStep(pageId: string, stepId: string) {
  const page = await getDb().landingPage.findUniqueOrThrow({ where: { id: pageId } });
  const content = parseFunnelStepPages(page.draftContent)!;
  return { revision: page.revision, step: content.flow.steps.find((step) => step.id === stepId)!, page: content.pages[stepId]! };
}

let a: Tenant;
let b: Tenant;

beforeEach(async () => {
  a = await createTenant("a");
  b = await createTenant("b");
  await signIn(a.ownerId, a.vendorId);
});

afterEach(async () => {
  const db = getDb();
  state.token = "";
  // The selected-project relation is RESTRICT; remove preferences before the vendor cascade.
  await db.userOnboardingPreference.deleteMany({ where: { vendorId: { in: created.vendorIds } } });
  await db.landingPage.deleteMany({ where: { vendorId: { in: created.vendorIds } } });
  await db.registrationForm.deleteMany({ where: { vendorId: { in: created.vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: created.vendorIds.splice(0) } } });
  await db.user.deleteMany({ where: { id: { in: created.userIds.splice(0) } } });
});

afterAll(async () => { await getDb().$disconnect(); });

describe("save as template (PostgreSQL)", () => {
  it("stores the server-side draft of the step with every binding stripped", async () => {
    const { page, stepId } = await createFunnelPage(a);
    // A client-sent document is ignored: only page, step and name are read.
    const data = form({ pageId: page.id, stepId, name: "  秋季  名單頁 " });
    data.set("content", JSON.stringify({ forged: true }));
    const result = await saveLandingPageTemplateAction(idle, data);
    expect(result).toMatchObject({ status: "success" });

    const [row] = await templateRows(a.vendorId);
    expect(row).toMatchObject({ id: result.id, name: "秋季 名單頁", sourcePageId: page.id, createdById: a.ownerId });
    const serialized = JSON.stringify(row!.content);
    expect(serialized).not.toContain(a.formId);
    expect(serialized).not.toContain(`event-${a.vendorId}`);
    expect(serialized).not.toContain("opt_in_thank_you");
    expect(serialized).not.toContain("forged");
    expect(serialized).not.toContain("source_headline");
    expect(serialized).toContain("source 的名單頁標題");
    expect(serialized).toContain("<p>保留</p>");
    expect(readStoredTemplateDocument(row!.content)).not.toBeNull();
  });

  it("validates the name, the step and the per-vendor limit", async () => {
    const { page, stepId } = await createFunnelPage(a);
    expect(await saveTemplate(page.id, stepId, " ")).toMatchObject({ status: "error", message: expect.stringContaining("範本名稱") });
    expect(await saveTemplate(page.id, stepId, "名".repeat(81))).toMatchObject({ status: "error" });
    // The system 停用頁 cannot become a template.
    expect(await saveTemplate(page.id, "inactive")).toMatchObject({ status: "error", message: expect.stringContaining("找不到這個步驟") });
    expect(await saveTemplate(page.id, "missing_step")).toMatchObject({ status: "error" });
    expect(await templateRows(a.vendorId)).toHaveLength(0);

    await getDb().landingPageTemplate.createMany({
      data: Array.from({ length: LANDING_PAGE_TEMPLATE_VENDOR_LIMIT }, (_, index) => ({ vendorId: a.vendorId, name: `範本 ${index}`, content: { schemaVersion: 1, id: "tpl_page", root: [] } })),
    });
    expect(await saveTemplate(page.id, stepId)).toMatchObject({ status: "error", message: expect.stringContaining(`${LANDING_PAGE_TEMPLATE_VENDOR_LIMIT}`) });
    expect(await getDb().landingPageTemplate.count({ where: { vendorId: a.vendorId } })).toBe(LANDING_PAGE_TEMPLATE_VENDOR_LIMIT);
  });

  it("enforces the name bound in the database too", async () => {
    await expect(getDb().landingPageTemplate.create({ data: { vendorId: a.vendorId, name: " padded", content: {} } })).rejects.toThrow();
    await expect(getDb().landingPageTemplate.create({ data: { vendorId: a.vendorId, name: "ok", content: [] } })).rejects.toThrow();
  });
});

describe("single-page drafts (PostgreSQL)", () => {
  it("saves a non-funnel page document without a step, but cannot apply templates to it", async () => {
    const document = { schemaVersion: 1, id: "legacy_page", name: "單頁", root: [node("single_section", "section", {}, [node("single_row", "row", {}, [
      node("single_button", "button", { label: "報名" }, undefined, [{ type: "registration", formId: a.formId, useBoundLive: true }]),
    ])])] };
    const page = await getDb().landingPage.create({ data: { vendorId: a.vendorId, projectId: a.projectId, name: "單頁網站", slug: `single-${randomUUID()}`, draftContent: document as never } });
    expect(await saveLandingPageTemplateAction(idle, form({ pageId: page.id, name: "單頁範本" }))).toMatchObject({ status: "success" });
    expect(JSON.stringify((await templateRows(a.vendorId))[0]!.content)).not.toContain(a.formId);
    // A step id on a single-page draft names nothing.
    expect(await saveTemplate(page.id, "opt_in")).toMatchObject({ status: "error" });
    expect(await readLandingPageTemplateTargetAction(page.id)).toEqual({ ok: false, message: expect.stringContaining("舊版單頁格式") });
  });
});

describe("cross-tenant isolation (PostgreSQL)", () => {
  it("lists only the selected project's own sites as targets", async () => {
    const own = await createFunnelPage(a, "listed");
    const foreign = await createFunnelPage(b, "foreign");
    const otherProject = await getDb().salesProject.create({ data: { vendorId: a.vendorId, name: "Other", slug: `other-${randomUUID()}`, mode: "live_course", primaryFlow: "live" } });
    const elsewhere = await getDb().landingPage.create({ data: { vendorId: a.vendorId, projectId: otherProject.id, name: "其他專案", slug: `elsewhere-${randomUUID()}`, draftContent: own.page.draftContent as never } });
    const archived = await getDb().landingPage.create({ data: { vendorId: a.vendorId, projectId: a.projectId, name: "已封存", slug: `archived-${randomUUID()}`, draftContent: own.page.draftContent as never, archivedAt: new Date() } });
    const ids = (await listLandingPageTemplateTargets()).map((target) => target.id);
    expect(ids).toEqual([own.page.id]);
    expect(ids).not.toContain(foreign.page.id);
    expect(ids).not.toContain(elsewhere.id);
    expect(ids).not.toContain(archived.id);
    expect(await readLandingPageTemplateTargetAction(elsewhere.id)).toMatchObject({ ok: false });
  });

  it("cannot save another tenant's page as a template", async () => {
    const { page, stepId } = await createFunnelPage(b);
    expect(await saveTemplate(page.id, stepId)).toMatchObject({ status: "error", message: expect.stringContaining("找不到這個一頁式網站") });
    expect(await getDb().landingPageTemplate.count({ where: { vendorId: { in: [a.vendorId, b.vendorId] } } })).toBe(0);
  });

  it("cannot list, read, rename, delete or use another tenant's template", async () => {
    await signIn(b.ownerId, b.vendorId);
    const source = await createFunnelPage(b);
    const saved = await saveTemplate(source.page.id, source.stepId, "乙方範本");
    expect(saved.status).toBe("success");
    const foreignId = saved.id!;

    await signIn(a.ownerId, a.vendorId);
    expect((await listLandingPageTemplates()).map((template) => template.id)).not.toContain(foreignId);
    expect(await getLandingPageTemplateName(foreignId)).toBeNull();
    expect(await readLandingPageTemplateDocumentAction(foreignId)).toEqual({ ok: false, message: expect.stringContaining("找不到這個範本") });
    expect(await renameLandingPageTemplateAction(idle, form({ templateId: foreignId, name: "被改名" }))).toMatchObject({ status: "error", message: expect.stringContaining("找不到這個範本") });
    expect(await deleteLandingPageTemplateAction(idle, form({ templateId: foreignId }))).toMatchObject({ status: "error", message: expect.stringContaining("找不到這個範本") });

    const own = await createFunnelPage(a, "own");
    const applied = await applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: foreignId, pageId: own.page.id, stepId: own.stepId, revision: own.page.revision }));
    expect(applied).toMatchObject({ status: "error", message: expect.stringContaining("找不到這個範本") });
    expect((await storedStep(own.page.id, own.stepId)).revision).toBe(own.page.revision);

    const pagesBefore = await getDb().landingPage.count({ where: { vendorId: a.vendorId } });
    const createdFromForeign = await createLandingPageFromTemplateAction(idle, form({ templateKind: "mine", templateId: foreignId, name: "偷用範本", slug: `steal-${randomUUID().slice(0, 8)}`, goal: "audience", currency: "TWD" }));
    expect(createdFromForeign).toMatchObject({ status: "error", message: expect.stringContaining("找不到這個範本") });
    expect(await getDb().landingPage.count({ where: { vendorId: a.vendorId } })).toBe(pagesBefore);

    expect(await getDb().landingPageTemplate.findUniqueOrThrow({ where: { id: foreignId } })).toMatchObject({ vendorId: b.vendorId, name: "乙方範本" });
  });

  it("cannot read or apply a template to another tenant's page", async () => {
    const victim = await createFunnelPage(b, "victim");
    expect(await readLandingPageTemplateTargetAction(victim.page.id)).toEqual({ ok: false, message: expect.stringContaining("找不到這個一頁式網站") });
    const applied = await applyLandingPageTemplateAction(idle, form({ templateKind: "platform", templateId: "audience-volunteer", pageId: victim.page.id, stepId: victim.stepId, revision: victim.page.revision }));
    expect(applied).toMatchObject({ status: "error", message: expect.stringContaining("找不到這個一頁式網站") });
    const after = await storedStep(victim.page.id, victim.stepId);
    expect(after.revision).toBe(victim.page.revision);
    expect(JSON.stringify(after.page)).toContain("victim 的名單頁標題");
  });
});

describe("apply and create (PostgreSQL)", () => {
  it("applies an own template through the revision-checked save and regenerates its ids", async () => {
    const source = await createFunnelPage(a, "source");
    const saved = await saveTemplate(source.page.id, source.stepId);
    const target = await createFunnelPage(a, "target");

    const read = await readLandingPageTemplateTargetAction(target.page.id);
    expect(read).toMatchObject({ ok: true, target: { id: target.page.id, revision: target.page.revision, goal: "audience" } });

    const applied = await applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: saved.id!, pageId: target.page.id, stepId: target.stepId, revision: target.page.revision }));
    expect(applied).toMatchObject({ status: "success", revision: target.page.revision + 1 });
    const after = await storedStep(target.page.id, target.stepId);
    expect(after.step.template).toEqual({ source: "template", templateId: `mine_${saved.id}` });
    const serialized = JSON.stringify(after.page);
    expect(serialized).toContain("source 的名單頁標題");
    expect(serialized).not.toContain("target 的名單頁標題");
    expect(serialized).not.toContain("tpl_n");
    expect(serialized).not.toContain(a.formId);

    // Applying the same template to another step of the same funnel still yields unique ids.
    const again = await applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: saved.id!, pageId: target.page.id, stepId: target.thankYouStepId, revision: target.page.revision + 1 }));
    expect(again).toMatchObject({ status: "success", revision: target.page.revision + 2 });
  });

  it("refuses a stale revision and leaves the page unchanged", async () => {
    const target = await createFunnelPage(a, "stale");
    await getDb().landingPage.update({ where: { id: target.page.id }, data: { revision: { increment: 1 } } });
    const applied = await applyLandingPageTemplateAction(idle, form({ templateKind: "platform", templateId: "audience-volunteer", pageId: target.page.id, stepId: target.stepId, revision: target.page.revision }));
    expect(applied).toMatchObject({ status: "error", code: "conflict" });
    expect(JSON.stringify((await storedStep(target.page.id, target.stepId)).page)).toContain("stale 的名單頁標題");
  });

  it("refuses a platform template on a step it is not offered for, and the system step", async () => {
    const target = await createFunnelPage(a, "typed");
    const wrongType = await applyLandingPageTemplateAction(idle, form({ templateKind: "platform", templateId: "sell-product-checkout", pageId: target.page.id, stepId: target.stepId, revision: target.page.revision }));
    expect(wrongType).toMatchObject({ status: "error", message: expect.stringContaining("不適用") });
    const system = await applyLandingPageTemplateAction(idle, form({ templateKind: "platform", templateId: "audience-volunteer", pageId: target.page.id, stepId: "inactive", revision: target.page.revision }));
    expect(system).toMatchObject({ status: "error", message: expect.stringContaining("系統管理") });
    expect((await storedStep(target.page.id, target.stepId)).revision).toBe(target.page.revision);
  });

  it("applies a platform template to a compatible step", async () => {
    const target = await createFunnelPage(a, "platform");
    const applied = await applyLandingPageTemplateAction(idle, form({ templateKind: "platform", templateId: "audience-volunteer", pageId: target.page.id, stepId: target.stepId, revision: target.page.revision }));
    expect(applied).toMatchObject({ status: "success" });
    expect((await storedStep(target.page.id, target.stepId)).step.template).toEqual({ source: "template", templateId: "audience-volunteer" });
  });

  it("creates a new site from a platform or an own template in the selected project", async () => {
    const platform = await createLandingPageFromTemplateAction(idle, form({ templateKind: "platform", templateId: "custom-brand-info", name: "品牌網站", slug: `brand-${randomUUID().slice(0, 8)}`, goal: "custom", currency: "TWD" }));
    expect(platform).toMatchObject({ status: "success" });
    const platformPage = await getDb().landingPage.findUniqueOrThrow({ where: { id: platform.id! } });
    expect(platformPage).toMatchObject({ vendorId: a.vendorId, projectId: a.projectId });
    const platformContent = parseFunnelStepPages(platformPage.draftContent)!;
    expect(platformContent.flow.steps.find((step) => step.id === platform.stepId)).toMatchObject({ type: "info_page", template: { templateId: "custom-brand-info" } });

    const mismatch = await createLandingPageFromTemplateAction(idle, form({ templateKind: "platform", templateId: "custom-brand-info", name: "錯誤目標", slug: `wrong-${randomUUID().slice(0, 8)}`, goal: "sell", currency: "TWD" }));
    expect(mismatch).toMatchObject({ status: "error", message: expect.stringContaining("不適用") });

    const source = await createFunnelPage(a, "mine");
    const saved = await saveTemplate(source.page.id, source.stepId);
    const fromMine = await createLandingPageFromTemplateAction(idle, form({ templateKind: "mine", templateId: saved.id!, name: "用我的範本", slug: `mine-${randomUUID().slice(0, 8)}`, goal: "sell", currency: "TWD" }));
    expect(fromMine).toMatchObject({ status: "success" });
    const mineContent = parseFunnelStepPages((await getDb().landingPage.findUniqueOrThrow({ where: { id: fromMine.id! } })).draftContent)!;
    expect(mineContent.flow.steps.find((step) => step.id === fromMine.stepId)).toMatchObject({ type: "order_form", template: { templateId: `mine_${saved.id}` } });
    expect(JSON.stringify(mineContent.pages[fromMine.stepId!])).toContain("mine 的名單頁標題");
  });

  it("renames and deletes an own template", async () => {
    const source = await createFunnelPage(a);
    const saved = await saveTemplate(source.page.id, source.stepId);
    expect(await renameLandingPageTemplateAction(idle, form({ templateId: saved.id!, name: "新名稱" }))).toMatchObject({ status: "success" });
    expect((await templateRows(a.vendorId))[0]!.name).toBe("新名稱");
    expect(await deleteLandingPageTemplateAction(idle, form({ templateId: saved.id! }))).toMatchObject({ status: "success" });
    expect(await templateRows(a.vendorId)).toHaveLength(0);
    expect(await deleteLandingPageTemplateAction(idle, form({ templateId: saved.id! }))).toMatchObject({ status: "error" });
  });
});

describe("draft size limit (PostgreSQL)", () => {
  /** Grows the thank-you page until the stored funnel sits just under the limit, with room the template would exceed. */
  async function nearlyFullFunnel() {
    const { page, stepId, thankYouStepId } = await createFunnelPage(a, "full");
    const content = parseFunnelStepPages(page.draftContent)!;
    const growth = landingPageContentBytes(instantiateFunnelTemplate("audience-volunteer", content.pages[stepId]!.id)) - landingPageContentBytes(content.pages[stepId]);
    expect(growth).toBeGreaterThan(4_000);
    const target = LANDING_PAGE_MAX_CONTENT_BYTES - Math.floor(growth / 2);
    const fillers: FunnelNode[] = [];
    const filled = () => ({ ...content, pages: { ...content.pages, [thankYouStepId]: { ...content.pages[thankYouStepId]!, root: [node("filler_section", "section", {}, [node("filler_row", "row", {}, fillers)])] } } });
    while (landingPageContentBytes(filled()) < target) {
      fillers.push(node(`filler_${fillers.length}`, "text", { text: "x".repeat(Math.min(9_000, target - landingPageContentBytes(filled()))) }));
    }
    const stored = parseFunnelStepPages(filled())!;
    expect(landingPageContentBytes(stored)).toBeLessThanOrEqual(LANDING_PAGE_MAX_CONTENT_BYTES);
    const updated = await getDb().landingPage.update({ where: { id: page.id }, data: { draftContent: stored as never } });
    return { page: updated, stepId };
  }

  it("refuses a template that would grow the draft past the 512 KiB draft limit and leaves the page unchanged", async () => {
    const { page, stepId } = await nearlyFullFunnel();
    const before = await getDb().landingPage.findUniqueOrThrow({ where: { id: page.id } });
    const applied = await applyLandingPageTemplateAction(idle, form({ templateKind: "platform", templateId: "audience-volunteer", pageId: page.id, stepId, revision: page.revision }));
    expect(applied).toMatchObject({ status: "error", message: expect.stringContaining("512 KiB") });
    const after = await getDb().landingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(after.revision).toBe(before.revision);
    expect(after.draftContent).toEqual(before.draftContent);
  });

  it("refuses to create a site whose content would exceed the limit", async () => {
    const big = (await createFunnelPage(a, "bigsource")).page;
    const content = parseFunnelStepPages(big.draftContent)!;
    const optIn = content.flow.steps.find((step) => step.type === "opt_in_page")!.id;
    // 60 × 9,500 characters is over the shared draft limit (LANDING_PAGE_MAX_CONTENT_BYTES).
    const rows = Array.from({ length: 60 }, (_, index) => node(`huge_${index}`, "text", { text: "y".repeat(9_500) }));
    expect(landingPageContentBytes(rows)).toBeGreaterThan(LANDING_PAGE_MAX_CONTENT_BYTES);
    content.pages[optIn]!.root = [node("huge_section", "section", {}, [node("huge_row", "row", {}, rows)])];
    await getDb().landingPage.update({ where: { id: big.id }, data: { draftContent: content as never } });
    // The template alone is over the limit, so saving it is refused too.
    expect(await saveTemplate(big.id, optIn)).toMatchObject({ status: "error", message: expect.stringContaining("512 KiB") });
    // A row stored by any other path is still checked when it is used.
    const template = await getDb().landingPageTemplate.create({ data: { vendorId: a.vendorId, name: "過大的範本", content: { schemaVersion: 1, id: "tpl_page", name: "過大", root: content.pages[optIn]!.root } as never } });
    const pagesBefore = await getDb().landingPage.count({ where: { vendorId: a.vendorId } });
    const created = await createLandingPageFromTemplateAction(idle, form({ templateKind: "mine", templateId: template.id, name: "太大的網站", slug: `huge-${randomUUID().slice(0, 8)}`, goal: "audience", currency: "TWD" }));
    expect(created).toMatchObject({ status: "error", message: expect.stringContaining("512 KiB") });
    expect(await getDb().landingPage.count({ where: { vendorId: a.vendorId } })).toBe(pagesBefore);
  });
});

describe("custom code gate (PostgreSQL)", () => {
  const SCRIPT = "document.body.dataset.synthetic = 'template-js';";
  const customCodeDocument = (label: string) => ({ schemaVersion: 1, id: "tpl_page", name: label, root: [node("code_section", "section", {}, [node("code_row", "row", {}, [
    node("code_headline", "headline", { text: `${label} 標題`, level: "h2" }),
    node("code_node", "raw_html", { html: "<p>自訂區塊</p>", css: "p{color:#0f172a}", js: SCRIPT }),
  ])])] });

  async function scriptTemplate(label = "含 JS 的範本") {
    // Stored directly: what an earlier verified save left in the library.
    return getDb().landingPageTemplate.create({ data: { vendorId: a.vendorId, name: label, content: customCodeDocument(label) as never } });
  }
  async function verifyOwnerEmail() {
    await getDb().user.update({ where: { id: a.ownerId }, data: { emailVerifiedAt: new Date() } });
  }
  async function customCodeAudits() {
    return getDb().auditLog.findMany({ where: { vendorId: a.vendorId, action: "funnel_custom_code_saved" }, orderBy: { createdAt: "asc" } });
  }
  const restoreKillSwitch = process.env.FUNNEL_CUSTOM_CODE_DISABLED;
  afterEach(() => {
    if (restoreKillSwitch === undefined) delete process.env.FUNNEL_CUSTOM_CODE_DISABLED;
    else process.env.FUNNEL_CUSTOM_CODE_DISABLED = restoreKillSwitch;
  });

  it("refuses an owner without a verified e-mail applying a template with JS, leaving the draft and revision unchanged", async () => {
    const template = await scriptTemplate();
    const target = await createFunnelPage(a, "unverified");
    const before = await getDb().landingPage.findUniqueOrThrow({ where: { id: target.page.id } });
    const applied = await applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: template.id, pageId: target.page.id, stepId: target.stepId, revision: target.page.revision }));
    expect(applied).toEqual({ status: "error", message: "頁面含有自訂 JavaScript，必須先完成 Email 驗證才能儲存或發布。請到「驗證 Email」完成後再試。" });
    const after = await getDb().landingPage.findUniqueOrThrow({ where: { id: target.page.id } });
    expect(after.revision).toBe(before.revision);
    expect(after.draftContent).toEqual(before.draftContent);
    expect(await customCodeAudits()).toEqual([]);
  });

  it("refuses an owner without a verified e-mail creating a site from a template with JS", async () => {
    const template = await scriptTemplate();
    const pagesBefore = await getDb().landingPage.count({ where: { vendorId: a.vendorId } });
    const created = await createLandingPageFromTemplateAction(idle, form({ templateKind: "mine", templateId: template.id, name: "含 JS 網站", slug: `js-${randomUUID().slice(0, 8)}`, goal: "audience", currency: "TWD" }));
    expect(created).toMatchObject({ status: "error", message: expect.stringContaining("必須先完成 Email 驗證") });
    expect(await getDb().landingPage.count({ where: { vendorId: a.vendorId } })).toBe(pagesBefore);
  });

  it("lets an owner with a verified e-mail apply and create, auditing both writes", async () => {
    await verifyOwnerEmail();
    const template = await scriptTemplate();
    const target = await createFunnelPage(a, "verified");
    const applied = await applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: template.id, pageId: target.page.id, stepId: target.stepId, revision: target.page.revision }));
    expect(applied).toMatchObject({ status: "success", revision: target.page.revision + 1 });
    expect(JSON.stringify((await storedStep(target.page.id, target.stepId)).page)).toContain("template-js");

    const created = await createLandingPageFromTemplateAction(idle, form({ templateKind: "mine", templateId: template.id, name: "含 JS 網站", slug: `js-${randomUUID().slice(0, 8)}`, goal: "audience", currency: "TWD" }));
    expect(created).toMatchObject({ status: "success" });

    const audits = await customCodeAudits();
    expect(audits.map((audit) => [audit.targetType, audit.targetId, audit.actorId, (audit.after as { operation: string }).operation])).toEqual([
      ["LandingPage", target.page.id, a.ownerId, "apply_template"],
      ["LandingPage", created.id, a.ownerId, "create_from_template"],
    ]);
    // The audit names locations and sizes, never the code itself.
    expect(JSON.stringify(audits)).not.toContain("template-js");
  });

  it("refuses new JS from a template while the kill switch is on", async () => {
    await verifyOwnerEmail();
    const template = await scriptTemplate();
    const target = await createFunnelPage(a, "killswitch");
    process.env.FUNNEL_CUSTOM_CODE_DISABLED = "1";
    const applied = await applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: template.id, pageId: target.page.id, stepId: target.stepId, revision: target.page.revision }));
    expect(applied).toEqual({ status: "error", message: "平台已暫時停用自訂 JavaScript，目前無法新增或修改 JS；你仍可刪除 JS 或編輯其他內容。" });
    expect((await storedStep(target.page.id, target.stepId)).revision).toBe(target.page.revision);
    const saved = await (async () => {
      const source = await createFunnelPage(a, "killsource");
      const content = parseFunnelStepPages(source.page.draftContent)!;
      content.pages[source.stepId]!.root = customCodeDocument("開關").root as never;
      await getDb().landingPage.update({ where: { id: source.page.id }, data: { draftContent: content as never } });
      return saveTemplate(source.page.id, source.stepId, "開關中存");
    })();
    expect(saved).toMatchObject({ status: "error", message: expect.stringContaining("暫時停用自訂 JavaScript") });
    expect(await getDb().landingPageTemplate.count({ where: { vendorId: a.vendorId, name: "開關中存" } })).toBe(0);
  });

  it("saves a step with JS as a template only for a verified e-mail, keeping the code and auditing it", async () => {
    const source = await createFunnelPage(a, "codesource");
    const content = parseFunnelStepPages(source.page.draftContent)!;
    content.pages[source.stepId]!.root = customCodeDocument("來源").root as never;
    await getDb().landingPage.update({ where: { id: source.page.id }, data: { draftContent: content as never } });

    expect(await saveTemplate(source.page.id, source.stepId, "未驗證")).toEqual({ status: "error", message: "頁面含有自訂 JavaScript，必須先完成 Email 驗證才能儲存或發布。請到「驗證 Email」完成後再試。" });
    expect(await templateRows(a.vendorId)).toHaveLength(0);

    await verifyOwnerEmail();
    const saved = await saveTemplate(source.page.id, source.stepId, "已驗證");
    expect(saved).toMatchObject({ status: "success" });
    const [row] = await templateRows(a.vendorId);
    expect(JSON.stringify(row!.content)).toContain("template-js");
    const [audit] = await customCodeAudits();
    expect(audit).toMatchObject({ targetType: "LandingPageTemplate", targetId: saved.id, actorId: a.ownerId, after: { operation: "save_template", sourcePageId: source.page.id } });
    expect(JSON.stringify(audit!.after)).not.toContain("template-js");
  });

  it("needs no verified e-mail for HTML-only custom code, but still audits it", async () => {
    // createFunnelPage's opt-in page has an HTML-only raw_html node (no JS).
    const { page, stepId } = await createFunnelPage(a, "htmlonly");
    const saved = await saveTemplate(page.id, stepId, "只有 HTML");
    expect(saved).toMatchObject({ status: "success" });
    expect(await customCodeAudits()).toEqual([expect.objectContaining({ targetType: "LandingPageTemplate", targetId: saved.id, after: expect.objectContaining({ operation: "save_template" }) })]);
  });

  it("does not gate or audit a template without any custom code", async () => {
    const { page, stepId } = await createFunnelPage(a, "plain");
    const content = parseFunnelStepPages(page.draftContent)!;
    content.pages[stepId]!.root = [node("plain_section", "section", {}, [node("plain_row", "row", {}, [node("plain_text", "text", { text: "純文字" })])])];
    await getDb().landingPage.update({ where: { id: page.id }, data: { draftContent: content as never } });
    expect(await saveTemplate(page.id, stepId, "沒有程式碼")).toMatchObject({ status: "success" });
    expect(await customCodeAudits()).toEqual([]);
  });
});

describe("aggregate overview (PostgreSQL)", () => {
  it("keeps rename and delete vendor-level, but saving, reading targets and applying need a project", async () => {
    const { page, stepId } = await createFunnelPage(a);
    const saved = await saveTemplate(page.id, stepId, "總覽前建立");
    const second = await saveTemplate(page.id, stepId, "總覽前建立二");
    // A preference without a selected project is the read-only aggregate overview.
    await getDb().userOnboardingPreference.update({ where: { userId_vendorId: { userId: a.ownerId, vendorId: a.vendorId } }, data: { selectedProjectId: null } });

    expect((await listLandingPageTemplates()).map((template) => template.name).sort()).toEqual(["總覽前建立", "總覽前建立二"]);
    expect(await renameLandingPageTemplateAction(idle, form({ templateId: saved.id!, name: "總覽中改名" }))).toMatchObject({ status: "success" });
    expect(await deleteLandingPageTemplateAction(idle, form({ templateId: second.id! }))).toMatchObject({ status: "success" });
    expect((await templateRows(a.vendorId)).map((row) => row.name)).toEqual(["總覽中改名"]);

    expect(await saveTemplate(page.id, stepId, "總覽中存")).toMatchObject({ status: "error", message: expect.stringContaining("銷售專案") });
    expect(await readLandingPageTemplateTargetAction(page.id)).toEqual({ ok: false, message: expect.stringContaining("銷售專案") });
    expect(await applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: saved.id!, pageId: page.id, stepId, revision: page.revision }))).toMatchObject({ status: "error", message: expect.stringContaining("銷售專案") });
    expect(await templateRows(a.vendorId)).toHaveLength(1);
    expect((await storedStep(page.id, stepId)).revision).toBe(page.revision);
  });
});

describe("list and preview (PostgreSQL)", () => {
  it("lists a small thumbnail and reads the full document on demand", async () => {
    await createFunnelPage(a);
    const content = instantiateFunnelTemplate("audience-volunteer", "x");
    expect(content.root.length).toBeGreaterThan(TEMPLATE_THUMBNAIL_SECTIONS);
    const row = await getDb().landingPageTemplate.create({ data: { vendorId: a.vendorId, name: "長頁", content: content as never } });
    const [listed] = await listLandingPageTemplates();
    expect(listed).toMatchObject({ id: row.id, readable: true });
    expect(listed!.thumbnail!.root).toHaveLength(TEMPLATE_THUMBNAIL_SECTIONS);
    expect(listed!.thumbnail!.popups).toEqual([]);
    const full = await readLandingPageTemplateDocumentAction(row.id);
    expect(full).toMatchObject({ ok: true });
    expect(full.ok && full.document.root).toHaveLength(content.root.length);
  });

  it("lists an unreadable row so it can be deleted, and never applies it", async () => {
    const broken = await getDb().landingPageTemplate.create({ data: { vendorId: a.vendorId, name: "壞掉的範本", content: { schemaVersion: 99 } } });
    expect(await listLandingPageTemplates()).toEqual([expect.objectContaining({ id: broken.id, name: "壞掉的範本", readable: false, thumbnail: null })]);
    expect(await readLandingPageTemplateDocumentAction(broken.id)).toEqual({ ok: false, message: expect.stringContaining("找不到這個範本") });
    const target = await createFunnelPage(a, "target");
    expect(await applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: broken.id, pageId: target.page.id, stepId: target.stepId, revision: target.page.revision }))).toMatchObject({ status: "error" });
    expect(await deleteLandingPageTemplateAction(idle, form({ templateId: broken.id }))).toMatchObject({ status: "success" });
    expect(await listLandingPageTemplates()).toEqual([]);
  });
});

describe("concurrent saves (PostgreSQL)", () => {
  it("never passes the per-vendor limit when saves race", async () => {
    const { page, stepId } = await createFunnelPage(a);
    await getDb().landingPageTemplate.createMany({
      data: Array.from({ length: LANDING_PAGE_TEMPLATE_VENDOR_LIMIT - 2 }, (_, index) => ({ vendorId: a.vendorId, name: `既有 ${index}`, content: { schemaVersion: 1, id: "tpl_page", root: [] } })),
    });
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => saveTemplate(page.id, stepId, `並發 ${index}`)));
    const successes = results.filter((result) => result.status === "success");
    expect(successes.length).toBeLessThanOrEqual(2);
    for (const result of results.filter((item) => item.status !== "success")) {
      expect(result.message).toMatch(/最多可保存 100 個範本|系統忙碌中/u);
    }
    const count = await getDb().landingPageTemplate.count({ where: { vendorId: a.vendorId } });
    expect(count).toBeLessThanOrEqual(LANDING_PAGE_TEMPLATE_VENDOR_LIMIT);
    expect(count).toBe(LANDING_PAGE_TEMPLATE_VENDOR_LIMIT - 2 + successes.length);
  });
});

describe("role gate (PostgreSQL)", () => {
  async function member(role: "support" | "partner") {
    const user = await createUser(role);
    await getDb().vendorMember.create({ data: { vendorId: a.vendorId, userId: user.id, role } });
    await selectProject(user.id, a.vendorId, a.projectId);
    await signIn(user.id, a.vendorId);
    return user;
  }

  it.each([
    ["support", "redirect:/dashboard?error=insufficient_role"],
    ["partner", "redirect:/affiliate-portal"],
  ] as const)("%s cannot list, save, rename, delete, read targets, apply or create", async (role, redirect) => {
    await signIn(a.ownerId, a.vendorId);
    const { page, stepId } = await createFunnelPage(a);
    const saved = await saveTemplate(page.id, stepId, "原名");
    expect(saved.status).toBe("success");
    await member(role);

    await expect(listLandingPageTemplates()).rejects.toThrow(redirect);
    await expect(saveTemplate(page.id, stepId, "不應建立")).rejects.toThrow(redirect);
    await expect(renameLandingPageTemplateAction(idle, form({ templateId: saved.id!, name: "不應改名" }))).rejects.toThrow(redirect);
    await expect(deleteLandingPageTemplateAction(idle, form({ templateId: saved.id! }))).rejects.toThrow(redirect);
    await expect(readLandingPageTemplateTargetAction(page.id)).rejects.toThrow(redirect);
    await expect(readLandingPageTemplateDocumentAction(saved.id!)).rejects.toThrow(redirect);
    await expect(applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: saved.id!, pageId: page.id, stepId, revision: page.revision }))).rejects.toThrow(redirect);
    await expect(createLandingPageFromTemplateAction(idle, form({ templateKind: "mine", templateId: saved.id!, name: "不應建立", slug: `deny-${randomUUID().slice(0, 8)}`, goal: "audience", currency: "TWD" }))).rejects.toThrow(redirect);

    const rows = await templateRows(a.vendorId);
    expect(rows.map((row) => row.name)).toEqual(["原名"]);
    expect((await storedStep(page.id, stepId)).revision).toBe(page.revision);
    expect(await getDb().landingPage.count({ where: { vendorId: a.vendorId } })).toBe(1);
  });
});
