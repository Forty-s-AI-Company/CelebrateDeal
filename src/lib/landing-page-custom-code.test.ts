import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  manager: vi.fn(), editableScope: vi.fn(),
  create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(),
  versionCreate: vi.fn(), versionCount: vi.fn(), versionFindFirst: vi.fn(), formFindMany: vi.fn(),
  transaction: vi.fn(), auditCreate: vi.fn(), validateCommerce: vi.fn(), publicCommerce: vi.fn(),
}));

const database = {
  landingPage: { create: mocks.create, findFirst: mocks.findFirst, findMany: mocks.findMany, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany },
  landingPageVersion: { create: mocks.versionCreate, count: mocks.versionCount, findFirst: mocks.versionFindFirst },
  funnelVisit: { count: vi.fn(async () => 0) },
  funnelSubmission: { count: vi.fn(async () => 0) },
  registrationForm: { findMany: mocks.formFindMany, findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
  live: { findFirst: vi.fn(), findMany: vi.fn(async () => []), count: vi.fn() },
  consultationEvent: { findMany: vi.fn(async () => []) },
  salesProject: { findFirst: vi.fn(async () => ({ status: "published", publishedAt: new Date("2026-09-01T00:00:00.000Z") })) },
  vendor: { findUnique: vi.fn(async () => ({ email: "owner@example.test", betaFeatureGrants: [] })) },
  user: { findFirst: vi.fn(async () => ({ id: "user-1", email: "owner@example.test", emailVerifiedAt: new Date("2026-09-01T00:00:00.000Z") })) },
  vendorMember: { findFirst: vi.fn() },
  auditLog: { create: mocks.auditCreate },
  $executeRaw: vi.fn(),
};

vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: mocks.editableScope, getSalesProjectScope: mocks.editableScope }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ ...database, $transaction: mocks.transaction }) }));
vi.mock("@/lib/funnel-commerce-service", () => ({ listFunnelCommerceProducts: vi.fn(async () => []), publicFunnelCommerceViews: mocks.publicCommerce, validateFunnelCommerceBindings: mocks.validateCommerce }));

import {
  createLandingPage, deleteLandingPage, duplicateLandingPage, LandingPageInputError, loadPublicLandingPage,
  publishLandingPage, rollbackLandingPage, saveLandingPageDraft, saveLandingPageStepMetadata,
} from "./landing-page-service";
import { createFunnelFlow } from "./funnel-flow";
import { createFunnelStepPages, type FunnelStepPages } from "./funnel-step-pages";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "./funnel-page-document";

const now = new Date("2026-10-27T00:00:00.000Z");

function codeNode(id: string, props: Record<string, unknown>): FunnelNode {
  return { schemaVersion: 1, id, type: "raw_html", props, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
}

function document(nodes: FunnelNode[], customCss?: string): PageDocument {
  const value = createEmptyPageDocument("doc-1");
  value.root = [{
    schemaVersion: 1, id: "section", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {},
    children: [{ schemaVersion: 1, id: "row", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: nodes }],
  }];
  if (customCss !== undefined) value.settings.customCss = customCss;
  return JSON.parse(JSON.stringify(value)) as PageDocument;
}

const plain = document([]);
const withJs = document([codeNode("code", { html: "<p>hi</p>", js: "document.body.dataset.ok = '1';" })]);
const withCss = document([], "body{background:#fff}");

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1", vendorId: "vendor-1", projectId: "project-1", name: "自訂頁", slug: "custom-page",
    draftContent: plain, draftFormId: null, draftLiveId: null, operations: null, status: "draft", publishedVersionId: null,
    revision: 2, publishedAt: null, updatedAt: now, project: { status: "published", publishedAt: now }, ...overrides,
  };
}

function actor(role: string | null, verified = true) {
  return {
    auth: { user: { id: `user-${role ?? "none"}`, emailVerifiedAt: verified ? now : null }, member: role ? { role, status: "active" } : undefined },
    vendor: { id: "vendor-1", betaFeatureGrants: [] },
  };
}

const draft = (content: unknown) => ({ id: "page-1", revision: 2, name: "自訂頁", slug: "custom-page", content });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manager.mockResolvedValue(actor("owner"));
  mocks.editableScope.mockResolvedValue({ projectId: "project-1", projectName: "專案", isAggregate: false, isLegacyWorkspace: false });
  mocks.formFindMany.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(page());
  mocks.findMany.mockResolvedValue([]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.create.mockResolvedValue(page({ id: "page-new" }));
  mocks.versionCount.mockResolvedValue(0);
  mocks.versionCreate.mockResolvedValue({ id: "version-1", version: 1, content: withJs, formId: null, liveId: null, createdAt: now });
  mocks.validateCommerce.mockResolvedValue(undefined);
  mocks.publicCommerce.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: (value: typeof database) => Promise<unknown>) => callback(database));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function inputError(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(LandingPageInputError);
  return (error as Error).message;
}

describe("custom code on every draft write path", () => {
  it("saves new JS for a verified owner and writes the audit entry in the same transaction", async () => {
    await expect(saveLandingPageDraft(draft(withJs))).resolves.toEqual({ id: "page-1", revision: 3 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 2 } }));
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      vendorId: "vendor-1", actorId: "user-owner", action: "funnel_custom_code_saved", targetType: "LandingPage", targetId: "page-1",
      after: { operation: "save", changes: [{ location: "page/node:code", kind: "node", change: "added", fields: ["html", "js"], bytes: { html: 9, css: 0, js: 31 } }] },
    }) });
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain("dataset");
  });

  it("refuses JS from an unverified e-mail without writing", async () => {
    mocks.manager.mockResolvedValue(actor("owner", false));
    expect(await inputError(saveLandingPageDraft(draft(withJs)))).toBe("landing_page_custom_code_email_unverified");
    expect(await inputError(createLandingPage({ name: "x", slug: "x-page", content: withJs }))).toBe("landing_page_custom_code_email_unverified");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("refuses custom code and page CSS changes from roles other than owner or admin", async () => {
    for (const role of ["support", "accountant", null]) {
      mocks.manager.mockResolvedValue(actor(role));
      expect(await inputError(saveLandingPageDraft(draft(withCss)))).toBe("landing_page_custom_code_role");
      mocks.findFirst.mockResolvedValueOnce(page({ draftContent: withJs }));
      expect(await inputError(saveLandingPageDraft(draft(plain)))).toBe("landing_page_custom_code_role");
    }
    expect(mocks.updateMany).not.toHaveBeenCalled();
    // An admin may.
    mocks.manager.mockResolvedValue(actor("admin"));
    await expect(saveLandingPageDraft(draft(withCss))).resolves.toEqual({ id: "page-1", revision: 3 });
  });

  it("keeps a plain save outside any transaction and without audit", async () => {
    mocks.manager.mockResolvedValue(actor("support", false));
    await expect(saveLandingPageDraft(draft(plain))).resolves.toEqual({ id: "page-1", revision: 3 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("refuses new JS while the emergency switch is on", async () => {
    vi.stubEnv("FUNNEL_CUSTOM_CODE_DISABLED", "1");
    expect(await inputError(saveLandingPageDraft(draft(withJs)))).toBe("landing_page_custom_code_disabled");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("applies the same rules when duplicating a page that carries JS, and audits the copy", async () => {
    // The copy-slug probe looks up the slug alone; that slug is free.
    mocks.findFirst.mockImplementation(async ({ where }: { where: { slug?: string } }) => where.slug ? null : page({ draftContent: withJs }));
    mocks.manager.mockResolvedValue(actor("admin", false));
    expect(await inputError(duplicateLandingPage("page-1"))).toBe("landing_page_custom_code_email_unverified");
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.manager.mockResolvedValue(actor("admin"));
    await duplicateLandingPage("page-1");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "vendor-1", projectId: "project-1" }) }));
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "funnel_custom_code_saved", targetId: "page-new", after: expect.objectContaining({ operation: "duplicate" }) }) });
  });

  it("applies the same rules when rolling back to a version with JS", async () => {
    mocks.versionFindFirst.mockResolvedValue({ id: "version-1", version: 1, content: withJs, formId: null, liveId: null, createdAt: now });
    mocks.manager.mockResolvedValue(actor("owner", false));
    expect(await inputError(rollbackLandingPage("page-1", 1, 2))).toBe("landing_page_custom_code_email_unverified");
    mocks.manager.mockResolvedValue(actor("support"));
    expect(await inputError(rollbackLandingPage("page-1", 1, 2))).toBe("landing_page_custom_code_role");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.versionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", pageId: "page-1" }) }));
  });

  it("refuses deleting a page with custom code for other roles", async () => {
    mocks.findFirst.mockResolvedValue(page({ draftContent: withCss }));
    mocks.manager.mockResolvedValue(actor("support"));
    expect(await inputError(deleteLandingPage("page-1", 2))).toBe("landing_page_custom_code_role");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("returns a precise reason for invalid page CSS and oversized code", async () => {
    const badCss = document([]);
    (badCss.settings as Record<string, unknown>).customCss = "@import url(https://evil.example/x.css);";
    expect(await inputError(saveLandingPageDraft(draft(badCss)))).toBe("landing_page_custom_css_invalid");
    expect(await inputError(saveLandingPageDraft(draft(document([codeNode("big", { js: "x".repeat(50_001) })]))))).toBe("landing_page_custom_code_too_large");
  });
});

describe("create and save_steps paths", () => {
  function stepsWithCode(): { state: FunnelStepPages; codeStepId: string; otherStepId: string } {
    const state = createFunnelStepPages(createFunnelFlow({ id: "flow_code", name: "自訂流程", goal: "sell", domain: "synthetic" })!)!;
    const [codeStep, otherStep] = state.flow.steps.filter((step) => !step.isSystem);
    const page = state.pages[codeStep!.id]!;
    page.root = withJs.root;
    return { state: JSON.parse(JSON.stringify(state)) as FunnelStepPages, codeStepId: codeStep!.id, otherStepId: otherStep!.id };
  }

  it("creating a page with JS needs a verified owner or admin and is audited with the new page id", async () => {
    mocks.manager.mockResolvedValue(actor("support"));
    expect(await inputError(createLandingPage({ name: "x", slug: "x-page", content: withJs }))).toBe("landing_page_custom_code_role");
    mocks.manager.mockResolvedValue(actor("admin"));
    await createLandingPage({ name: "x", slug: "x-page", content: withJs });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "vendor-1", projectId: "project-1" }) }));
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "user-admin", targetId: "page-new", after: expect.objectContaining({ operation: "create" }) }) });
  });

  it("save_steps: removing a step that carries custom code is limited to owner/admin and audited", async () => {
    const { state, codeStepId } = stepsWithCode();
    mocks.findFirst.mockResolvedValue(page({ draftContent: state }));
    mocks.manager.mockResolvedValue(actor("support"));
    expect(await inputError(saveLandingPageStepMetadata({ id: "page-1", revision: 2, mutation: { type: "remove", stepId: codeStepId } }))).toBe("landing_page_custom_code_role");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    mocks.manager.mockResolvedValue(actor("owner"));
    await expect(saveLandingPageStepMetadata({ id: "page-1", revision: 2, mutation: { type: "remove", stepId: codeStepId } })).resolves.toEqual({ id: "page-1", revision: 3 });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "funnel_custom_code_saved", targetId: "page-1",
      after: { operation: "save_steps", changes: [expect.objectContaining({ location: `step:${codeStepId}/node:code`, change: "removed", fields: ["html", "js"] })] },
    }) });
  });

  it("save_steps: an unverified member cannot rewrite a funnel that still carries JS", async () => {
    const { state, otherStepId } = stepsWithCode();
    mocks.findFirst.mockResolvedValue(page({ draftContent: state }));
    mocks.manager.mockResolvedValue(actor("owner", false));
    expect(await inputError(saveLandingPageStepMetadata({ id: "page-1", revision: 2, mutation: { type: "rename", stepId: otherStepId, name: "新名稱" } }))).toBe("landing_page_custom_code_email_unverified");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("reserved public slugs", () => {
  it("refuses platform-like slugs for new pages and slug changes, but keeps an existing page's slug", async () => {
    for (const slug of ["login", "admin", "support", "verify", "password", "signup", "my-celebratedeal"]) {
      expect(await inputError(createLandingPage({ name: "x", slug, content: plain }))).toBe("landing_page_slug_reserved");
      expect(await inputError(saveLandingPageDraft({ ...draft(plain), slug }))).toBe("landing_page_slug_reserved");
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    mocks.findFirst.mockResolvedValue(page({ slug: "support" }));
    await expect(saveLandingPageDraft({ ...draft(plain), slug: "support" })).resolves.toEqual({ id: "page-1", revision: 3 });
    await createLandingPage({ name: "x", slug: "support-group-2026", content: plain });
    expect(mocks.create).toHaveBeenCalledOnce();
  });
});

describe("publishing and serving custom code", () => {
  it("audits the published custom code and refuses an unverified publisher", async () => {
    mocks.findFirst.mockResolvedValue(page({ draftContent: withJs }));
    mocks.manager.mockResolvedValue(actor("owner", false));
    expect(await inputError(publishLandingPage("page-1", 2))).toBe("landing_page_custom_code_email_unverified");
    expect(mocks.versionCreate).not.toHaveBeenCalled();
    mocks.manager.mockResolvedValue(actor("owner"));
    await expect(publishLandingPage("page-1", 2)).resolves.toMatchObject({ id: "page-1", version: 1 });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      vendorId: "vendor-1", actorId: "user-owner", action: "funnel_custom_code_published", targetId: "page-1",
      after: expect.objectContaining({ version: 1, nodes: [expect.objectContaining({ location: "page/node:code", bytes: { html: 9, css: 0, js: 31 } })] }),
    }) });
  });

  it("withholds published JS and page CSS from the public page while the emergency switch is on", async () => {
    const published = document([codeNode("code", { html: "<p>hi</p>", js: "run()" })], "body{display:none}");
    const record = () => [page({ status: "published", publishedVersionId: "version-1", publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content: published, formId: null, liveId: null, live: null } })];
    mocks.findMany.mockResolvedValueOnce(record());
    const normal = await loadPublicLandingPage("custom-page");
    expect(JSON.stringify(normal?.content)).toContain("run()");
    vi.stubEnv("FUNNEL_CUSTOM_CODE_DISABLED", "true");
    mocks.findMany.mockResolvedValueOnce(record());
    const disabled = await loadPublicLandingPage("custom-page");
    expect(disabled).not.toBeNull();
    const serialized = JSON.stringify(disabled?.content);
    expect(serialized).not.toContain("run()");
    expect(serialized).not.toContain("display:none");
    expect(serialized).toContain("<p>hi</p>");
  });
});
