import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

/**
 * In-editor publishing and in-place product binding (PostgreSQL). The editor's
 * 發布檢查 is the publish transaction rolled back, and an in-place product
 * binding is stored by the ordinary revision-checked draft save; both must
 * bind the page, the step's product and the result to the current vendor and
 * project. All data is synthetic.
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
import { createFunnelStepPages, parseFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { applyFunnelTemplateChange } from "@/lib/funnel-template-transaction";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import {
  checkLandingPagePublishable,
  LandingPageInputError,
  LandingPageNotFoundError,
  publishLandingPage,
  saveLandingPageDraft,
} from "@/lib/landing-page-service";
import { landingPageAction } from "@/app/actions/landing-page-actions";

type Tenant = { vendorId: string; userId: string; projectId: string };
const vendorIds: string[] = [];
const userIds: string[] = [];

async function createTenant(label: string, options: { projectPublished: boolean }): Promise<Tenant> {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Synthetic editor publish ${label}`, slug: `editor-publish-${label}-${suffix}`, email: `editor-publish-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  // The verified founding account (same email, active owner), as independent publication requires.
  const user = await db.user.create({ data: {
    name: `Synthetic manager ${label}`, email: `editor-publish-${suffix}@example.test`, passwordHash: "synthetic-only", emailVerifiedAt: new Date(),
    memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
  } });
  userIds.push(user.id);
  const project = await db.salesProject.create({
    data: {
      vendorId: vendor.id, name: "Synthetic project", slug: `editor-publish-project-${suffix}`, mode: "live_course", primaryFlow: "live",
      ...(options.projectPublished ? { status: "published", publishedAt: new Date() } : {}),
    },
  });
  return { vendorId: vendor.id, userId: user.id, projectId: project.id };
}

function actAs(tenant: Tenant) {
  mocks.manager.mockResolvedValue({ auth: { user: { id: tenant.userId, emailVerifiedAt: new Date() }, member: { role: "owner" } }, vendor: { id: tenant.vendorId } });
  mocks.scope.mockResolvedValue({ projectId: tenant.projectId, projectName: "Synthetic project", isAggregate: false, isLegacyWorkspace: false });
}

async function createProduct(tenant: Tenant, options: { linked?: boolean; inventory?: number; projectId?: string } = {}) {
  const db = getDb();
  const product = await db.product.create({ data: {
    vendorId: tenant.vendorId, name: "合成商品", slug: `synthetic-product-${randomUUID()}`, priceCents: 123_400, inventory: options.inventory ?? 20,
    fulfillmentType: "physical", fulfillmentTypeConfirmed: true, isActive: true,
  } });
  if (options.linked ?? true) await db.salesProjectProduct.create({ data: { vendorId: tenant.vendorId, projectId: options.projectId ?? tenant.projectId, productId: product.id } });
  return product;
}

function leaf(id: string, type: FunnelNode["type"]): FunnelNode {
  return { schemaVersion: 1, id, type, props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
}

/** A sales Funnel whose order form shows a price and a payment button; `productId` is the page binding. */
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

/** A single page with an owner's custom HTML／CSS block: publishing it writes a custom-code audit entry. */
function customCodeDocument(): PageDocument {
  const document = createEmptyPageDocument("doc-code", "合成自訂頁");
  const code: FunnelNode = { ...leaf("code_main", "raw_html"), props: { html: "<p>合成自訂區塊</p>", css: "p { color: #1d4ed8; }" } };
  document.root = [{ ...leaf("section_code", "section"), children: [{ ...leaf("row_code", "row"), children: [code] }] }];
  return JSON.parse(JSON.stringify(document)) as PageDocument;
}

async function createPage(tenant: Tenant, content: FunnelStepPages | PageDocument, name = "合成網站") {
  return getDb().landingPage.create({
    data: { vendorId: tenant.vendorId, projectId: tenant.projectId, name, slug: `editor-${randomUUID()}`, draftContent: content as unknown as Prisma.InputJsonValue },
  });
}

const stored = (pageId: string) => getDb().landingPage.findUniqueOrThrow({ where: { id: pageId }, select: { status: true, revision: true, publishedVersionId: true, draftFormId: true, draftContent: true } });
const versionCount = (pageId: string) => getDb().landingPageVersion.count({ where: { pageId } });
const boundProduct = async (pageId: string) => parseFunnelStepPages((await stored(pageId)).draftContent)?.pages.order_form?.commerce?.productId;

function actionForm(values: Record<string, string>) {
  const data = new FormData();
  data.set("_csrf", "synthetic");
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => { vi.clearAllMocks(); });

afterEach(async () => {
  const db = getDb();
  const ids = vendorIds.splice(0);
  await db.auditLog.deleteMany({ where: { vendorId: { in: ids } } });
  // Versions RESTRICT their page; clear the publication pointer before the vendor cascade.
  await db.landingPage.updateMany({ where: { vendorId: { in: ids } }, data: { status: "draft", publishedVersionId: null } });
  await db.landingPage.deleteMany({ where: { vendorId: { in: ids } } });
  await db.vendor.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

describe("editor publish check (PostgreSQL)", () => {
  it("runs the whole publish transaction and commits nothing: no version, no revision, no auto-created lead form", async () => {
    const tenant = await createTenant("check", { projectPublished: false });
    actAs(tenant);
    const page = await createPage(tenant, audienceFunnel());
    const autoForms = () => getDb().registrationForm.count({ where: { vendorId: tenant.vendorId, slug: { startsWith: `lead-auto-${page.id.toLowerCase()}` } } });

    await expect(checkLandingPagePublishable(page.id, page.revision)).resolves.toEqual({ id: page.id, revision: page.revision });

    expect(await versionCount(page.id)).toBe(0);
    expect(await stored(page.id)).toMatchObject({ status: "draft", revision: page.revision, publishedVersionId: null, draftFormId: null });
    expect(await autoForms()).toBe(0);
    // The check repeats without side effects, and the real publish then does what the check rehearsed.
    await expect(checkLandingPagePublishable(page.id, page.revision)).resolves.toEqual({ id: page.id, revision: page.revision });
    await expect(publishLandingPage(page.id, page.revision)).resolves.toMatchObject({ revision: page.revision + 1, version: 1 });
    expect(await versionCount(page.id)).toBe(1);
    expect(await autoForms()).toBe(1);
  });

  it("rolls back the custom-code publish audit, which the real publish then writes", async () => {
    const tenant = await createTenant("audit", { projectPublished: true });
    actAs(tenant);
    // Written directly: the editor's save would add its own save audit entry.
    const page = await createPage(tenant, customCodeDocument());
    const audits = () => getDb().auditLog.count({ where: { vendorId: tenant.vendorId, targetId: page.id } });

    await expect(checkLandingPagePublishable(page.id, page.revision)).resolves.toEqual({ id: page.id, revision: page.revision });
    expect(await audits()).toBe(0);
    expect(await versionCount(page.id)).toBe(0);
    await expect(publishLandingPage(page.id, page.revision)).resolves.toMatchObject({ version: 1 });
    expect(await audits()).toBe(1);
    expect(await getDb().auditLog.findFirst({ where: { vendorId: tenant.vendorId, targetId: page.id } })).toMatchObject({ action: "funnel_custom_code_published", actorId: tenant.userId });
  });

  it("rolls back the owner-fallback audit of an independent publication, which the real publish then writes", async () => {
    const db = getDb();
    const suffix = randomUUID();
    // No founding account (no user with the vendor's email): an active verified owner decides, and that pass is audited.
    const vendor = await db.vendor.create({ data: { name: "Synthetic fallback vendor", slug: `editor-fallback-${suffix}`, email: `editor-fallback-${suffix}@example.test`, passwordHash: "synthetic-only" } });
    vendorIds.push(vendor.id);
    const owner = await db.user.create({ data: { name: "Synthetic fallback owner", email: `editor-fallback-owner-${suffix}@example.test`, passwordHash: "synthetic-only", emailVerifiedAt: new Date(), memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
    userIds.push(owner.id);
    const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "Synthetic draft project", slug: `editor-fallback-project-${suffix}`, mode: "live_course", primaryFlow: "live" } });
    const tenant = { vendorId: vendor.id, userId: owner.id, projectId: project.id };
    actAs(tenant);
    const page = await createPage(tenant, audienceFunnel());
    const fallbackAudits = () => db.auditLog.count({ where: { vendorId: vendor.id, targetId: page.id, action: "independent_publish_email_gate_owner_fallback" } });

    await expect(checkLandingPagePublishable(page.id, page.revision)).resolves.toEqual({ id: page.id, revision: page.revision });
    expect(await fallbackAudits()).toBe(0);
    await expect(publishLandingPage(page.id, page.revision)).resolves.toMatchObject({ version: 1 });
    expect(await fallbackAudits()).toBe(1);
    expect(await db.auditLog.findFirst({ where: { vendorId: vendor.id, targetId: page.id, action: "independent_publish_email_gate_owner_fallback" } })).toMatchObject({ after: { reason: "no_founder_account" } });
  });

  it("refuses a stale revision and a binding that is not this vendor's sellable product, writing nothing", async () => {
    const owner = await createTenant("owner", { projectPublished: true });
    const other = await createTenant("other", { projectPublished: true });
    const foreignProduct = await createProduct(other);
    actAs(owner);
    // Written directly: the editor's save would already refuse this binding.
    const page = await createPage(owner, salesFunnel(foreignProduct.id));

    await expect(checkLandingPagePublishable(page.id, page.revision + 1)).rejects.toThrow("landing_page_conflict");
    await expect(checkLandingPagePublishable(page.id, page.revision)).rejects.toThrow("landing_page_commerce_invalid");
    await expect(publishLandingPage(page.id, page.revision)).rejects.toThrow("landing_page_commerce_invalid");
    const check = await landingPageAction({ status: "success", message: "" }, actionForm({ operation: "check_publish", id: page.id, revision: String(page.revision) }));
    expect(check).toMatchObject({ status: "error", code: "landing_page_commerce_invalid" });

    expect(await versionCount(page.id)).toBe(0);
    expect(await stored(page.id)).toMatchObject({ status: "draft", revision: page.revision, publishedVersionId: null });
  });

  it("never checks or publishes another tenant's page", async () => {
    const owner = await createTenant("victim", { projectPublished: true });
    const attacker = await createTenant("attacker", { projectPublished: true });
    actAs(owner);
    const product = await createProduct(owner);
    const page = await createPage(owner, salesFunnel(product.id));

    actAs(attacker);
    await expect(checkLandingPagePublishable(page.id, page.revision)).rejects.toBeInstanceOf(LandingPageNotFoundError);
    await expect(publishLandingPage(page.id, page.revision)).rejects.toBeInstanceOf(LandingPageNotFoundError);
    const check = await landingPageAction({ status: "success", message: "" }, actionForm({ operation: "check_publish", id: page.id, revision: String(page.revision) }));
    expect(check).toMatchObject({ status: "error", code: "landing_page_not_found" });
    expect(check.publication).toBeUndefined();

    expect(await versionCount(page.id)).toBe(0);
    expect(await stored(page.id)).toMatchObject({ status: "draft", revision: page.revision });
  });
});

describe("in-place product binding (PostgreSQL)", () => {
  it("stores this vendor's sellable product for the order step and publishes it", async () => {
    const tenant = await createTenant("bind", { projectPublished: true });
    actAs(tenant);
    const product = await createProduct(tenant);
    const page = await createPage(tenant, salesFunnel());

    await expect(saveLandingPageDraft({ id: page.id, revision: page.revision, name: "合成網站", slug: page.slug, content: salesFunnel(product.id) })).resolves.toEqual({ id: page.id, revision: page.revision + 1 });
    expect(await boundProduct(page.id)).toBe(product.id);
    await expect(checkLandingPagePublishable(page.id, page.revision + 1)).resolves.toEqual({ id: page.id, revision: page.revision + 1 });
    await expect(publishLandingPage(page.id, page.revision + 1)).resolves.toMatchObject({ version: 1 });
  });

  it("refuses another vendor's product, a product of another project and an unsellable product, keeping the stored draft", async () => {
    const owner = await createTenant("binder", { projectPublished: true });
    const other = await createTenant("foreign", { projectPublished: true });
    const foreignProduct = await createProduct(other);
    actAs(owner);
    const otherProject = await getDb().salesProject.create({ data: { vendorId: owner.vendorId, name: "Other project", slug: `other-project-${randomUUID()}`, mode: "live_course", primaryFlow: "live" } });
    const otherProjectProduct = await createProduct(owner, { projectId: otherProject.id });
    const soldOut = await createProduct(owner, { inventory: 0 });
    const page = await createPage(owner, salesFunnel());

    for (const productId of [foreignProduct.id, otherProjectProduct.id, soldOut.id]) {
      await expect(saveLandingPageDraft({ id: page.id, revision: page.revision, name: "合成網站", slug: page.slug, content: salesFunnel(productId) })).rejects.toThrow("landing_page_commerce_invalid");
    }
    // The page action the editor (autosave or 儲存) calls returns the reason code for the same refusal.
    const result = await landingPageAction({ status: "success", message: "" }, actionForm({
      operation: "save", id: page.id, revision: String(page.revision), name: "合成網站", slug: page.slug, content: JSON.stringify(salesFunnel(foreignProduct.id)),
    }));
    expect(result).toMatchObject({ status: "error", code: "landing_page_commerce_invalid" });

    expect(await stored(page.id)).toMatchObject({ revision: page.revision });
    expect(await boundProduct(page.id)).toBeUndefined();
  });

  it("cannot bind a product into another tenant's page", async () => {
    const owner = await createTenant("page-owner", { projectPublished: true });
    const attacker = await createTenant("page-attacker", { projectPublished: true });
    const page = await createPage(owner, salesFunnel());
    actAs(attacker);
    const attackerProduct = await createProduct(attacker);

    await expect(saveLandingPageDraft({ id: page.id, revision: page.revision, name: "合成網站", slug: page.slug, content: salesFunnel(attackerProduct.id) })).rejects.toBeInstanceOf(LandingPageNotFoundError);
    expect(await stored(page.id)).toMatchObject({ revision: page.revision });
    expect(await boundProduct(page.id)).toBeUndefined();
  });

  it("rejects a malformed binding before any product lookup", async () => {
    const tenant = await createTenant("malformed", { projectPublished: true });
    actAs(tenant);
    const page = await createPage(tenant, salesFunnel());
    const content = salesFunnel() as unknown as { pages: Record<string, Record<string, unknown>> };
    // A client-supplied price is not part of the binding contract.
    content.pages.order_form!.commerce = { schemaVersion: 1, productId: "anything", formMode: "single", priceCents: 1 };
    await expect(saveLandingPageDraft({ id: page.id, revision: page.revision, name: "合成網站", slug: page.slug, content })).rejects.toBeInstanceOf(LandingPageInputError);
    expect(await stored(page.id)).toMatchObject({ revision: page.revision });
  });
});
