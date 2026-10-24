import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

/**
 * Owner decision 2026-10-24: an audience ("建立名單") Funnel is published on
 * its own. These PostgreSQL tests cover the public URL, lead capture with
 * server-derived ownership, the unchanged project gate of other goals and
 * the cross-tenant boundary. All data is synthetic.
 */
const mocks = vi.hoisted(() => ({ manager: vi.fn(), scope: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/sales-project-scope", () => ({
  requireEditableSalesProjectScope: mocks.scope,
  getSalesProjectScope: mocks.scope,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { checkRateLimit } from "@/lib/rate-limit";
import { createFunnelFlow, type FunnelGoal } from "@/lib/funnel-flow";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";
import { applyFunnelTemplateChange } from "@/lib/funnel-template-transaction";
import type { PageDocument } from "@/lib/funnel-page-document";
import { deleteLandingPage, getLandingPagePublicationStatus, loadPublicLandingPage, publishLandingPage, unpublishLandingPage } from "@/lib/landing-page-service";
import { publicLandingPageStatus } from "@/lib/public-landing-page-status";
import { independentFunnelBindsForm, recordPublicFunnelVisit, resolvePublicFunnelRuntime } from "@/lib/funnel-runtime";
import { loadFunnelReports } from "@/lib/funnel-operations-service";
import { loadPublicRegistrationForm } from "@/lib/public-registration-form";
import { POST } from "@/app/api/form-submissions/route";

type Tenant = { vendorId: string; userId: string; projectId: string };
const vendorIds: string[] = [];
const userIds: string[] = [];

async function createTenant(label: string): Promise<Tenant> {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Synthetic audience ${label}`, slug: `audience-${label}-${suffix}`, email: `audience-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const user = await db.user.create({ data: { name: `Synthetic manager ${label}`, email: `audience-manager-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  userIds.push(user.id);
  // Draft project: none of its publication prerequisites exist.
  const project = await db.salesProject.create({
    data: { vendorId: vendor.id, name: "Synthetic draft project", slug: `audience-project-${suffix}`, mode: "live_course", primaryFlow: "live" },
  });
  return { vendorId: vendor.id, userId: user.id, projectId: project.id };
}

function actAs(tenant: Tenant) {
  mocks.manager.mockResolvedValue({ auth: { user: { id: tenant.userId } }, vendor: { id: tenant.vendorId } });
  mocks.scope.mockResolvedValue({ projectId: tenant.projectId, projectName: "Synthetic draft project", isAggregate: false, isLegacyWorkspace: false });
}

function funnelContent(goal: FunnelGoal) {
  const state = createFunnelStepPages(createFunnelFlow({ id: `flow_${goal}`, name: "合成名單網站", goal, domain: "synthetic" })!)!;
  const first = state.flow.steps.find((step) => !step.isSystem);
  if (!first) return state;
  const applied = applyFunnelTemplateChange(state.pages[first.id] as PageDocument, { templateId: "audience" });
  return { ...state, pages: { ...state.pages, [first.id]: applied.document } };
}

async function createDraftPage(tenant: Tenant, goal: FunnelGoal) {
  return getDb().landingPage.create({
    data: { vendorId: tenant.vendorId, projectId: tenant.projectId, name: "合成名單網站", slug: `aud-${randomUUID()}`, draftContent: funnelContent(goal) as unknown as Prisma.InputJsonValue },
  });
}

/** Publishes directly in the database: used for goals the publish action would reject without resources. */
async function publishDirectly(tenant: Tenant, goal: FunnelGoal) {
  const db = getDb();
  const page = await createDraftPage(tenant, goal);
  const version = await db.landingPageVersion.create({ data: { vendorId: tenant.vendorId, pageId: page.id, version: 1, content: page.draftContent as Prisma.InputJsonValue } });
  return db.landingPage.update({ where: { id: page.id }, data: { status: "published", publishedVersionId: version.id, publishedAt: new Date(), revision: { increment: 1 } } });
}

async function publishAudience(tenant: Tenant) {
  actAs(tenant);
  const page = await createDraftPage(tenant, "audience");
  const published = await publishLandingPage(page.id, page.revision);
  const stored = await getDb().landingPage.findUniqueOrThrow({ where: { id: page.id }, include: { publishedVersion: true } });
  return { page: stored, revision: published.revision };
}

async function visit(pageId: string, stepId = "opt_in") {
  const visitorId = `synthetic-visitor-${randomUUID()}`;
  const runtime = await resolvePublicFunnelRuntime({ pageId, requestedStepId: stepId, visitorId });
  if (!runtime || runtime.decision.status !== "render") return visitorId;
  await recordPublicFunnelVisit({ pageId, vendorId: runtime.page.vendorId, stepId: runtime.decision.renderedStepId, logicalStepId: runtime.decision.requestedStepId, visitorId, experiment: null });
  return visitorId;
}

function submit(input: { formId: string; landingPageId?: string; funnelStepId?: string; visitorId?: string; email?: string }) {
  return POST(new Request("https://app.example.test/api/form-submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...(input.visitorId ? { cookie: `celebratedeal_funnel_visitor=${input.visitorId}` } : {}),
    },
    body: JSON.stringify({
      formId: input.formId,
      ...(input.landingPageId ? { landingPageId: input.landingPageId } : {}),
      ...(input.funnelStepId ? { funnelStepId: input.funnelStepId } : {}),
      payload: { name: "合成訪客", email: input.email ?? `lead-${randomUUID()}@example.test` },
    }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "audience-funnel-db-test-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
});

afterEach(async () => {
  const db = getDb();
  const ids = vendorIds.splice(0);
  // Funnel history and versions RESTRICT their parents; remove them before the vendor cascade.
  await db.funnelSubmission.deleteMany({ where: { vendorId: { in: ids } } });
  await db.funnelVisit.deleteMany({ where: { vendorId: { in: ids } } });
  await db.landingPage.updateMany({ where: { vendorId: { in: ids } }, data: { status: "draft", publishedVersionId: null } });
  await db.landingPage.deleteMany({ where: { vendorId: { in: ids } } });
  await db.vendor.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  vi.unstubAllEnvs();
});

describe("audience Funnel in an unpublished project (PostgreSQL)", () => {
  it("publishes, opens publicly and binds a lead form owned by the same vendor and project", async () => {
    const tenant = await createTenant("public");
    const { page } = await publishAudience(tenant);

    expect(page.status).toBe("published");
    expect(page.draftFormId).toBeTruthy();
    expect(page.publishedVersion?.formId).toBe(page.draftFormId);
    const form = await getDb().registrationForm.findUniqueOrThrow({ where: { id: page.draftFormId! } });
    expect(form).toMatchObject({ vendorId: tenant.vendorId, projectId: tenant.projectId, isActive: true, submitLabel: "開始了解" });
    expect(await getDb().salesProject.findUniqueOrThrow({ where: { id: tenant.projectId } })).toMatchObject({ status: "draft", publishedAt: null });

    expect(await publicLandingPageStatus(`/lp/${page.slug}`)).toBe(200);
    expect(await publicLandingPageStatus(`/lp/${page.slug}/thank-you`)).toBe(200);
    const publicPage = await loadPublicLandingPage(page.slug);
    expect(publicPage).toMatchObject({ id: page.id, submissionForm: { id: form.id } });
    expect(publicPage?.commerceByPageId).toBeUndefined();

    // The form's own /form page still waits for the project.
    expect(await loadPublicRegistrationForm(form.slug)).toBeNull();

    actAs(tenant);
    await expect(getLandingPagePublicationStatus(page.id)).resolves.toEqual({ available: true, message: "一頁式網站已發布，公開頁目前可開啟。", projectHref: `/projects/${tenant.projectId}`, missing: [] });
  });

  it("stores a visitor lead for the page's vendor and project and lists it in the Funnel leads report", async () => {
    const tenant = await createTenant("lead");
    const { page } = await publishAudience(tenant);
    const visitorId = await visit(page.id);

    const response = await submit({ formId: page.draftFormId!, landingPageId: page.id, funnelStepId: "opt_in", visitorId });
    expect(response.status).toBe(200);
    expect(vi.mocked(checkRateLimit)).toHaveBeenCalledWith(expect.any(Request), "form-submissions", 10, 60_000);

    const submissions = await getDb().formSubmission.findMany({ where: { formId: page.draftFormId! }, include: { form: { select: { vendorId: true, projectId: true } } } });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.form).toEqual({ vendorId: tenant.vendorId, projectId: tenant.projectId });
    const provenance = await getDb().funnelSubmission.findUniqueOrThrow({ where: { submissionId: submissions[0]!.id } });
    expect(provenance).toMatchObject({ vendorId: tenant.vendorId, pageId: page.id, stepId: "opt_in" });
    expect(provenance.visitId).toBeTruthy();

    actAs(tenant);
    const reports = await loadFunnelReports(page.id);
    expect(reports.leads.map((lead) => lead.submissionId)).toEqual([submissions[0]!.id]);
  });

  it("refuses the project's form outside its audience Funnel", async () => {
    const tenant = await createTenant("direct");
    const { page } = await publishAudience(tenant);
    const formId = page.draftFormId!;

    // A plain /form post and a Funnel post without an observed visit both stay closed.
    expect((await submit({ formId })).status).toBe(404);
    expect((await submit({ formId, landingPageId: page.id, funnelStepId: "opt_in", visitorId: `synthetic-visitor-${randomUUID()}` })).status).toBe(404);
    expect(await getDb().formSubmission.count({ where: { formId } })).toBe(0);
    expect(await independentFunnelBindsForm({ pageId: page.id, formId, vendorId: tenant.vendorId, projectId: tenant.projectId })).toBe(true);
  });

  it("never lands a submission in another vendor's form", async () => {
    const owner = await createTenant("owner");
    const attacker = await createTenant("attacker");
    const ownerFunnel = await publishAudience(owner);
    const attackerFunnel = await publishAudience(attacker);
    const ownerForm = ownerFunnel.page.draftFormId!;
    const attackerForm = attackerFunnel.page.draftFormId!;

    // The attacker's published page and observed visit cannot carry the owner's form ...
    const attackerVisitor = await visit(attackerFunnel.page.id);
    expect((await submit({ formId: ownerForm, landingPageId: attackerFunnel.page.id, funnelStepId: "opt_in", visitorId: attackerVisitor })).status).toBe(404);
    // ... and the owner's page cannot carry the attacker's form.
    const ownerVisitor = await visit(ownerFunnel.page.id);
    expect((await submit({ formId: attackerForm, landingPageId: ownerFunnel.page.id, funnelStepId: "opt_in", visitorId: ownerVisitor })).status).toBe(404);

    expect(await getDb().formSubmission.count({ where: { formId: { in: [ownerForm, attackerForm] } } })).toBe(0);
    expect(await getDb().funnelSubmission.count({ where: { vendorId: { in: [owner.vendorId, attacker.vendorId] } } })).toBe(0);
    expect(await independentFunnelBindsForm({ pageId: attackerFunnel.page.id, formId: ownerForm, vendorId: owner.vendorId, projectId: owner.projectId })).toBe(false);
    expect(await independentFunnelBindsForm({ pageId: ownerFunnel.page.id, formId: ownerForm, vendorId: attacker.vendorId, projectId: attacker.projectId })).toBe(false);
  });

  it("returns 404 again once the audience Funnel is unpublished or archived", async () => {
    const tenant = await createTenant("closed");
    const unpublished = await publishAudience(tenant);
    const visitorId = await visit(unpublished.page.id);
    actAs(tenant);
    await unpublishLandingPage(unpublished.page.id, unpublished.revision);
    expect(await publicLandingPageStatus(`/lp/${unpublished.page.slug}`)).toBe(404);
    expect(await loadPublicLandingPage(unpublished.page.slug)).toBeNull();
    expect((await submit({ formId: unpublished.page.draftFormId!, landingPageId: unpublished.page.id, funnelStepId: "opt_in", visitorId })).status).toBe(404);
    await expect(getLandingPagePublicationStatus(unpublished.page.id)).resolves.toMatchObject({ available: false, message: expect.stringContaining("一頁式網站尚未發布"), missing: [] });

    const archived = await publishAudience(tenant);
    await expect(deleteLandingPage(archived.page.id, archived.revision)).resolves.toEqual({ id: archived.page.id, archived: true });
    expect(await publicLandingPageStatus(`/lp/${archived.page.slug}`)).toBe(404);
    expect(await loadPublicLandingPage(archived.page.slug)).toBeNull();
    expect(await getDb().formSubmission.count({ where: { formId: { in: [unpublished.page.draftFormId!, archived.page.draftFormId!] } } })).toBe(0);
  });
});

describe("other Funnel goals keep the project publication gate (PostgreSQL)", () => {
  it.each(["sell", "webinar", "custom"] as const)("a published %s Funnel of an unpublished project is not public", async (goal) => {
    const tenant = await createTenant(goal);
    const page = await publishDirectly(tenant, goal);
    expect(await publicLandingPageStatus(`/lp/${page.slug}`)).toBe(404);
    expect(await loadPublicLandingPage(page.slug)).toBeNull();
    const firstStep = funnelContent(goal).flow.steps.find((step) => !step.isSystem)?.id ?? "inactive";
    expect(await resolvePublicFunnelRuntime({ pageId: page.id, requestedStepId: firstStep, visitorId: `synthetic-visitor-${randomUUID()}` })).toBeNull();

    actAs(tenant);
    const status = await getLandingPagePublicationStatus(page.id);
    expect(status.available).toBe(false);
    expect(status.message).toContain("專案尚未發布，公開網址目前無法開啟");
    expect(status.missing.length).toBeGreaterThan(0);
  });

  it("opens the same sell Funnel once its project is published", async () => {
    const tenant = await createTenant("sell-published");
    const page = await publishDirectly(tenant, "sell");
    await getDb().salesProject.update({ where: { id: tenant.projectId }, data: { status: "published", publishedAt: new Date() } });
    expect(await publicLandingPageStatus(`/lp/${page.slug}`)).toBe(200);
    expect(await loadPublicLandingPage(page.slug)).toMatchObject({ id: page.id });
  });
});
