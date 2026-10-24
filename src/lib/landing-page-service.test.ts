import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  manager: vi.fn(), editableScope: vi.fn(), salesScope: vi.fn(),
  create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(),
  versionCreate: vi.fn(), versionCount: vi.fn(), versionFindFirst: vi.fn(), formFindMany: vi.fn(), liveFindFirst: vi.fn(),
  transaction: vi.fn(), validateCommerce: vi.fn(), listCommerce: vi.fn(), publicCommerce: vi.fn(),
  visitCount: vi.fn(), submissionCount: vi.fn(),
}));

const database = {
  landingPage: { create: mocks.create, findFirst: mocks.findFirst, findMany: mocks.findMany, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany },
  landingPageVersion: { create: mocks.versionCreate, count: mocks.versionCount, findFirst: mocks.versionFindFirst },
  funnelVisit: { count: mocks.visitCount },
  funnelSubmission: { count: mocks.submissionCount },
  registrationForm: { findMany: mocks.formFindMany, count: vi.fn() },
  live: { findFirst: mocks.liveFindFirst, findMany: vi.fn(), count: vi.fn() },
  consultationEvent: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
  salesProject: { findFirst: vi.fn(), updateMany: vi.fn() },
  salesProjectProduct: { count: vi.fn() },
  paymentMethodReference: { count: vi.fn() },
};

vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(), assertServerActionOrigin: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: mocks.editableScope, getSalesProjectScope: mocks.salesScope }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ ...database, $transaction: mocks.transaction, vendor: { findUnique: async () => ({ betaFeatureGrants: ["courses", "billing", "funnel_binding", "consultation_booking", "browser_live", "danmaku"] }) } }) }));
vi.mock("@/lib/funnel-commerce-service", () => ({ listFunnelCommerceProducts: mocks.listCommerce, publicFunnelCommerceViews: mocks.publicCommerce, validateFunnelCommerceBindings: mocks.validateCommerce }));

import {
  createLandingPage, deleteLandingPage, duplicateLandingPage, LandingPageConflictError, LandingPageInputError,
  LandingPageNotFoundError, getLandingPageForEditor, getLandingPagePublicationStatus, loadPublicLandingPage, publishLandingPage, rollbackLandingPage, saveLandingPageDraft, saveLandingPageStepMetadata,
} from "./landing-page-service";
import { publishSalesProjectAction } from "@/app/actions/sales-workspace-actions";
import { createFunnelFlow } from "./funnel-flow";
import { createFunnelStepPages } from "./funnel-step-pages";
import { defaultFunnelOperations } from "./funnel-operations";

const now = new Date("2026-09-13T00:00:00.000Z");
const document = { schemaVersion: 1, data: { root: {}, content: [] } };
const page = (overrides: Record<string, unknown> = {}) => ({
  id: "page-1", vendorId: "vendor-1", projectId: "project-1", name: "秋季活動", slug: "fall-launch",
  draftContent: document, draftFormId: null, draftLiveId: null, operations: null, status: "draft", publishedVersionId: null,
  revision: 2, publishedAt: null, updatedAt: now, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manager.mockResolvedValue({ auth: { user: { id: "user-1" } }, vendor: { betaFeatureGrants: ["courses", "billing", "funnel_binding", "consultation_booking", "browser_live", "danmaku"], id: "vendor-1" } });
  mocks.editableScope.mockResolvedValue({ projectId: "project-1", projectName: "秋季專案", isAggregate: false, isLegacyWorkspace: false });
  mocks.salesScope.mockResolvedValue({ projectId: "project-1", projectName: "秋季專案", isAggregate: false, isLegacyWorkspace: false });
  mocks.formFindMany.mockResolvedValue([]); mocks.liveFindFirst.mockResolvedValue(null); database.live.findMany.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(page()); mocks.findMany.mockResolvedValue([]); mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.create.mockResolvedValue(page({ id: "page-new" })); mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.visitCount.mockResolvedValue(0); mocks.submissionCount.mockResolvedValue(0);
  mocks.versionCount.mockResolvedValue(0); mocks.versionCreate.mockResolvedValue({ id: "version-1", version: 1, content: document, formId: null, liveId: null, createdAt: now });
  mocks.versionFindFirst.mockResolvedValue(null); mocks.validateCommerce.mockResolvedValue(undefined); mocks.listCommerce.mockResolvedValue([]); mocks.publicCommerce.mockResolvedValue([]);
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

  it("從未發布且無流量的草稿：先 detach published pointer，再以 revision CAS 刪除", async () => {
    await expect(deleteLandingPage("page-1", 2)).resolves.toEqual({ id: "page-1", archived: false });
    expect(mocks.visitCount).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", pageId: "page-1" } });
    expect(mocks.submissionCount).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", pageId: "page-1" } });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 2, archivedAt: null }, data: { publishedVersionId: null, revision: { increment: 1 } } });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 3, archivedAt: null } });
  });

  it.each([
    ["曾發布（有 publishedAt）", () => mocks.findFirst.mockResolvedValue(page({ publishedAt: now }))],
    ["有歷史版本", () => mocks.versionCount.mockResolvedValue(1)],
    ["有造訪紀錄", () => mocks.visitCount.mockResolvedValue(3)],
    ["有名單來源紀錄", () => mocks.submissionCount.mockResolvedValue(1)],
  ])("%s的 Funnel 改為封存，不刪除", async (_label, arrange) => {
    arrange();
    await expect(deleteLandingPage("page-1", 2)).resolves.toEqual({ id: "page-1", archived: true });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 2, archivedAt: null },
      data: expect.objectContaining({ archivedAt: expect.any(Date), status: "draft", publishedVersionId: null, revision: { increment: 1 } }),
    });
  });

  it("已發布頁面封存時一併下架", async () => {
    mocks.findFirst.mockResolvedValue(page({ status: "published", publishedVersionId: "version-1", publishedAt: now }));
    await expect(deleteLandingPage("page-1", 2)).resolves.toEqual({ id: "page-1", archived: true });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "draft", publishedVersionId: null, unpublishedAt: expect.any(Date) }),
    }));
  });

  it("刪除時 revision 不符即視為衝突", async () => {
    await expect(deleteLandingPage("page-1", 5)).rejects.toBeInstanceOf(LandingPageConflictError);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("Step metadata 只套用 bounded mutation，拒絕畫布替換", async () => {
    const flow = createFunnelFlow({ id: "flow_1", name: "名單 Funnel", goal: "audience", domain: "audience" })!;
    const state = createFunnelStepPages(flow)!;
    mocks.findFirst.mockResolvedValueOnce(page({ draftContent: state }));
    await expect(saveLandingPageStepMetadata({ id: "page-1", revision: 2, mutation: { type: "rename", stepId: "opt_in", name: "新版名單頁" } })).resolves.toEqual({ id: "page-1", revision: 3 });
    await expect(saveLandingPageStepMetadata({ id: "page-1", revision: 2, mutation: { type: "replace_canvas", content: {} } as never })).rejects.toBeInstanceOf(LandingPageInputError);
  });

  it("duplicate avoids a globally occupied slug without reading another project's content", async () => {
    mocks.findFirst.mockResolvedValueOnce(page()).mockResolvedValueOnce({ id: "other-project-page" }).mockResolvedValueOnce(null);
    await duplicateLandingPage("page-1");
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { slug: "fall-launch-copy" }, select: { id: true } });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { slug: "fall-launch-copy-2" }, select: { id: true } });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "vendor-1", projectId: "project-1", slug: "fall-launch-copy-2" }) }));
  });

  it("editor loader 僅回傳目前 vendor/project 的頁面與資源", async () => {
    const scheduledAt = new Date("2026-09-20T10:00:00.000Z");
    mocks.findFirst.mockResolvedValueOnce(page({ draftFormId: "form-1", draftLiveId: "live-1", versions: [] }));
    mocks.formFindMany.mockResolvedValueOnce([{ id: "form-1", slug: "signup", name: "報名表", fields: [], submitLabel: "送出", successMessage: "收到" }]);
    database.live.findMany.mockResolvedValueOnce([{ id: "live-1", slug: "launch", title: "直播", status: "scheduled", scheduledAt, formId: "form-1", videoId: null, video: null }]);
    mocks.listCommerce.mockResolvedValueOnce([{ id: "product-1", name: "商品", priceCents: 100, currency: "TWD", fulfillmentType: "digital" }]);

    const result = await getLandingPageForEditor("page-1");

    expect(result.page.liveId).toBe("live-1");
    expect(result.forms).toEqual([{ id: "form-1", slug: "signup", name: "報名表" }]);
    expect(result.lives[0]).toMatchObject({ id: "live-1", formId: "form-1", status: "scheduled" });
    expect(result.commerceProducts).toHaveLength(1);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", archivedAt: null } }));
    expect(database.live.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", projectId: "project-1" }) }));
  });

  it("公開 slug 在跨專案不唯一時 fail closed", async () => {
    mocks.findMany.mockResolvedValueOnce([page({ id: "page-a" }), page({ id: "page-b" })]);

    await expect(loadPublicLandingPage("fall-launch")).resolves.toBeNull();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2,
      where: expect.objectContaining({ slug: "fall-launch", status: "published" }),
    }));
  });

  it("公開 Funnel loader 只組合已發布且同租戶的內容", async () => {
    const flow = createFunnelFlow({ id: "flow_public", name: "公開名單", goal: "audience", domain: "audience" })!;
    const content = createFunnelStepPages(flow)!;
    mocks.findMany.mockResolvedValueOnce([page({ status: "published", publishedVersionId: "version-1", publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content, formId: null, liveId: null, live: null } })]);

    const result = await loadPublicLandingPage(" FALL-LAUNCH ");

    expect(result).toMatchObject({ id: "page-1", slug: "fall-launch", publishedAt: now, content });
    expect(result?.context).toEqual({ pageId: "page-1", forms: [] });
    expect(mocks.publicCommerce).toHaveBeenCalledWith({ vendorId: "vendor-1", projectId: "project-1" }, content, "fall-launch");
  });

  it("公開 Funnel loader 對 snapshot、內容與表單邊界 fail closed", async () => {
    const published = (version: Record<string, unknown>) => page({ status: "published", publishedVersionId: "version-1", publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content: createFunnelStepPages(createFunnelFlow({ id: "flow_public", name: "公開名單", goal: "audience", domain: "audience" })!)!, formId: null, liveId: null, live: null, ...version } });
    mocks.findMany.mockResolvedValueOnce([page({ status: "published", publishedVersionId: "version-1", publishedAt: now, publishedVersion: null })]);
    await expect(loadPublicLandingPage("fall-launch")).resolves.toBeNull();
    mocks.findMany.mockResolvedValueOnce([published({ content: { invalid: true } })]);
    await expect(loadPublicLandingPage("fall-launch")).resolves.toBeNull();
    mocks.findMany.mockResolvedValueOnce([published({ vendorId: "other-vendor" })]);
    await expect(loadPublicLandingPage("fall-launch")).resolves.toBeNull();
    mocks.findMany.mockResolvedValueOnce([published({ formId: "form-1" })]);
    mocks.formFindMany.mockResolvedValueOnce([]);
    await expect(loadPublicLandingPage("fall-launch")).resolves.toBeNull();
    await expect(loadPublicLandingPage("not a valid slug")).resolves.toBeNull();
  });

  it("公開 loader 投影同專案的有效表單", async () => {
    const flow = createFunnelFlow({ id: "flow_form", name: "公開報名", goal: "audience", domain: "audience" })!;
    const content = createFunnelStepPages(flow)!;
    mocks.findMany.mockResolvedValueOnce([page({ status: "published", publishedVersionId: "version-1", publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content, formId: "form-1", liveId: null, live: null } })]);
    mocks.formFindMany.mockResolvedValueOnce([{ id: "form-1", slug: "signup", name: "報名表", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }], submitLabel: "", successMessage: "" }]);

    const result = await loadPublicLandingPage("fall-launch");

    expect(result?.submissionForm).toMatchObject({ id: "form-1", submitLabel: "送出報名", successMessage: "已收到報名，請留意確認信。" });
    expect(result?.context.forms).toEqual([{ id: "form-1", slug: "signup", name: "報名表" }]);
  });

  it("公開 loader 拒絕已綁定但不存在的直播", async () => {
    const flow = createFunnelFlow({ id: "flow_live", name: "公開直播", goal: "audience", domain: "audience" })!;
    const content = createFunnelStepPages(flow)!;
    mocks.findMany.mockResolvedValueOnce([page({ status: "published", publishedVersionId: "version-1", publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content, formId: "form-1", liveId: "live-1", live: null } })]);
    mocks.formFindMany.mockResolvedValueOnce([{ id: "form-1", slug: "signup", name: "報名表", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }], submitLabel: "送出", successMessage: "收到" }]);

    await expect(loadPublicLandingPage("fall-launch")).resolves.toBeNull();
  });
});

describe("merchant publication diagnosis", () => {
  beforeEach(() => {
    database.salesProject.findFirst.mockResolvedValue({ status: "draft", publishedAt: null, primaryFlow: "live" });
    database.salesProjectProduct.count.mockResolvedValue(0);
    database.registrationForm.count.mockResolvedValue(0);
    database.live.count.mockResolvedValue(0);
    database.consultationEvent.findMany.mockResolvedValue([]);
    database.paymentMethodReference.count.mockResolvedValue(0);
  });

  it("lists missing requirements without relaxing the verified payment predicate", async () => {
    const result = await getLandingPagePublicationStatus("page-1");
    expect(result.available).toBe(false);
    expect(result.message).toContain("專案尚未發布，公開網址目前無法開啟");
    expect(result.projectHref).toBe("/projects/project-1");
    expect(result.missing.map((item) => item.href)).toEqual(["/products", "/forms", "/billing/payment-methods", "/lives"]);
    expect(database.paymentMethodReference.count).toHaveBeenCalledWith({ where: {
      vendorId: "vendor-1", scopeType: "VENDOR", membershipId: null, status: "verified",
      verifiedAt: { not: null, lte: expect.any(Date) }, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    } });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", archivedAt: null } }));
    expect(database.salesProject.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "project-1", vendorId: "vendor-1" } }));
  });

  it("still requires explicit project publication when no prerequisite is missing", async () => {
    database.salesProjectProduct.count.mockResolvedValue(1); database.registrationForm.count.mockResolvedValue(1);
    database.live.count.mockResolvedValue(1); database.paymentMethodReference.count.mockResolvedValue(1);
    const result = await getLandingPagePublicationStatus("page-1");
    expect(result).toMatchObject({ available: false, missing: [] });
    expect(result.message).toContain("發布條件已齊備");
    expect(database.salesProject.updateMany).not.toHaveBeenCalled();
  });

  it("reports consultation availability separately", async () => {
    database.salesProject.findFirst.mockResolvedValue({ status: "draft", publishedAt: null, primaryFlow: "consultation" });
    database.consultationEvent.findMany.mockResolvedValue([{ weeklySchedule: [] }]);
    const result = await getLandingPagePublicationStatus("page-1");
    expect(result.missing.map((item) => item.label)).toContain("尚未設定可預約時間");
    expect(result.missing.map((item) => item.href)).not.toContain("/lives");
  });

  it("does not diagnose a page outside the selected merchant project", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    await expect(getLandingPagePublicationStatus("foreign-page")).rejects.toBeInstanceOf(LandingPageNotFoundError);
    expect(database.salesProject.findFirst).not.toHaveBeenCalled();
    await expect(getLandingPagePublicationStatus("../bad id")).rejects.toBeInstanceOf(LandingPageNotFoundError);
  });

  it("reports an unpublished Funnel separately from its published project", async () => {
    database.salesProject.findFirst.mockResolvedValue({ status: "published", publishedAt: now, primaryFlow: "live" });
    await expect(getLandingPagePublicationStatus("page-1")).resolves.toMatchObject({ available: false, message: "一頁式網站尚未發布，公開網址目前無法開啟。" });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("uses the public resolver's reason when a published version is broken", async () => {
    database.salesProject.findFirst.mockResolvedValue({ status: "published", publishedAt: now, primaryFlow: "live" });
    mocks.findFirst.mockResolvedValueOnce(page({ status: "published" }));
    mocks.findMany.mockResolvedValueOnce([page({ publishedAt: now, publishedVersion: null })]);
    await expect(getLandingPagePublicationStatus("page-1")).resolves.toMatchObject({ available: false, message: "一頁式網站發布版本不存在或不一致，請重新發布。" });
  });

  it("names a disabled registration form as the public 404 reason", async () => {
    database.salesProject.findFirst.mockResolvedValue({ status: "published", publishedAt: now, primaryFlow: "live" });
    mocks.findFirst.mockResolvedValueOnce(page({ status: "published" }));
    mocks.findMany.mockResolvedValueOnce([page({ publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content: document, formId: "form-disabled", liveId: null, live: null } })]);
    mocks.formFindMany.mockResolvedValueOnce([]);
    await expect(getLandingPagePublicationStatus("page-1")).resolves.toMatchObject({ available: false, message: "已發布版本的報名表不存在、已停用或不屬於此專案。" });
  });

  it("reports broken multi-step operations instead of claiming the public page is available", async () => {
    database.salesProject.findFirst.mockResolvedValue({ status: "published", publishedAt: now, primaryFlow: "live" });
    mocks.findFirst.mockResolvedValueOnce(page({ status: "published", operations: { invalid: true } }));
    const content = createFunnelStepPages(createFunnelFlow({ id: "flow_diagnosis", name: "合成名單", goal: "audience", domain: "audience" })!)!;
    mocks.findMany.mockResolvedValueOnce([page({ publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content, formId: null, liveId: null } })]);
    const result = await getLandingPagePublicationStatus("page-1");
    expect(result.available).toBe(false);
    expect(result.message).toContain("A/B 或截止設定無效");
    expect(result.missing[0]?.href).toBe("/landing-pages/page-1/operations");
  });

  it("reports an available page when project, Funnel and resources are all public", async () => {
    database.salesProject.findFirst.mockResolvedValue({ status: "published", publishedAt: now, primaryFlow: "live" });
    mocks.findFirst.mockResolvedValueOnce(page({ status: "published" }));
    const content = createFunnelStepPages(createFunnelFlow({ id: "flow_available", name: "合成名單", goal: "audience", domain: "audience" })!)!;
    mocks.findMany.mockResolvedValueOnce([page({ publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content, formId: null, liveId: null } })]);
    await expect(getLandingPagePublicationStatus("page-1")).resolves.toMatchObject({ available: true, message: "專案與一頁式網站均已發布，公開頁目前可開啟。" });
  });

  describe("published Funnel availability", () => {
    const funnelContent = () => createFunnelStepPages(createFunnelFlow({ id: "flow_warn", name: "合成名單", goal: "audience", domain: "audience" })!)!;
    function publishedWith(content: ReturnType<typeof funnelContent>, operations: unknown) {
      database.salesProject.findFirst.mockResolvedValue({ status: "published", publishedAt: now, primaryFlow: "live" });
      mocks.findFirst.mockResolvedValue(page({ status: "published", operations }));
      mocks.findMany.mockResolvedValue([page({ publishedAt: now, publishedVersion: { id: "version-1", vendorId: "vendor-1", pageId: "page-1", content, formId: null, liveId: null } })]);
    }

    it("stays available with a warning when a report references a stale step the runtime ignores", async () => {
      publishedWith(funnelContent(), { ...defaultFunnelOperations(), reports: { stats: { stepId: "ghost_step", days: 30 }, leads: { stepId: "", days: 30 }, sales: { stepId: "", days: 30 } } });
      const result = await getLandingPagePublicationStatus("page-1");
      expect(result.available).toBe(true);
      expect(result.warnings?.map((item) => item.href)).toEqual(["/landing-pages/page-1/operations"]);
    });

    it("reports a version with a step missing its page as invalid content, as the public loader 404s it", async () => {
      const content = funnelContent();
      const later = content.flow.steps.filter((step) => !step.isSystem)[1]!;
      const pages = { ...content.pages };
      delete pages[later.id];
      publishedWith({ ...content, pages }, null);
      await expect(getLandingPagePublicationStatus("page-1")).resolves.toMatchObject({ available: false, message: "已發布版本的頁面內容格式無效，請修復後重新發布。" });
    });

    it("is available without warnings for a healthy Funnel", async () => {
      publishedWith(funnelContent(), null);
      const result = await getLandingPagePublicationStatus("page-1");
      expect(result).toMatchObject({ available: true, missing: [] });
      expect(result.warnings).toBeUndefined();
    });

    it("is deterministically unavailable when one A/B arm of the entry step would 404", async () => {
      const content = funnelContent();
      const control = content.flow.steps.find((step) => !step.isSystem)!;
      // A variant that points at the system step makes only that arm unavailable at runtime.
      const system = content.flow.steps.find((step) => step.isSystem)!;
      publishedWith(content, { ...defaultFunnelOperations(), experiment: { id: "exp-1", status: "running", controlStepId: control.id, variantStepId: system.id, controlWeight: 50, variantWeight: 50, winner: null } });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(getLandingPagePublicationStatus("page-1")).resolves.toMatchObject({ available: false, message: expect.stringContaining("A/B 各組") });
      }
    });
  });

  it.each(["live", "consultation"])("keeps diagnosis query predicates identical to the real %s publication action", async (primaryFlow) => {
    database.salesProject.findFirst.mockResolvedValue({ id: "project-1", status: "draft", publishedAt: null, primaryFlow });
    const data = new FormData(); data.set("projectId", "project-1");
    await expect(publishSalesProjectAction(data)).rejects.toThrow("redirect:/projects/project-1?error=not_ready");
    await getLandingPagePublicationStatus("page-1");
    // Compares the queries both real entry points issue, so a future gate change raises a drift alarm here.
    const normalized = (value: unknown): unknown => value instanceof Date ? "current-time"
      : Array.isArray(value) ? value.map(normalized)
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalized(child)])) : value;
    for (const fn of [database.salesProjectProduct.count, database.registrationForm.count, database.live.count, database.consultationEvent.findMany, database.paymentMethodReference.count]) {
      expect(fn).toHaveBeenCalledTimes(2);
      expect(normalized(fn.mock.calls[1]?.[0])).toEqual(normalized(fn.mock.calls[0]?.[0]));
    }
    expect(database.salesProject.updateMany).not.toHaveBeenCalled();
  });
});
