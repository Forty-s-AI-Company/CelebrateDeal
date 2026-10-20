import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";

const mocks = vi.hoisted(() => ({ manager: vi.fn(), scope: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/sales-project-scope", () => ({
  requireEditableSalesProjectScope: mocks.scope,
  getSalesProjectScope: mocks.scope,
}));

import {
  deleteLandingPage,
  getLandingPageForEditor,
  LandingPageNotFoundError,
  listLandingPages,
} from "./landing-page-service";

type Tenant = { vendorId: string; userId: string; projectId: string };
const vendorIds: string[] = [];
const userIds: string[] = [];

async function createTenant(label: string): Promise<Tenant> {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Synthetic funnel ${label}`, slug: `funnel-${label}-${suffix}`, email: `funnel-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const user = await db.user.create({
    data: { name: `Synthetic manager ${label}`, email: `manager-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  userIds.push(user.id);
  const project = await db.salesProject.create({
    data: { vendorId: vendor.id, name: "Synthetic project", slug: `project-${suffix}`, mode: "live_course", primaryFlow: "live" },
  });
  return { vendorId: vendor.id, userId: user.id, projectId: project.id };
}

function actAs(tenant: Tenant) {
  mocks.manager.mockResolvedValue({ auth: { user: { id: tenant.userId } }, vendor: { id: tenant.vendorId } });
  mocks.scope.mockResolvedValue({ projectId: tenant.projectId, projectName: "Synthetic project", isAggregate: false, isLegacyWorkspace: false });
}

async function createPage(tenant: Tenant, options: { published?: boolean } = {}) {
  const db = getDb();
  const page = await db.landingPage.create({
    data: { vendorId: tenant.vendorId, projectId: tenant.projectId, name: "Synthetic funnel", slug: `lp-${randomUUID()}`, draftContent: { synthetic: true } },
  });
  if (!options.published) return page;
  const version = await db.landingPageVersion.create({
    data: { vendorId: tenant.vendorId, pageId: page.id, version: 1, content: { synthetic: true } },
  });
  return db.landingPage.update({
    where: { id: page.id },
    data: { status: "published", publishedVersionId: version.id, publishedAt: new Date(), revision: { increment: 1 } },
  });
}

async function addVisit(tenant: Tenant, pageId: string) {
  return getDb().funnelVisit.create({
    data: { vendorId: tenant.vendorId, pageId, stepId: "opt_in", logicalStepId: "opt_in", visitorId: `visitor-${randomUUID()}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  const db = getDb();
  // Vendor deletion must still cascade through pages that keep funnel rows.
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

describe("deleteLandingPage archive boundary (PostgreSQL)", () => {
  it("permanently deletes a never-published page without traffic", async () => {
    const tenant = await createTenant("draft");
    actAs(tenant);
    const page = await createPage(tenant);

    await expect(deleteLandingPage(page.id, page.revision)).resolves.toEqual({ id: page.id, archived: false });
    expect(await getDb().landingPage.findUnique({ where: { id: page.id } })).toBeNull();
  });

  it("archives a page with traffic, keeps the visit and hides it from the editor", async () => {
    const tenant = await createTenant("traffic");
    actAs(tenant);
    const page = await createPage(tenant);
    const visit = await addVisit(tenant, page.id);

    await expect(deleteLandingPage(page.id, page.revision)).resolves.toEqual({ id: page.id, archived: true });

    const stored = await getDb().landingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored.archivedAt).toBeInstanceOf(Date);
    expect(stored).toMatchObject({ status: "draft", publishedVersionId: null, revision: page.revision + 1 });
    expect(await getDb().funnelVisit.findUnique({ where: { id: visit.id } })).not.toBeNull();
    await expect(getLandingPageForEditor(page.id)).rejects.toBeInstanceOf(LandingPageNotFoundError);
    expect((await listLandingPages()).pages.map((row) => row.id)).not.toContain(page.id);
    // A second delete of an archived page is a not-found, not a hard delete.
    await expect(deleteLandingPage(page.id, stored.revision)).rejects.toBeInstanceOf(LandingPageNotFoundError);
  });

  it("archives and unpublishes a published page and keeps its versions", async () => {
    const tenant = await createTenant("published");
    actAs(tenant);
    const page = await createPage(tenant, { published: true });

    await expect(deleteLandingPage(page.id, page.revision)).resolves.toEqual({ id: page.id, archived: true });

    const stored = await getDb().landingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored).toMatchObject({ status: "draft", publishedVersionId: null });
    expect(stored.archivedAt).toBeInstanceOf(Date);
    expect(stored.unpublishedAt).toBeInstanceOf(Date);
    expect(await getDb().landingPageVersion.count({ where: { pageId: page.id } })).toBe(1);
  });

  it("cannot archive or delete another tenant's page", async () => {
    const owner = await createTenant("owner");
    const attacker = await createTenant("attacker");
    const page = await createPage(owner, { published: true });
    await addVisit(owner, page.id);

    actAs(attacker);
    await expect(deleteLandingPage(page.id, page.revision)).rejects.toBeInstanceOf(LandingPageNotFoundError);

    const stored = await getDb().landingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored).toMatchObject({ status: "published", archivedAt: null, revision: page.revision });
  });
});

describe("funnel history database guards", () => {
  it("refuses to delete a page that still has funnel visits", async () => {
    const tenant = await createTenant("restrict");
    const page = await createPage(tenant);
    await addVisit(tenant, page.id);

    await expect(getDb().landingPage.delete({ where: { id: page.id } })).rejects.toMatchObject({ code: "P2003" });
    expect(await getDb().funnelVisit.count({ where: { pageId: page.id } })).toBe(1);
  });

  it("rejects an archived page that is still published", async () => {
    const tenant = await createTenant("check");
    const page = await createPage(tenant, { published: true });

    await expect(getDb().landingPage.update({ where: { id: page.id }, data: { archivedAt: new Date() } }))
      .rejects.toThrow(/LandingPage_archived_unpublished_check/);
  });
});
