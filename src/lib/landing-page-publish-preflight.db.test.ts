import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

/**
 * The editor's 發布檢查 is a read-only preflight (Q-05). Before it was the
 * publish transaction rolled back; these PostgreSQL tests prove that:
 *  - for every scenario the check gives the same verdict (pass, or the same
 *    reason code) as the real publish transaction it replaced;
 *  - it takes no vendor lock, opens no transaction and changes no row;
 *  - the real publish still takes the lock and re-validates everything, so a
 *    check that passed earlier never lets an ineligible draft through;
 *  - it only ever reads the current vendor's rows.
 * All data is synthetic.
 */
const mocks = vi.hoisted(() => ({ manager: vi.fn(), scope: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/sales-project-scope", () => ({
  requireEditableSalesProjectScope: mocks.scope,
  getSalesProjectScope: mocks.scope,
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createFunnelFlow } from "@/lib/funnel-flow";
import { createFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { applyFunnelTemplateChange } from "@/lib/funnel-template-transaction";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { INDEPENDENT_AUDIENCE_PUBLISH_DISABLED_ENV, INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT, lockIndependentPublishSlots } from "@/lib/independent-publish-limit";
import { checkLandingPagePublishable, publishLandingPage } from "@/lib/landing-page-service";

type Tenant = { vendorId: string; userId: string; projectId: string };
const vendorIds: string[] = [];
const userIds: string[] = [];

async function createTenant(label: string, options: { projectPublished: boolean; emailVerified?: boolean }): Promise<Tenant> {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Synthetic preflight ${label}`, slug: `preflight-${label}-${suffix}`, email: `preflight-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const user = await db.user.create({ data: {
    name: `Synthetic manager ${label}`, email: `preflight-${suffix}@example.test`, passwordHash: "synthetic-only",
    ...(options.emailVerified === false ? {} : { emailVerifiedAt: new Date() }),
    memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
  } });
  userIds.push(user.id);
  const project = await db.salesProject.create({
    data: {
      vendorId: vendor.id, name: "Synthetic project", slug: `preflight-project-${suffix}`, mode: "live_course", primaryFlow: "live",
      ...(options.projectPublished ? { status: "published", publishedAt: new Date() } : {}),
    },
  });
  return { vendorId: vendor.id, userId: user.id, projectId: project.id };
}

function actAs(tenant: Tenant, role = "owner") {
  mocks.manager.mockResolvedValue({ auth: { user: { id: tenant.userId, emailVerifiedAt: new Date() }, member: { role } }, vendor: { id: tenant.vendorId } });
  mocks.scope.mockResolvedValue({ projectId: tenant.projectId, projectName: "Synthetic project", isAggregate: false, isLegacyWorkspace: false });
}

async function createProduct(tenant: Tenant, options: { inventory?: number } = {}) {
  const db = getDb();
  const product = await db.product.create({ data: {
    vendorId: tenant.vendorId, name: "合成商品", slug: `synthetic-product-${randomUUID()}`, priceCents: 123_400, inventory: options.inventory ?? 20,
    fulfillmentType: "physical", fulfillmentTypeConfirmed: true, isActive: true,
  } });
  await db.salesProjectProduct.create({ data: { vendorId: tenant.vendorId, projectId: tenant.projectId, productId: product.id } });
  return product;
}

/** A draft live: never public, so a page bound to it cannot publish. */
async function createDraftLive(tenant: Tenant) {
  return getDb().live.create({ data: { vendorId: tenant.vendorId, projectId: tenant.projectId, title: "合成直播", slug: `preflight-live-${randomUUID()}`, scheduledAt: new Date(Date.now() + 86_400_000) } });
}

function leaf(id: string, type: FunnelNode["type"]): FunnelNode {
  return { schemaVersion: 1, id, type, props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
}

function salesFunnel(productId?: string): FunnelStepPages {
  const state = createGoalFunnelStepPages({ id: "flow_sale", name: "合成銷售網站", goal: "sell", domain: "synthetic-sale" })!;
  const order = state.pages.order_form!;
  order.root = [{ ...leaf("section_main", "section"), children: [{ ...leaf("row_main", "row"), children: [{ ...leaf("column_main", "columns_2"), children: [leaf("offer_main", "offer_price"), leaf("pay_main", "payment_button")] }] }] }];
  if (productId) order.commerce = { schemaVersion: 1, productId, formMode: "single" };
  return state;
}

function audienceFunnel(): FunnelStepPages {
  const state = createFunnelStepPages(createFunnelFlow({ id: "flow_audience", name: "合成名單網站", goal: "audience", domain: "synthetic" })!)!;
  const first = state.flow.steps.find((step) => !step.isSystem)!;
  const applied = applyFunnelTemplateChange(state.pages[first.id] as PageDocument, { templateId: "audience" });
  return { ...state, pages: { ...state.pages, [first.id]: applied.document } };
}

function customCodeDocument(): PageDocument {
  const document = createEmptyPageDocument("doc-code", "合成自訂頁");
  const code: FunnelNode = { ...leaf("code_main", "raw_html"), props: { html: "<p>合成自訂區塊</p>", css: "p { color: #1d4ed8; }" } };
  document.root = [{ ...leaf("section_code", "section"), children: [{ ...leaf("row_code", "row"), children: [code] }] }];
  return JSON.parse(JSON.stringify(document)) as PageDocument;
}

async function createPage(tenant: Tenant, content: FunnelStepPages | PageDocument, extra: Partial<Prisma.LandingPageUncheckedCreateInput> = {}) {
  return getDb().landingPage.create({
    data: { vendorId: tenant.vendorId, projectId: tenant.projectId, name: "合成網站", slug: `preflight-${randomUUID()}`, draftContent: content as unknown as Prisma.InputJsonValue, ...extra },
  });
}

/** "ok", or the reason code the service refused with. */
async function outcome(run: () => Promise<unknown>) {
  try {
    await run();
    return "ok";
  } catch (error) {
    return error instanceof Error ? error.message || error.name : String(error);
  }
}

/** Everything a publish (or its rollback) could touch for one vendor and page. */
async function snapshot(tenant: Tenant, pageId: string) {
  const db = getDb();
  const [row] = await db.$queryRaw<{ xmin: string }[]>`SELECT xmin::text AS xmin FROM "LandingPage" WHERE id = ${pageId}`;
  const page = await db.landingPage.findUnique({ where: { id: pageId }, select: { status: true, revision: true, publishedVersionId: true, draftFormId: true, updatedAt: true } });
  return {
    pageXmin: row?.xmin,
    page,
    versions: await db.landingPageVersion.count({ where: { vendorId: tenant.vendorId } }),
    forms: await db.registrationForm.count({ where: { vendorId: tenant.vendorId } }),
    audits: await db.auditLog.count({ where: { vendorId: tenant.vendorId } }),
  };
}

beforeEach(() => { vi.clearAllMocks(); });

afterEach(async () => {
  vi.unstubAllEnvs();
  const db = getDb();
  const ids = vendorIds.splice(0);
  await db.auditLog.deleteMany({ where: { vendorId: { in: ids } } });
  await db.landingPage.updateMany({ where: { vendorId: { in: ids } }, data: { status: "draft", publishedVersionId: null } });
  await db.landingPage.deleteMany({ where: { vendorId: { in: ids } } });
  await db.live.deleteMany({ where: { vendorId: { in: ids } } });
  await db.vendor.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

type Scenario = {
  name: string;
  expected: string;
  /** Builds the state and returns the revision to check with. */
  arrange: () => Promise<{ tenant: Tenant; pageId: string; revision: number; actor?: Tenant; role?: string }>;
};

const scenarios: Scenario[] = [
  {
    name: "an audience Funnel of an unpublished project (the lead form would be created)",
    expected: "ok",
    arrange: async () => {
      const tenant = await createTenant("audience", { projectPublished: false });
      const page = await createPage(tenant, audienceFunnel());
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
  {
    name: "an audience Funnel whose auto-created lead form already exists",
    expected: "ok",
    arrange: async () => {
      const tenant = await createTenant("audience-existing", { projectPublished: false });
      actAs(tenant);
      const page = await createPage(tenant, audienceFunnel());
      // The first publish creates the form; publishing again reuses it.
      await publishLandingPage(page.id, page.revision);
      return { tenant, pageId: page.id, revision: page.revision + 1 };
    },
  },
  {
    name: "a sales Funnel bound to this vendor's sellable product",
    expected: "ok",
    arrange: async () => {
      const tenant = await createTenant("sales", { projectPublished: true });
      const product = await createProduct(tenant);
      const page = await createPage(tenant, salesFunnel(product.id));
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
  {
    name: "a stale revision",
    expected: "landing_page_conflict",
    arrange: async () => {
      const tenant = await createTenant("stale", { projectPublished: true });
      const page = await createPage(tenant, customCodeDocument());
      return { tenant, pageId: page.id, revision: page.revision + 1 };
    },
  },
  {
    name: "a product of another vendor",
    expected: "landing_page_commerce_invalid",
    arrange: async () => {
      const tenant = await createTenant("foreign-owner", { projectPublished: true });
      const other = await createTenant("foreign-product", { projectPublished: true });
      const product = await createProduct(other);
      const page = await createPage(tenant, salesFunnel(product.id));
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
  {
    name: "a sold-out product",
    expected: "landing_page_commerce_invalid",
    arrange: async () => {
      const tenant = await createTenant("sold-out", { projectPublished: true });
      const product = await createProduct(tenant, { inventory: 0 });
      const page = await createPage(tenant, salesFunnel(product.id));
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
  {
    name: "a bound registration form that is deactivated",
    expected: "landing_page_form_invalid",
    arrange: async () => {
      const tenant = await createTenant("inactive-form", { projectPublished: true });
      const form = await getDb().registrationForm.create({ data: {
        vendorId: tenant.vendorId, projectId: tenant.projectId, name: "合成表單", slug: `preflight-form-${randomUUID()}`, headline: "合成", fields: [], isActive: false,
      } });
      const page = await createPage(tenant, audienceFunnel(), { draftFormId: form.id });
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
  {
    name: "a bound live that is not public",
    expected: "landing_page_live_invalid",
    arrange: async () => {
      const tenant = await createTenant("live-missing", { projectPublished: true });
      const live = await createDraftLive(tenant);
      const page = await createPage(tenant, audienceFunnel(), { draftLiveId: live.id });
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
  {
    name: "an audience Funnel bound to a live while its project is unpublished",
    expected: "landing_page_audience_live_requires_project",
    arrange: async () => {
      const tenant = await createTenant("live-project", { projectPublished: false });
      const live = await createDraftLive(tenant);
      const page = await createPage(tenant, audienceFunnel(), { draftLiveId: live.id });
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
  {
    name: "an unverified merchant email",
    expected: "landing_page_independent_publish_email_unverified",
    arrange: async () => {
      const tenant = await createTenant("unverified", { projectPublished: false, emailVerified: false });
      const page = await createPage(tenant, audienceFunnel());
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
  {
    name: "the independent publish limit of a free vendor",
    expected: "landing_page_independent_publish_limit",
    arrange: async () => {
      const tenant = await createTenant("limit", { projectPublished: false });
      actAs(tenant);
      for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT; index += 1) {
        const taken = await createPage(tenant, audienceFunnel());
        await publishLandingPage(taken.id, taken.revision);
      }
      const page = await createPage(tenant, audienceFunnel());
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
  {
    name: "custom code published by a member who is not owner or admin",
    expected: "landing_page_custom_code_role",
    arrange: async () => {
      const tenant = await createTenant("role", { projectPublished: true });
      const page = await createPage(tenant, customCodeDocument());
      return { tenant, pageId: page.id, revision: page.revision, role: "support" };
    },
  },
  {
    name: "another vendor's page",
    expected: "landing_page_not_found",
    arrange: async () => {
      const victim = await createTenant("victim", { projectPublished: true });
      const attacker = await createTenant("attacker", { projectPublished: true });
      const page = await createPage(victim, customCodeDocument());
      return { tenant: victim, pageId: page.id, revision: page.revision, actor: attacker };
    },
  },
  {
    name: "an archived page",
    expected: "landing_page_not_found",
    arrange: async () => {
      const tenant = await createTenant("archived", { projectPublished: true });
      const page = await createPage(tenant, customCodeDocument(), { archivedAt: new Date() });
      return { tenant, pageId: page.id, revision: page.revision };
    },
  },
];

describe("read-only publish preflight (PostgreSQL)", () => {
  describe.each(scenarios)("$name", (scenario) => {
    it(`gives the verdict of the real publish transaction (${scenario.expected}) and writes nothing`, async () => {
      const { tenant, pageId, revision, actor, role } = await scenario.arrange();
      actAs(actor ?? tenant, role);
      const before = await snapshot(tenant, pageId);

      const checked = await outcome(() => checkLandingPagePublishable(pageId, revision));
      const afterCheck = await snapshot(tenant, pageId);

      expect(checked).toBe(scenario.expected);
      expect(afterCheck).toEqual(before);

      // The same state through the real publish: identical verdict.
      const published = await outcome(() => publishLandingPage(pageId, revision));
      expect(published).toBe(checked);
      if (published !== "ok") expect(await snapshot(tenant, pageId)).toEqual(before);
    });
  });

  it("gives the same verdict as the real publish while the platform kill switch is on", async () => {
    const tenant = await createTenant("kill-switch", { projectPublished: false });
    actAs(tenant);
    const page = await createPage(tenant, audienceFunnel());
    vi.stubEnv(INDEPENDENT_AUDIENCE_PUBLISH_DISABLED_ENV, "1");
    const before = await snapshot(tenant, page.id);

    await expect(checkLandingPagePublishable(page.id, page.revision)).rejects.toThrow("landing_page_independent_publish_disabled");
    expect(await snapshot(tenant, page.id)).toEqual(before);
    await expect(publishLandingPage(page.id, page.revision)).rejects.toThrow("landing_page_independent_publish_disabled");
  });

  it("never opens a transaction, takes the vendor lock or writes, including the audits a publish would add", async () => {
    const db = getDb();
    const transactionSpy = vi.spyOn(db, "$transaction");
    const executeRawSpy = vi.spyOn(db, "$executeRaw");
    // A custom-code page (publish audit) in an unpublished project with the owner fallback (fallback audit).
    const suffix = randomUUID();
    const vendor = await db.vendor.create({ data: { name: "Synthetic fallback vendor", slug: `preflight-fallback-${suffix}`, email: `preflight-fallback-${suffix}@example.test`, passwordHash: "synthetic-only" } });
    vendorIds.push(vendor.id);
    const owner = await db.user.create({ data: { name: "Synthetic fallback owner", email: `preflight-fallback-owner-${suffix}@example.test`, passwordHash: "synthetic-only", emailVerifiedAt: new Date(), memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
    userIds.push(owner.id);
    const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "Synthetic draft project", slug: `preflight-fallback-project-${suffix}`, mode: "live_course", primaryFlow: "live" } });
    const tenant = { vendorId: vendor.id, userId: owner.id, projectId: project.id };
    actAs(tenant);
    const audience = await createPage(tenant, audienceFunnel());
    const code = await createPage(tenant, customCodeDocument());
    const beforeAudience = await snapshot(tenant, audience.id);
    const beforeCode = await snapshot(tenant, code.id);

    await expect(checkLandingPagePublishable(audience.id, audience.revision)).resolves.toEqual({ id: audience.id, revision: audience.revision });
    await expect(checkLandingPagePublishable(code.id, code.revision)).resolves.toEqual({ id: code.id, revision: code.revision });

    expect(transactionSpy).not.toHaveBeenCalled();
    expect(executeRawSpy).not.toHaveBeenCalled();
    expect(await snapshot(tenant, audience.id)).toEqual(beforeAudience);
    expect(await snapshot(tenant, code.id)).toEqual(beforeCode);

    // The real publish does take a transaction and writes the form and both audits.
    await expect(publishLandingPage(audience.id, audience.revision)).resolves.toMatchObject({ version: 1 });
    await expect(publishLandingPage(code.id, code.revision)).resolves.toMatchObject({ version: 1 });
    expect(transactionSpy).toHaveBeenCalledTimes(2);
    expect(await db.registrationForm.count({ where: { vendorId: vendor.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { vendorId: vendor.id, action: { in: ["independent_publish_email_gate_owner_fallback", "funnel_custom_code_published"] } } })).toBeGreaterThanOrEqual(2);
  });

  it("completes while another transaction holds the vendor's publish lock, which a real publish waits for", async () => {
    const tenant = await createTenant("lock", { projectPublished: false });
    actAs(tenant);
    const page = await createPage(tenant, audienceFunnel());
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
    const holder = getDb().$transaction(async (transaction) => {
      await lockIndependentPublishSlots(transaction, tenant.vendorId);
      locked();
      await held;
    }, { timeout: 60_000 });
    try {
      await lockTaken;
      await expect(checkLandingPagePublishable(page.id, page.revision)).resolves.toEqual({ id: page.id, revision: page.revision });

      const publishing = publishLandingPage(page.id, page.revision);
      const state = await Promise.race([publishing.then(() => "published"), new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 1500))]);
      expect(state).toBe("waiting");
      release();
      await holder;
      await expect(publishing).resolves.toMatchObject({ version: 1 });
    } finally {
      release();
      await holder.catch(() => undefined);
    }
  });

  describe("the real publish re-validates after a check that passed", () => {
    it("refuses when the kill switch is switched on after the check", async () => {
      const tenant = await createTenant("after-switch", { projectPublished: false });
      actAs(tenant);
      const page = await createPage(tenant, audienceFunnel());
      await expect(checkLandingPagePublishable(page.id, page.revision)).resolves.toBeDefined();
      vi.stubEnv(INDEPENDENT_AUDIENCE_PUBLISH_DISABLED_ENV, "true");
      await expect(publishLandingPage(page.id, page.revision)).rejects.toThrow("landing_page_independent_publish_disabled");
      expect((await snapshot(tenant, page.id)).versions).toBe(0);
    });

    it("refuses when the independent publish slots are used up after the check", async () => {
      const tenant = await createTenant("after-limit", { projectPublished: false });
      actAs(tenant);
      const page = await createPage(tenant, audienceFunnel());
      await expect(checkLandingPagePublishable(page.id, page.revision)).resolves.toBeDefined();
      for (let index = 0; index < INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT; index += 1) {
        const taken = await createPage(tenant, audienceFunnel());
        await publishLandingPage(taken.id, taken.revision);
      }
      await expect(publishLandingPage(page.id, page.revision)).rejects.toThrow("landing_page_independent_publish_limit");
      expect(await getDb().landingPageVersion.count({ where: { pageId: page.id } })).toBe(0);
    });

    it("refuses when the bound product is deactivated after the check", async () => {
      const tenant = await createTenant("after-product", { projectPublished: true });
      actAs(tenant);
      const product = await createProduct(tenant);
      const page = await createPage(tenant, salesFunnel(product.id));
      await expect(checkLandingPagePublishable(page.id, page.revision)).resolves.toBeDefined();
      await getDb().product.update({ where: { id: product.id }, data: { isActive: false } });
      await expect(publishLandingPage(page.id, page.revision)).rejects.toThrow("landing_page_commerce_invalid");
      expect(await getDb().landingPageVersion.count({ where: { pageId: page.id } })).toBe(0);
    });

    it("refuses when the draft is saved again after the check", async () => {
      const tenant = await createTenant("after-save", { projectPublished: true });
      actAs(tenant);
      const page = await createPage(tenant, customCodeDocument());
      await expect(checkLandingPagePublishable(page.id, page.revision)).resolves.toBeDefined();
      await getDb().landingPage.update({ where: { id: page.id }, data: { revision: { increment: 1 } } });
      await expect(publishLandingPage(page.id, page.revision)).rejects.toThrow("landing_page_conflict");
    });
  });
});
