import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireManager: vi.fn(), editableScope: vi.fn(), salesScope: vi.fn(),
  landingPageCreate: vi.fn(), landingPageFindFirst: vi.fn(), landingPageFindMany: vi.fn(), landingPageUpdateMany: vi.fn(),
  versionCreate: vi.fn(), versionCount: vi.fn(), versionFindFirst: vi.fn(),
  formFindMany: vi.fn(), liveFindFirst: vi.fn(), liveFindMany: vi.fn(), transaction: vi.fn(),
}));

const database = {
  landingPage: { create: mocks.landingPageCreate, findFirst: mocks.landingPageFindFirst, findMany: mocks.landingPageFindMany, updateMany: mocks.landingPageUpdateMany },
  landingPageVersion: { create: mocks.versionCreate, count: mocks.versionCount, findFirst: mocks.versionFindFirst },
  registrationForm: { findMany: mocks.formFindMany },
  live: { findFirst: mocks.liveFindFirst, findMany: mocks.liveFindMany },
};

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.requireManager }));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: mocks.editableScope, getSalesProjectScope: mocks.salesScope }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ ...database, $transaction: mocks.transaction }) }));

import {
  createLandingPage, duplicateLandingPage, LandingPageConflictError, LandingPageInputError, LandingPageNotFoundError,
  loadPublicLandingPage, publishLandingPage, rollbackLandingPage, saveLandingPageDraft,
} from "./landing-page-service";

const now = new Date("2026-09-13T00:00:00.000Z");

function content(formId = "form-1") {
  return { schemaVersion: 1, data: { root: {}, content: [{ type: "Button", props: { id: "register", label: "立即報名", action: { type: "registration", formId } } }] } };
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1", vendorId: "vendor-1", projectId: "project-1", name: "秋季活動", slug: "fall-launch",
    draftContent: content(), draftFormId: "form-1", draftLiveId: null, status: "draft", publishedVersionId: null,
    revision: 2, publishedAt: null, updatedAt: now, ...overrides,
  };
}

function formRowsFrom(args: unknown) {
  const ids = (args as { where?: { id?: { in?: string[] } } }).where?.id?.in ?? [];
  return ids.map((id) => ({ id, slug: `${id}-slug`, name: `${id} 表單` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireManager.mockResolvedValue({ auth: { user: { id: "user-1" } }, vendor: { id: "vendor-1" } });
  mocks.editableScope.mockResolvedValue({ projectId: "project-1", projectName: "秋季專案", isAggregate: false, isLegacyWorkspace: false });
  mocks.salesScope.mockResolvedValue({ projectId: "project-1", projectName: "秋季專案", isAggregate: false, isLegacyWorkspace: false });
  mocks.formFindMany.mockImplementation(async (args: unknown) => formRowsFrom(args));
  mocks.liveFindFirst.mockResolvedValue(null); mocks.liveFindMany.mockResolvedValue([]);
  mocks.landingPageCreate.mockResolvedValue(page({ id: "page-new", revision: 1 }));
  mocks.landingPageFindFirst.mockResolvedValue(page()); mocks.landingPageFindMany.mockResolvedValue([]); mocks.landingPageUpdateMany.mockResolvedValue({ count: 1 });
  mocks.versionCount.mockResolvedValue(0); mocks.versionCreate.mockResolvedValue({ id: "version-1", version: 1, content: content(), formId: "form-1", liveId: null, createdAt: now }); mocks.versionFindFirst.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (callback: (transaction: typeof database) => Promise<unknown>) => callback(database));
});

describe("landing page service", () => {
  it("rejects a registration form outside the current tenant/project before creating", async () => {
    mocks.formFindMany.mockResolvedValueOnce([]);
    await expect(createLandingPage({ name: "秋季活動", slug: "fall-launch", formId: "form-other", content: content("form-other") })).rejects.toBeInstanceOf(LandingPageInputError);
    expect(mocks.formFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", projectId: "project-1", isActive: true, id: { in: ["form-other"] } } }));
    expect(mocks.landingPageCreate).not.toHaveBeenCalled();
  });

  it("uses a tenant/project/revision CAS update and reports a concurrent draft save", async () => {
    mocks.landingPageUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(saveLandingPageDraft({ id: "page-1", revision: 2, name: "秋季活動", slug: "fall-launch", formId: "form-1", content: content() })).rejects.toBeInstanceOf(LandingPageConflictError);
    expect(mocks.landingPageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 2 }, data: expect.objectContaining({ revision: { increment: 1 } }) }));
  });

  it("publishes an immutable snapshot that is distinct from a later draft save", async () => {
    const firstContent = content("form-1"); const editedContent = content("form-2");
    mocks.landingPageFindFirst.mockResolvedValueOnce(page({ draftContent: firstContent, draftFormId: "form-1", revision: 2 })).mockResolvedValueOnce(page({ draftContent: firstContent, draftFormId: "form-1", revision: 3, status: "published", publishedVersionId: "version-1" }));
    await expect(publishLandingPage("page-1", 2)).resolves.toEqual({ id: "page-1", revision: 3, version: 1 });
    await expect(saveLandingPageDraft({ id: "page-1", revision: 3, name: "秋季活動", slug: "fall-launch", formId: "form-2", content: editedContent })).resolves.toEqual({ id: "page-1", revision: 4 });
    expect(mocks.versionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ content: firstContent, formId: "form-1" }) }));
    expect(mocks.landingPageUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ draftContent: editedContent, draftFormId: "form-2" }) }));
  });

  it("maps a concurrent version unique-key collision to the same publish CAS conflict", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002", detail: "must-not-leak" });

    await expect(publishLandingPage("page-1", 2)).rejects.toBeInstanceOf(LandingPageConflictError);
  });

  it("fails closed for a published pointer whose version belongs to another tenant or page", async () => {
    mocks.landingPageFindFirst.mockResolvedValueOnce({ id: "page-1", vendorId: "vendor-1", projectId: "project-1", slug: "fall-launch", publishedAt: now, publishedVersion: { id: "version-foreign", vendorId: "vendor-2", pageId: "page-other", content: content(), formId: "form-1", liveId: null, createdAt: now, live: null } });
    await expect(loadPublicLandingPage("fall-launch")).resolves.toBeNull();
    expect(mocks.formFindMany).not.toHaveBeenCalled();
  });

  it("fails closed when the published content points to an inactive or moved form", async () => {
    mocks.landingPageFindFirst.mockResolvedValueOnce({ id: "page-1", vendorId: "vendor-1", projectId: "project-1", slug: "fall-launch", publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content: content(), formId: "form-1", liveId: null, createdAt: now, live: null } });
    mocks.formFindMany.mockResolvedValueOnce([]);
    await expect(loadPublicLandingPage("fall-launch")).resolves.toBeNull();
    expect(mocks.formFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["form-1"] }, vendorId: "vendor-1", projectId: "project-1", isActive: true } }));
  });

  it("rejects a live linkage whose own registration form differs from the page CTAs", async () => {
    mocks.liveFindFirst.mockResolvedValueOnce({ id: "live-1", slug: "live", title: "直播", status: "scheduled", scheduledAt: now, formId: "form-live" });
    await expect(createLandingPage({ name: "秋季活動", slug: "fall-launch", liveId: "live-1", formId: "form-1", content: content("form-1") })).rejects.toBeInstanceOf(LandingPageInputError);
    expect(mocks.liveFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "live-1", vendorId: "vendor-1", projectId: "project-1" }), select: expect.objectContaining({ formId: true }) }));
  });

  it("scopes rollback versions to the authenticated project before copying a draft", async () => {
    mocks.versionFindFirst.mockResolvedValueOnce(null);
    await expect(rollbackLandingPage("page-1", 1, 2)).rejects.toBeInstanceOf(LandingPageNotFoundError);
    expect(mocks.versionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { pageId: "page-1", vendorId: "vendor-1", version: 1, page: { is: { projectId: "project-1" } } } }));
    expect(mocks.landingPageUpdateMany).not.toHaveBeenCalled();
  });

  it("duplicates only the scoped draft and always creates a new unpublished row", async () => {
    mocks.landingPageFindFirst.mockResolvedValueOnce(page({ status: "published", publishedVersionId: "version-1" })).mockResolvedValueOnce(null);
    mocks.landingPageCreate.mockResolvedValueOnce(page({ id: "page-copy", name: "秋季活動 副本", slug: "fall-launch-copy", status: "draft", publishedVersionId: null, revision: 1 }));
    const duplicate = await duplicateLandingPage("page-1");
    expect(duplicate.id).toBe("page-copy");
    expect(mocks.landingPageCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "vendor-1", projectId: "project-1", slug: "fall-launch-copy", draftContent: content() }) }));
  });
});
