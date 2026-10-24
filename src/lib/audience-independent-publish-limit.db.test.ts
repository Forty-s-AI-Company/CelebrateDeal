import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

/**
 * Abuse guard for independent audience publication (#478 follow-up): a
 * vendor without an active paid plan or a verified payment method keeps at
 * most INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT audience Funnels public
 * without their project. PostgreSQL only; all data is synthetic.
 */
const mocks = vi.hoisted(() => ({ manager: vi.fn(), scope: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/sales-project-scope", () => ({
  requireEditableSalesProjectScope: mocks.scope,
  getSalesProjectScope: mocks.scope,
}));

import { createFunnelFlow } from "@/lib/funnel-flow";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";
import { applyFunnelTemplateChange } from "@/lib/funnel-template-transaction";
import type { PageDocument } from "@/lib/funnel-page-document";
import { deleteLandingPage, getLandingPagePublicationStatus, LandingPageInputError, publishLandingPage, unpublishLandingPage } from "@/lib/landing-page-service";
import { independentlyPublishedPageIds, INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT } from "@/lib/independent-publish-limit";
import { publicLandingPageStatus } from "@/lib/public-landing-page-status";

type Tenant = { vendorId: string; userId: string; projectId: string };
const vendorIds: string[] = [];
const userIds: string[] = [];
const planIds: string[] = [];
const LIMIT_ERROR = "landing_page_independent_publish_limit";

async function createTenant(label: string): Promise<Tenant> {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Synthetic limit ${label}`, slug: `limit-${label}-${suffix}`, email: `limit-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const user = await db.user.create({ data: { name: `Synthetic manager ${label}`, email: `limit-manager-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  userIds.push(user.id);
  const project = await createProject(vendor.id);
  return { vendorId: vendor.id, userId: user.id, projectId: project.id };
}

function createProject(vendorId: string, published = false) {
  return getDb().salesProject.create({
    data: {
      vendorId, name: "Synthetic project", slug: `limit-project-${randomUUID()}`, mode: "live_course", primaryFlow: "live",
      ...(published ? { status: "published", publishedAt: new Date() } : {}),
    },
  });
}

function actAs(tenant: Tenant) {
  mocks.manager.mockResolvedValue({ auth: { user: { id: tenant.userId } }, vendor: { id: tenant.vendorId } });
  mocks.scope.mockResolvedValue({ projectId: tenant.projectId, projectName: "Synthetic project", isAggregate: false, isLegacyWorkspace: false });
}

function audienceContent() {
  const state = createFunnelStepPages(createFunnelFlow({ id: "flow_audience", name: "合成名單網站", goal: "audience", domain: "synthetic" })!)!;
  const applied = applyFunnelTemplateChange(state.pages.opt_in as PageDocument, { templateId: "audience" });
  return { ...state, pages: { ...state.pages, opt_in: applied.document } };
}

function createDraftPage(tenant: Tenant) {
  return getDb().landingPage.create({
    data: { vendorId: tenant.vendorId, projectId: tenant.projectId, name: "合成名單網站", slug: `lim-${randomUUID()}`, draftContent: audienceContent() as unknown as Prisma.InputJsonValue },
  });
}

/** Publishes through the service, as the authenticated merchant of `tenant`. */
async function publish(tenant: Tenant) {
  actAs(tenant);
  const page = await createDraftPage(tenant);
  const result = await publishLandingPage(page.id, page.revision);
  return { ...page, revision: result.revision };
}

/** A page published before the limit existed: written straight to the database. */
async function publishedBeforeLimit(tenant: Tenant) {
  const db = getDb();
  const page = await createDraftPage(tenant);
  const version = await db.landingPageVersion.create({ data: { vendorId: tenant.vendorId, pageId: page.id, version: 1, content: page.draftContent as Prisma.InputJsonValue } });
  return db.landingPage.update({ where: { id: page.id }, data: { status: "published", publishedVersionId: version.id, publishedAt: new Date(), revision: { increment: 1 } } });
}

async function rejectsWithLimit(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(LandingPageInputError);
  expect((error as Error).message).toBe(LIMIT_ERROR);
}

async function givePaidPlan(tenant: Tenant) {
  const db = getDb();
  const plan = await db.billingPlan.create({ data: { name: "Synthetic paid plan", code: `synthetic-paid-${randomUUID()}`, monthlyPriceCents: 99_00 } });
  planIds.push(plan.id);
  await db.vendorSubscription.create({ data: { vendorId: tenant.vendorId, planId: plan.id, status: "active", startedAt: new Date(Date.now() - 60_000) } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  const db = getDb();
  const ids = vendorIds.splice(0);
  await db.landingPage.updateMany({ where: { vendorId: { in: ids } }, data: { status: "draft", publishedVersionId: null } });
  await db.landingPage.deleteMany({ where: { vendorId: { in: ids } } });
  await db.vendor.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  await db.billingPlan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});

describe("independent audience publication limit (PostgreSQL)", () => {
  it("is a single named constant of 3", () => {
    expect(INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT).toBe(3);
  });

  it("refuses the 4th independent publish, explains it beforehand and keeps the first three public", async () => {
    const tenant = await createTenant("fourth");
    const first = [await publish(tenant), await publish(tenant), await publish(tenant)];
    const fourth = await createDraftPage(tenant);

    actAs(tenant);
    const before = await getLandingPagePublicationStatus(fourth.id);
    expect(before.available).toBe(false);
    expect(before.message).toContain("目前已有 3 個，所以這個網站現在無法發布");
    expect(before.missing.map((link) => link.href)).toEqual([`/projects/${tenant.projectId}`, "/billing/plans"]);

    await rejectsWithLimit(publishLandingPage(fourth.id, fourth.revision));
    // The refused transaction left nothing behind: no version, no auto-created form, still a draft.
    expect(await getDb().landingPage.findUniqueOrThrow({ where: { id: fourth.id } })).toMatchObject({ status: "draft", publishedVersionId: null, draftFormId: null, revision: fourth.revision });
    expect(await getDb().landingPageVersion.count({ where: { pageId: fourth.id } })).toBe(0);
    expect(await getDb().registrationForm.count({ where: { vendorId: tenant.vendorId, slug: { startsWith: `lead-auto-${fourth.id}` } } })).toBe(0);
    expect(await publicLandingPageStatus(`/lp/${fourth.slug}`)).toBe(404);
    for (const page of first) expect(await publicLandingPageStatus(`/lp/${page.slug}`)).toBe(200);

    // Republishing a page that already uses a slot takes no new one.
    await expect(publishLandingPage(first[0]!.id, first[0]!.revision)).resolves.toMatchObject({ version: 2 });
  });

  it("frees a slot when a page is unpublished or archived", async () => {
    const tenant = await createTenant("freed");
    const pages = [await publish(tenant), await publish(tenant), await publish(tenant)];
    const next = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsWithLimit(publishLandingPage(next.id, next.revision));

    await unpublishLandingPage(pages[0]!.id, pages[0]!.revision);
    await expect(publishLandingPage(next.id, next.revision)).resolves.toMatchObject({ version: 1 });

    const another = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsWithLimit(publishLandingPage(another.id, another.revision));
    await expect(deleteLandingPage(pages[1]!.id, pages[1]!.revision)).resolves.toMatchObject({ archived: true });
    await expect(publishLandingPage(another.id, another.revision)).resolves.toMatchObject({ version: 1 });
  });

  it("does not limit a vendor with an active paid plan", async () => {
    const tenant = await createTenant("paid");
    await givePaidPlan(tenant);
    for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT + 2; index += 1) await publish(tenant);
    expect(await independentlyPublishedPageIds(getDb(), tenant.vendorId)).toHaveLength(INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT + 2);
  });

  it("does not limit a vendor with a verified payment method, but a pending or expired one does not count", async () => {
    const tenant = await createTenant("card");
    const db = getDb();
    await db.paymentMethodReference.create({ data: { vendorId: tenant.vendorId, providerName: "synthetic", providerPaymentMethodRef: `pending-${randomUUID()}`, status: "pending" } });
    await db.paymentMethodReference.create({ data: { vendorId: tenant.vendorId, providerName: "synthetic", providerPaymentMethodRef: `expired-${randomUUID()}`, status: "verified", verifiedAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() - 60_000) } });
    for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT; index += 1) await publish(tenant);
    const blocked = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsWithLimit(publishLandingPage(blocked.id, blocked.revision));

    await db.paymentMethodReference.create({ data: { vendorId: tenant.vendorId, providerName: "synthetic", providerPaymentMethodRef: `verified-${randomUUID()}`, status: "verified", verifiedAt: new Date(Date.now() - 60_000) } });
    await expect(publishLandingPage(blocked.id, blocked.revision)).resolves.toMatchObject({ version: 1 });
  });

  it("does not limit a vendor through an ended or free plan", async () => {
    const tenant = await createTenant("free-plan");
    const db = getDb();
    const free = await db.billingPlan.create({ data: { name: "Synthetic free plan", code: `synthetic-free-${randomUUID()}`, monthlyPriceCents: 0 } });
    const paid = await db.billingPlan.create({ data: { name: "Synthetic paid plan", code: `synthetic-paid-${randomUUID()}`, monthlyPriceCents: 99_00 } });
    planIds.push(free.id, paid.id);
    await db.vendorSubscription.create({ data: { vendorId: tenant.vendorId, planId: free.id, status: "active" } });
    await db.vendorSubscription.create({ data: { vendorId: tenant.vendorId, planId: paid.id, status: "pending_payment" } });
    await db.vendorSubscription.create({ data: { vendorId: tenant.vendorId, planId: paid.id, status: "active", endedAt: new Date(Date.now() - 60_000) } });
    for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT; index += 1) await publish(tenant);
    const blocked = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsWithLimit(publishLandingPage(blocked.id, blocked.revision));
  });

  it("does not count pages of a published project, and does not limit publishing inside one", async () => {
    const tenant = await createTenant("published-project");
    const publishedProject = await createProject(tenant.vendorId, true);
    const inPublished = { ...tenant, projectId: publishedProject.id };
    for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT + 1; index += 1) await publish(inPublished);
    expect(await independentlyPublishedPageIds(getDb(), tenant.vendorId)).toEqual([]);
    // The unpublished project still has all of its free slots.
    for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT; index += 1) await publish(tenant);
    const blocked = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsWithLimit(publishLandingPage(blocked.id, blocked.revision));
  });

  it("counts every unpublished project of the vendor together", async () => {
    const tenant = await createTenant("projects");
    const second = { ...tenant, projectId: (await createProject(tenant.vendorId)).id };
    await publish(tenant);
    await publish(second);
    await publish(tenant);
    const blocked = await createDraftPage(second);
    actAs(second);
    await rejectsWithLimit(publishLandingPage(blocked.id, blocked.revision));
  });

  it("lets concurrent publishes take only the free slots", async () => {
    const tenant = await createTenant("race");
    await publish(tenant);
    await publish(tenant);
    const drafts = await Promise.all([createDraftPage(tenant), createDraftPage(tenant), createDraftPage(tenant), createDraftPage(tenant)]);
    actAs(tenant);
    const results = await Promise.allSettled(drafts.map((page) => publishLandingPage(page.id, page.revision)));
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected.map((result) => (result.reason as Error).message)).toEqual([LIMIT_ERROR, LIMIT_ERROR, LIMIT_ERROR]);
    expect(await independentlyPublishedPageIds(getDb(), tenant.vendorId)).toHaveLength(INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT);
  });

  it("keeps pages published before the limit public and republishable, and gates only new ones", async () => {
    const tenant = await createTenant("legacy");
    const legacy = [];
    for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT + 2; index += 1) legacy.push(await publishedBeforeLimit(tenant));
    for (const page of legacy) expect(await publicLandingPageStatus(`/lp/${page.slug}`)).toBe(200);

    actAs(tenant);
    await expect(publishLandingPage(legacy[4]!.id, legacy[4]!.revision)).resolves.toMatchObject({ version: 2 });
    await expect(getLandingPagePublicationStatus(legacy[0]!.id)).resolves.toMatchObject({ available: true });
    const fresh = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsWithLimit(publishLandingPage(fresh.id, fresh.revision));
    for (const page of legacy) expect(await publicLandingPageStatus(`/lp/${page.slug}`)).toBe(200);
  });

  it("counts each vendor separately", async () => {
    const full = await createTenant("full");
    const other = await createTenant("other");
    for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT; index += 1) await publish(full);
    // The other vendor's slots are untouched by the first vendor's pages ...
    for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT; index += 1) await publish(other);
    expect(await independentlyPublishedPageIds(getDb(), other.vendorId)).toHaveLength(INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT);
    // ... and another vendor's paid plan does not lift this vendor's limit.
    await givePaidPlan(other);
    const blocked = await createDraftPage(full);
    actAs(full);
    await rejectsWithLimit(publishLandingPage(blocked.id, blocked.revision));
    const extra = await createDraftPage(other);
    actAs(other);
    await expect(publishLandingPage(extra.id, extra.revision)).resolves.toMatchObject({ version: 1 });
  });
});
