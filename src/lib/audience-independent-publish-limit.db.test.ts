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

/** The manager is the vendor's founding account (same email); verified unless `emailVerified` is false. */
async function createTenant(label: string, { emailVerified = true } = {}): Promise<Tenant> {
  const db = getDb();
  const suffix = randomUUID();
  const email = `limit-${suffix}@example.test`;
  const vendor = await db.vendor.create({
    data: { name: `Synthetic limit ${label}`, slug: `limit-${label}-${suffix}`, email, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const user = await db.user.create({ data: {
    name: `Synthetic manager ${label}`, email, passwordHash: "synthetic-only", emailVerifiedAt: emailVerified ? new Date() : null,
    memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
  } });
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
  await db.auditLog.deleteMany({ where: { vendorId: { in: ids }, action: "independent_publish_email_gate_owner_fallback" } });
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

  it("keeps limiting a vendor whose only plans are free, pending payment or ended", async () => {
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

  it("does not treat many published audience pages with payment elements as using the free slots", async () => {
    const tenant = await createTenant("payment-elements");
    const db = getDb();
    const content = audienceContent();
    const row = content.pages.opt_in.root[0]!.children![0]!;
    row.children = [...(row.children ?? []), { schemaVersion: 1, id: "pay_button", type: "payment_button", props: { label: "立即付款" }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} }];
    // More than one scan batch of pages that pass the SQL pre-filter but are not public (payment element).
    for (let index = 0; index < 30; index += 1) {
      const page = await db.landingPage.create({ data: { vendorId: tenant.vendorId, projectId: tenant.projectId, name: "含付款元件", slug: `lim-pay-${randomUUID()}`, draftContent: content as unknown as Prisma.InputJsonValue } });
      const version = await db.landingPageVersion.create({ data: { vendorId: tenant.vendorId, pageId: page.id, version: 1, content: content as unknown as Prisma.InputJsonValue } });
      await db.landingPage.update({ where: { id: page.id }, data: { status: "published", publishedVersionId: version.id, publishedAt: new Date() } });
    }
    expect(await independentlyPublishedPageIds(db, tenant.vendorId)).toEqual([]);
    await publish(tenant);
    await publish(tenant);
    const third = await createDraftPage(tenant);
    actAs(tenant);
    await expect(getLandingPagePublicationStatus(third.id)).resolves.toMatchObject({ message: expect.stringContaining("目前已使用 2 個") });
    await expect(publishLandingPage(third.id, third.revision)).resolves.toMatchObject({ version: 1 });
    const fourth = await createDraftPage(tenant);
    actAs(tenant);
    await expect(getLandingPagePublicationStatus(fourth.id)).resolves.toMatchObject({ message: expect.stringContaining("目前已有 3 個") });
    await rejectsWithLimit(publishLandingPage(fourth.id, fourth.revision));
  });

  it("pauses every new independent publish with the platform kill switch, leaving public pages untouched", async () => {
    const tenant = await createTenant("kill-switch");
    await givePaidPlan(tenant);
    const existing = await publish(tenant);
    vi.stubEnv("INDEPENDENT_AUDIENCE_PUBLISH_DISABLED", "1");
    try {
      const fresh = await createDraftPage(tenant);
      actAs(tenant);
      const status = await getLandingPagePublicationStatus(fresh.id);
      expect(status.message).toContain("平台目前暫停「不需發布專案就公開」的名單型網站新發布");
      const error = await publishLandingPage(fresh.id, fresh.revision).then(() => null, (reason: unknown) => reason);
      expect((error as Error).message).toBe("landing_page_independent_publish_disabled");
      expect(await getDb().landingPage.findUniqueOrThrow({ where: { id: fresh.id } })).toMatchObject({ status: "draft", publishedVersionId: null });

      // Already public: keeps opening and can be republished.
      expect(await publicLandingPageStatus(`/lp/${existing.slug}`)).toBe(200);
      await expect(publishLandingPage(existing.id, existing.revision)).resolves.toMatchObject({ version: 2 });

      // Inside a published project nothing is independent, so nothing is paused.
      const publishedProject = await createProject(tenant.vendorId, true);
      const inProject = await publish({ ...tenant, projectId: publishedProject.id });
      expect(await getDb().landingPage.findUniqueOrThrow({ where: { id: inProject.id } })).toMatchObject({ status: "published" });
    } finally {
      vi.unstubAllEnvs();
    }
    const after = await createDraftPage(tenant);
    actAs(tenant);
    await expect(publishLandingPage(after.id, after.revision)).resolves.toMatchObject({ version: 1 });
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

describe("merchant email verification gate on independent publication (PostgreSQL)", () => {
  const UNVERIFIED_ERROR = "landing_page_independent_publish_email_unverified";

  async function rejectsUnverified(promise: Promise<unknown>) {
    const error = await promise.then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(LandingPageInputError);
    expect((error as Error).message).toBe(UNVERIFIED_ERROR);
  }

  function verifyFounder(tenant: Tenant) {
    return getDb().user.update({ where: { id: tenant.userId }, data: { emailVerifiedAt: new Date() } });
  }

  it("gives an unverified vendor no independent publish, explains why, and applies the normal limit once verified", async () => {
    const tenant = await createTenant("unverified", { emailVerified: false });
    const page = await createDraftPage(tenant);
    actAs(tenant);
    const status = await getLandingPagePublicationStatus(page.id);
    expect(status.available).toBe(false);
    expect(status.message).toContain("註冊 Email 還沒有完成驗證");
    expect(status.missing.map((link) => link.href)).toEqual(["/verify-email", `/projects/${tenant.projectId}`]);

    await rejectsUnverified(publishLandingPage(page.id, page.revision));
    // Nothing was written by the refused transaction.
    expect(await getDb().landingPage.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({ status: "draft", publishedVersionId: null, draftFormId: null, revision: page.revision });
    expect(await getDb().landingPageVersion.count({ where: { pageId: page.id } })).toBe(0);
    expect(await getDb().registrationForm.count({ where: { vendorId: tenant.vendorId } })).toBe(0);
    expect(await publicLandingPageStatus(`/lp/${page.slug}`)).toBe(404);

    await verifyFounder(tenant);
    await expect(publishLandingPage(page.id, page.revision)).resolves.toMatchObject({ version: 1 });
    await publish(tenant);
    await publish(tenant);
    const fourth = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsWithLimit(publishLandingPage(fourth.id, fourth.revision));
  });

  it("also applies to a vendor with a paid plan", async () => {
    const tenant = await createTenant("unverified-paid", { emailVerified: false });
    await givePaidPlan(tenant);
    const page = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsUnverified(publishLandingPage(page.id, page.revision));
  });

  it("keeps already public pages of an unverified (legacy) vendor public and republishable, and leaves published projects alone", async () => {
    const tenant = await createTenant("unverified-legacy", { emailVerified: false });
    const legacy = await publishedBeforeLimit(tenant);
    expect(await publicLandingPageStatus(`/lp/${legacy.slug}`)).toBe(200);
    actAs(tenant);
    await expect(publishLandingPage(legacy.id, legacy.revision)).resolves.toMatchObject({ version: 2 });
    expect(await publicLandingPageStatus(`/lp/${legacy.slug}`)).toBe(200);

    const fresh = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsUnverified(publishLandingPage(fresh.id, fresh.revision));

    // Pages inside a published project never use independent publication.
    const publishedProject = await createProject(tenant.vendorId, true);
    const inProject = await publish({ ...tenant, projectId: publishedProject.id });
    expect(await getDb().landingPage.findUniqueOrThrow({ where: { id: inProject.id } })).toMatchObject({ status: "published" });
  });

  it("is decided by the founding account, so a verified co-owner cannot lift it", async () => {
    const tenant = await createTenant("co-owner", { emailVerified: false });
    const db = getDb();
    const coOwner = await db.user.create({ data: {
      name: "Synthetic verified co-owner", email: `limit-co-owner-${randomUUID()}@example.test`, passwordHash: "synthetic-only", emailVerifiedAt: new Date(),
      memberships: { create: { vendorId: tenant.vendorId, role: "owner", status: "active" } },
    } });
    userIds.push(coOwner.id);
    const page = await createDraftPage(tenant);
    actAs({ ...tenant, userId: coOwner.id });
    await rejectsUnverified(publishLandingPage(page.id, page.revision));
    // A founder who left the vendor no longer decides: any active verified owner does
    // (documented fallback; deactivating an owner needs step-up MFA).
    await db.vendorMember.updateMany({ where: { vendorId: tenant.vendorId, userId: tenant.userId }, data: { status: "inactive" } });
    const published = await publishLandingPage(page.id, page.revision);
    expect(published).toMatchObject({ version: 1 });
    // The pass through the fallback is audited with ids and a reason code only.
    const audits = await db.auditLog.findMany({ where: { vendorId: tenant.vendorId, action: "independent_publish_email_gate_owner_fallback" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ targetType: "LandingPage", targetId: page.id, actorLabel: "system", after: { reason: "founder_left_vendor" } });
    expect(JSON.stringify(audits[0])).not.toContain("@");
    // Republishing a page that already holds its slot is not a new pass.
    await publishLandingPage(page.id, published.revision);
    expect(await db.auditLog.count({ where: { vendorId: tenant.vendorId, action: "independent_publish_email_gate_owner_fallback" } })).toBe(1);
  });

  it("does not let one vendor's verified founder verify another vendor", async () => {
    const verified = await createTenant("verified-a");
    const unverified = await createTenant("unverified-b", { emailVerified: false });
    // The verified founder is also an owner of the second vendor.
    await getDb().vendorMember.create({ data: { vendorId: unverified.vendorId, userId: verified.userId, role: "owner", status: "active" } });
    await publish(verified);
    const page = await createDraftPage(unverified);
    actAs({ ...unverified, userId: verified.userId });
    await rejectsUnverified(publishLandingPage(page.id, page.revision));
  });

  it("falls back to an active verified owner for a vendor without an active founding account", async () => {
    const db = getDb();
    const suffix = randomUUID();
    const vendor = await db.vendor.create({ data: { name: "Synthetic fixture vendor", slug: `limit-fixture-${suffix}`, email: `limit-fixture-${suffix}@example.test`, passwordHash: "synthetic-only" } });
    vendorIds.push(vendor.id);
    const owner = await db.user.create({ data: { name: "Synthetic fixture owner", email: `limit-fixture-owner-${suffix}@example.test`, passwordHash: "synthetic-only", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
    userIds.push(owner.id);
    const tenant = { vendorId: vendor.id, userId: owner.id, projectId: (await createProject(vendor.id)).id };
    const page = await createDraftPage(tenant);
    actAs(tenant);
    await rejectsUnverified(publishLandingPage(page.id, page.revision));
    await db.user.update({ where: { id: owner.id }, data: { emailVerifiedAt: new Date() } });
    await expect(publishLandingPage(page.id, page.revision)).resolves.toMatchObject({ version: 1 });
    expect(await db.auditLog.findFirst({ where: { vendorId: vendor.id, action: "independent_publish_email_gate_owner_fallback" } })).toMatchObject({ after: { reason: "no_founder_account" } });
  });

  it("does not audit a publish decided by a verified founding account", async () => {
    const tenant = await createTenant("founder-pass");
    await publish(tenant);
    expect(await getDb().auditLog.count({ where: { vendorId: tenant.vendorId, action: "independent_publish_email_gate_owner_fallback" } })).toBe(0);
  });
});
