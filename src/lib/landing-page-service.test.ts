import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  manager: vi.fn(), editableScope: vi.fn(), salesScope: vi.fn(),
  create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(),
  versionCreate: vi.fn(), versionCount: vi.fn(), versionFindFirst: vi.fn(), formFindMany: vi.fn(), liveFindFirst: vi.fn(),
  transaction: vi.fn(), validateCommerce: vi.fn(),
}));

const database = {
  landingPage: { create: mocks.create, findFirst: mocks.findFirst, findMany: mocks.findMany, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany },
  landingPageVersion: { create: mocks.versionCreate, count: mocks.versionCount, findFirst: mocks.versionFindFirst },
  registrationForm: { findMany: mocks.formFindMany },
  live: { findFirst: mocks.liveFindFirst, findMany: vi.fn() },
  product: { findMany: vi.fn() },
};

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: mocks.editableScope, getSalesProjectScope: mocks.salesScope }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ ...database, $transaction: mocks.transaction }) }));
vi.mock("@/lib/funnel-commerce-service", () => ({ listFunnelCommerceProducts: vi.fn(), validateFunnelCommerceBindings: mocks.validateCommerce }));

import {
  createLandingPage, deleteLandingPage, duplicateLandingPage, LandingPageConflictError, LandingPageInputError,
  LandingPageNotFoundError, publishLandingPage, rollbackLandingPage, saveLandingPageDraft, saveLandingPageStepMetadata,
} from "./landing-page-service";
import { createFunnelFlow } from "./funnel-flow";
import { createFunnelStepPages } from "./funnel-step-pages";

const now = new Date("2026-09-13T00:00:00.000Z");
const document = { schemaVersion: 1, data: { root: {}, content: [] } };
const page = (overrides: Record<string, unknown> = {}) => ({
  id: "page-1", vendorId: "vendor-1", projectId: "project-1", name: "秋季活動", slug: "fall-launch",
  draftContent: document, draftFormId: null, draftLiveId: null, operations: null, status: "draft", publishedVersionId: null,
  revision: 2, publishedAt: null, updatedAt: now, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manager.mockResolvedValue({ auth: { user: { id: "user-1" } }, vendor: { id: "vendor-1" } });
  mocks.editableScope.mockResolvedValue({ projectId: "project-1", projectName: "秋季專案", isAggregate: false, isLegacyWorkspace: false });
  mocks.salesScope.mockResolvedValue({ projectId: "project-1", projectName: "秋季專案", isAggregate: false, isLegacyWorkspace: false });
  mocks.formFindMany.mockResolvedValue([]); mocks.liveFindFirst.mockResolvedValue(null);
  mocks.findFirst.mockResolvedValue(page()); mocks.findMany.mockResolvedValue([]); mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.create.mockResolvedValue(page({ id: "page-new" })); mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.versionCount.mockResolvedValue(0); mocks.versionCreate.mockResolvedValue({ id: "version-1", version: 1, content: document, formId: null, liveId: null, createdAt: now });
  mocks.versionFindFirst.mockResolvedValue(null); mocks.validateCommerce.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback: (value: typeof database) => Promise<unknown>) => callback(database));
});

describe("landing page scoped mutations", () => {
  it("拒絕目前專案以外的表單綁定", async () => {
    mocks.formFindMany.mockResolvedValueOnce([]);
    await expect(createLandingPage({ name: "秋季活動", slug: "fall-launch", formId: "foreign-form", content: document })).rejects.toBeInstanceOf(LandingPageInputError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("使用 tenant/project/revision CAS 儲存草稿", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(saveLandingPageDraft({ id: "page-1", revision: 2, name: "秋季活動", slug: "fall-launch", content: document })).rejects.toBeInstanceOf(LandingPageConflictError);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 2 } }));
  });

  it("發布 immutable snapshot，並以版本唯一鍵處理競爭", async () => {
    await expect(publishLandingPage("page-1", 2)).resolves.toEqual({ id: "page-1", revision: 3, version: 1 });
    expect(mocks.versionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ content: document }) }));
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });
    await expect(publishLandingPage("page-1", 2)).rejects.toBeInstanceOf(LandingPageConflictError);
  });

  it("回復版本時仍限制在目前專案", async () => {
    mocks.versionFindFirst.mockResolvedValueOnce(null);
    await expect(rollbackLandingPage("page-1", 1, 2)).rejects.toBeInstanceOf(LandingPageNotFoundError);
    expect(mocks.versionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { pageId: "page-1", vendorId: "vendor-1", version: 1, page: { is: { projectId: "project-1" } } } }));
  });

  it("刪除先 detach published pointer，再以 revision CAS 刪除", async () => {
    await expect(deleteLandingPage("page-1", 2)).resolves.toEqual({ id: "page-1" });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 2 }, data: { publishedVersionId: null, revision: { increment: 1 } } });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 3 } });
  });

  it("Step metadata 只套用 bounded mutation，拒絕畫布替換", async () => {
    const flow = createFunnelFlow({ id: "flow_1", name: "名單 Funnel", goal: "audience", domain: "audience" })!;
    const state = createFunnelStepPages(flow)!;
    mocks.findFirst.mockResolvedValueOnce(page({ draftContent: state }));
    await expect(saveLandingPageStepMetadata({ id: "page-1", revision: 2, mutation: { type: "rename", stepId: "opt_in", name: "新版名單頁" } })).resolves.toEqual({ id: "page-1", revision: 3 });
    await expect(saveLandingPageStepMetadata({ id: "page-1", revision: 2, mutation: { type: "replace_canvas", content: {} } as never })).rejects.toBeInstanceOf(LandingPageInputError);
  });

  it("duplicate slug 只在同一 vendor/project 內尋找", async () => {
    mocks.findFirst.mockResolvedValueOnce(page()).mockResolvedValueOnce(null);
    await duplicateLandingPage("page-1");
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", projectId: "project-1", slug: "fall-launch-copy" } }));
  });
});
