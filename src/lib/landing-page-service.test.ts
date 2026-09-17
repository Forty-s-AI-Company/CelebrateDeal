import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireManager: vi.fn(), editableScope: vi.fn(), salesScope: vi.fn(),
  landingPageCreate: vi.fn(), landingPageDeleteMany: vi.fn(), landingPageFindFirst: vi.fn(), landingPageFindMany: vi.fn(), landingPageUpdateMany: vi.fn(),
  versionCreate: vi.fn(), versionCount: vi.fn(), versionFindFirst: vi.fn(),
  formFindMany: vi.fn(), liveFindFirst: vi.fn(), liveFindMany: vi.fn(), transaction: vi.fn(),
}));

const database = {
  landingPage: { create: mocks.landingPageCreate, deleteMany: mocks.landingPageDeleteMany, findFirst: mocks.landingPageFindFirst, findMany: mocks.landingPageFindMany, updateMany: mocks.landingPageUpdateMany },
  landingPageVersion: { create: mocks.versionCreate, count: mocks.versionCount, findFirst: mocks.versionFindFirst },
  registrationForm: { findMany: mocks.formFindMany },
  live: { findFirst: mocks.liveFindFirst, findMany: mocks.liveFindMany },
};

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.requireManager }));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: mocks.editableScope, getSalesProjectScope: mocks.salesScope }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ ...database, $transaction: mocks.transaction }) }));

import {
  createLandingPage, deleteLandingPage, duplicateLandingPage, LandingPageConflictError, LandingPageInputError, LandingPageNotFoundError,
  listFunnelWebinarResources, getLandingPageForEditor, loadPublicLandingPage, publishLandingPage, rollbackLandingPage, saveLandingPageDraft,
  saveLandingPageStepMetadata,
} from "./landing-page-service";
import { createEmptyPageDocument } from "./funnel-page-document";

import { createFunnelFlow } from "./funnel-flow";
import { createFunnelStepPages } from "./funnel-step-pages";

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
  mocks.landingPageDeleteMany.mockResolvedValue({ count: 1 });
  mocks.landingPageFindFirst.mockResolvedValue(page()); mocks.landingPageFindMany.mockResolvedValue([]); mocks.landingPageUpdateMany.mockResolvedValue({ count: 1 });
  mocks.versionCount.mockResolvedValue(0); mocks.versionCreate.mockResolvedValue({ id: "version-1", version: 1, content: content(), formId: "form-1", liveId: null, createdAt: now }); mocks.versionFindFirst.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (callback: (transaction: typeof database) => Promise<unknown>) => callback(database));
});

describe("landing page service", () => {
  it("儲存並重新載入 PageDocument，不需要資料庫 migration", async () => {
    const document = createEmptyPageDocument("funnel-page", "中文 Funnel");
    mocks.landingPageFindFirst
      .mockResolvedValueOnce(page({ draftContent: document, draftFormId: null, versions: [] }))
      .mockResolvedValueOnce(page({ draftContent: document, draftFormId: null, versions: [] }));
    await expect(saveLandingPageDraft({ id: "page-1", revision: 2, name: "中文 Funnel", slug: "funnel", content: document })).resolves.toEqual({ id: "page-1", revision: 3 });
    const reloaded = await getLandingPageForEditor("page-1");
    expect(reloaded.page.content).toEqual(document);
    expect(mocks.landingPageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ draftContent: document }) }));
  });

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


function webinarDraft() {
  const flow = createFunnelFlow({ id: "webinar_flow", name: "Webinar", goal: "webinar", domain: "webinar" })!;
  flow.webinar = { timezone: "Asia/Taipei", startsAt: "2026-09-17T01:00:00.000Z", endsAt: "2026-09-17T02:00:00.000Z", replayEndsAt: null };
  return createFunnelStepPages(flow)!;
}
const webinarFields = [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }];
function webinarLive(videoChanges: Record<string, unknown> = {}) {
  return { id: "live-1", vendorId: "vendor-1", projectId: "project-1", slug: "webinar-live", title: "Webinar", status: "scheduled", scheduledAt: now, formId: "form-1", videoId: "video-1", video: { id: "video-1", vendorId: "vendor-1", title: "影片", sourceType: "cloudflare_stream", status: "ready", cloudflareReadyToStream: true, cloudflareLiveInputUid: null, liveInputStatus: null, ...videoChanges } };
}
describe("Webinar resource boundary", () => {
  it("rejects a standalone document masquerading as a multi-step Webinar", async () => {
    const document = { ...createEmptyPageDocument("standalone", "Webinar"), flow: webinarDraft().flow };
    await expect(createLandingPage({ name: "Webinar", slug: "webinar", content: document })).rejects.toThrow("landing_page_webinar_steps_required");
    mocks.landingPageFindFirst.mockResolvedValue({ ...page(), publishedAt: now, publishedVersion: { vendorId: "vendor-1", pageId: "page-1", content: document, formId: null, liveId: null } });
    expect(await loadPublicLandingPage("webinar")).toBeNull();
  });

  it("自動儲存只套用 Step metadata command，不接受客戶端畫布快照", async () => {
    const flow = createFunnelFlow({ id: "flow_1", name: "名單 Funnel", goal: "audience", domain: "audience" })!;
    const state = createFunnelStepPages(flow)!;
    mocks.landingPageFindFirst.mockResolvedValueOnce(page({ draftContent: state, draftFormId: null }));

    await expect(saveLandingPageStepMetadata({
      id: "page-1", revision: 2, mutation: { type: "rename", stepId: "opt_in", name: "新版名單頁" },
    })).resolves.toEqual({ id: "page-1", revision: 3 });

    const saved = mocks.landingPageUpdateMany.mock.calls.at(-1)?.[0].data.draftContent;
    expect(saved.flow.steps.find((step: { id: string }) => step.id === "opt_in").name).toBe("新版名單頁");
    expect(saved.pages.opt_in).toMatchObject({ id: state.pages.opt_in!.id, root: state.pages.opt_in!.root, name: "新版名單頁" });
    expect(saved.pages.opt_in_thank_you).toEqual(state.pages.opt_in_thank_you);
  });

  it("Step metadata revision 過期時拒絕覆寫", async () => {
    const flow = createFunnelFlow({ id: "flow_1", name: "名單 Funnel", goal: "audience", domain: "audience" })!;
    mocks.landingPageFindFirst.mockResolvedValueOnce(page({ draftContent: createFunnelStepPages(flow), revision: 3 }));
    await expect(saveLandingPageStepMetadata({ id: "page-1", revision: 2, mutation: { type: "rename", stepId: "opt_in", name: "衝突名稱" } })).rejects.toBeInstanceOf(LandingPageConflictError);
    expect(mocks.landingPageUpdateMany).not.toHaveBeenCalled();
  });

  it("以 tenant/project/revision CAS 解除發布版本後永久刪除 Funnel", async () => {
    await expect(deleteLandingPage("page-1", 2)).resolves.toEqual({ id: "page-1" });

    expect(mocks.landingPageUpdateMany).toHaveBeenCalledWith({
      where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 2 },
      data: { publishedVersionId: null, revision: { increment: 1 } },
    });
    expect(mocks.landingPageDeleteMany).toHaveBeenCalledWith({
      where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", revision: 3 },
    });
  });

  it("刪除 CAS 衝突時不會繼續刪除", async () => {
    mocks.landingPageUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(deleteLandingPage("page-1", 2)).rejects.toBeInstanceOf(LandingPageConflictError);
    expect(mocks.landingPageDeleteMany).not.toHaveBeenCalled();
  });
  it("allows an incomplete draft but refuses publication without resources", async () => {
    const document = webinarDraft();
    await expect(createLandingPage({ name: "Webinar", slug: "webinar", content: document })).resolves.toBeDefined();
    mocks.landingPageFindFirst.mockResolvedValue(page({ draftContent: document, draftFormId: null, draftLiveId: null }));
    await expect(publishLandingPage("page-1", 2)).rejects.toThrow("landing_page_webinar_resources_required");
    expect(mocks.versionCreate).not.toHaveBeenCalled();
  });
  it.each([{ vendorId: "other" }, { id: "other" }, { cloudflareReadyToStream: false }, { status: "archived" }])("rejects foreign, mismatched or unready source: %j", async (changes) => {
    mocks.formFindMany.mockResolvedValue([{ id: "form-1", slug: "form", name: "表單", fields: webinarFields }]);
    mocks.liveFindFirst.mockResolvedValue(webinarLive(changes));
    mocks.landingPageFindFirst.mockResolvedValue(page({ draftContent: webinarDraft(), draftLiveId: "live-1" }));
    await expect(publishLandingPage("page-1", 2)).rejects.toThrow("landing_page_webinar_resources_required");
    expect(mocks.versionCreate).not.toHaveBeenCalled();
  });
  it("publishes ready scoped bindings and projects no playback URL", async () => {
    const document = webinarDraft();
    mocks.formFindMany.mockResolvedValue([{ id: "form-1", slug: "form", name: "表單", fields: webinarFields }]);
    mocks.liveFindFirst.mockResolvedValue(webinarLive());
    mocks.landingPageFindFirst.mockResolvedValue(page({ draftContent: document, draftLiveId: "live-1" }));
    await expect(publishLandingPage("page-1", 2)).resolves.toBeDefined();
    mocks.landingPageFindFirst.mockResolvedValue({ ...page(), publishedAt: now, publishedVersion: { vendorId: "vendor-1", pageId: "page-1", content: document, formId: "form-1", liveId: "live-1", live: webinarLive() } });
    const published = await loadPublicLandingPage("webinar");
    expect(published?.webinar?.live).toEqual({ id: "live-1", slug: "webinar-live", videoId: "video-1", videoTitle: "影片" });
    mocks.landingPageFindFirst.mockResolvedValue({ ...page(), publishedAt: now, publishedVersion: { vendorId: "vendor-1", pageId: "page-1", content: document, formId: "form-1", liveId: "live-1", live: webinarLive({ vendorId: "other" }) } });
    expect((await loadPublicLandingPage("webinar"))?.webinar).toBeUndefined();
  });
});

it("lists only scoped Webinar source metadata without serializing video URLs", async () => {
  mocks.liveFindMany.mockResolvedValue([webinarLive()]);
  mocks.formFindMany.mockResolvedValue([{ id: "form-1", fields: webinarFields, submitLabel: "報名", successMessage: "已收到" }]);
  expect(await listFunnelWebinarResources()).toMatchObject({ lives: [{ id: "live-1", videoId: "video-1", videoTitle: "影片", videoReady: true }], forms: [{ id: "form-1", fields: webinarFields }] });
  expect(mocks.liveFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", projectId: "project-1" }) }));
});

it.each([false, true])("refuses an ended Live without replay permission or with expired replay: %s", async (replayEnabled) => {
  const live = { ...webinarLive(), status: "ended", replayEnabled, replayAvailableUntil: new Date("2000-01-01T00:00:00Z") };
  const document = webinarDraft();
  mocks.formFindMany.mockResolvedValue([{ id: "form-1", slug: "form", name: "表單", fields: webinarFields }]);
  mocks.liveFindFirst.mockResolvedValue(live);
  mocks.landingPageFindFirst.mockResolvedValue(page({ draftContent: document, draftLiveId: "live-1" }));
  await expect(publishLandingPage("page-1", 2)).rejects.toThrow("landing_page_webinar_resources_required");
  mocks.landingPageFindFirst.mockResolvedValue({ ...page(), publishedAt: now, publishedVersion: { vendorId: "vendor-1", pageId: "page-1", content: document, formId: "form-1", liveId: "live-1", live } });
  expect((await loadPublicLandingPage("webinar"))?.webinar).toBeUndefined();
});
it("requires one registration, thank-you and broadcast step before publishing", async () => {
  const document = webinarDraft();
  document.flow.steps = document.flow.steps.filter((step) => step.type !== "webinar_thank_you_page");
  delete document.pages.webinar_thank_you;
  mocks.landingPageFindFirst.mockResolvedValue(page({ draftContent: document, draftFormId: null }));
  await expect(publishLandingPage("page-1", 2)).rejects.toThrow("landing_page_webinar_steps_required");
});

it("refuses direct video publication and suppresses runtime playback resources", async () => {
  const document = webinarDraft();
  const node = (id: string, type: string, children?: unknown[]) => ({ schemaVersion: 1, id, type, props: {}, style: {}, overrides: {}, visible: true, attributes: {}, actions: [], ...(children ? { children } : {}) });
  document.pages.webinar_broadcast.root.push(node("direct_section", "section", [node("direct_row", "row", [node("direct_column", "columns_2", [node("direct_video", "video")])])]) as import("./funnel-page-document").FunnelNode);
  mocks.formFindMany.mockResolvedValue([{ id: "form-1", slug: "form", name: "表單", fields: webinarFields }]);
  mocks.liveFindFirst.mockResolvedValue(webinarLive());
  mocks.landingPageFindFirst.mockResolvedValue(page({ draftContent: document, draftLiveId: "live-1" }));
  await expect(publishLandingPage("page-1", 2)).rejects.toThrow("landing_page_webinar_direct_media_forbidden");
  mocks.landingPageFindFirst.mockResolvedValue({ ...page(), publishedAt: now, publishedVersion: { vendorId: "vendor-1", pageId: "page-1", content: document, formId: "form-1", liveId: "live-1", live: webinarLive() } });
  const loaded = await loadPublicLandingPage("webinar");
  expect(loaded).not.toBeNull();
  expect(loaded?.webinar).toBeUndefined();
});
