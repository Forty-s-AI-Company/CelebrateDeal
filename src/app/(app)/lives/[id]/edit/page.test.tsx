import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  getCsrfToken: vi.fn(),
  liveFindFirst: vi.fn(),
  videoFindMany: vi.fn(),
  productFindMany: vi.fn(),
  formFindMany: vi.fn(),
  templateFindMany: vi.fn(),
  scriptFindMany: vi.fn(),
  affiliateFindMany: vi.fn(),
  teamMembershipFindMany: vi.fn(),
  partnerFunnelPageFindMany: vi.fn(),
  draftFindFirst: vi.fn(),
  liveStepperForm: vi.fn(() => null),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: { findFirst: mocks.liveFindFirst },
    video: { findMany: mocks.videoFindMany },
    product: { findMany: mocks.productFindMany },
    registrationForm: { findMany: mocks.formFindMany },
    messageTemplate: { findMany: mocks.templateFindMany },
    interactionScript: { findMany: mocks.scriptFindMany },
    affiliate: { findMany: mocks.affiliateFindMany },
    teamMembership: { findMany: mocks.teamMembershipFindMany },
    partnerFunnelPage: { findMany: mocks.partnerFunnelPageFindMany },
    liveStudioDraft: { findFirst: mocks.draftFindFirst },
  }),
}));
vi.mock("@/lib/live-quota-policy", () => ({
  parseLiveQuotaPolicy: () => ({
    affiliateMode: "enabled",
    defaultAffiliateCode: null,
    maxConcurrentViewers: 500,
    stopWhenCreditsBelow: 300,
    quotaPayerScope: "VENDOR",
    usageAttributionMode: "PROMOTER",
    splitOwnerBps: 3000,
    splitPromoterBps: 7000,
    customAllocations: [],
    memberQuotas: [],
    pageQuotas: [],
  }),
}));
vi.mock("@/components/live-stepper-form", () => ({ LiveStepperForm: mocks.liveStepperForm }));

import EditLivePage from "./page";
import {
  LIVE_REMINDER_EMAIL_TEMPLATE_WHERE,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
} from "@/lib/message-template";
import { emptyLiveStudioDraft } from "@/lib/live-studio-draft";

const live = {
  id: "live-1",
  vendorId: "vendor-1",
  title: "測試直播",
  slug: "test-live",
  scheduledAt: new Date("2026-08-08T01:00:00.000Z"),
  status: "scheduled",
  streamMode: "vod",
  videoId: null,
  formId: null,
  messageTemplateId: null,
  liveReminderTemplateId: null,
  liveReminderOffsetMinutes: 60,
  interactionScriptId: "draft-script",
  description: null,
  heroImageUrl: null,
  heroImageAssetId: null,
  accentCopy: null,
  cloudflareLiveInputUid: null,
  replayEnabled: true,
  quotaPolicy: null,
  products: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1", timezone: "Asia/Taipei" });
  mocks.getCsrfToken.mockResolvedValue("csrf-token");
  mocks.liveFindFirst.mockResolvedValue(live);
  mocks.videoFindMany.mockResolvedValue([]);
  mocks.productFindMany.mockResolvedValue([]);
  mocks.formFindMany.mockResolvedValue([]);
  mocks.templateFindMany.mockResolvedValue([]);
  mocks.scriptFindMany.mockResolvedValue([{ id: "published-script", name: "已發布腳本", status: "published" }]);
  mocks.affiliateFindMany.mockResolvedValue([]);
  mocks.teamMembershipFindMany.mockResolvedValue([]);
  mocks.partnerFunnelPageFindMany.mockResolvedValue([]);
  mocks.draftFindFirst.mockResolvedValue(null);
});

describe("EditLivePage unified Live Studio", () => {
  it("offers only published scripts and maps the existing live into the canonical eight-step draft", async () => {
    const html = renderToStaticMarkup(await EditLivePage({
      params: Promise.resolve({ id: "live-1" }),
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.scriptFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", status: "published" },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    });
    expect(mocks.templateFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        OR: [REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE, LIVE_REMINDER_EMAIL_TEMPLATE_WHERE],
      },
      select: { id: true, name: true, channel: true, trigger: true, subject: true, body: true },
      orderBy: { createdAt: "desc" },
    });
    expect(mocks.productFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true },
      select: { id: true, name: true, inventory: true },
      orderBy: { createdAt: "desc" },
    });
    expect(mocks.formFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", isActive: true },
      select: { id: true, name: true, fields: true },
      orderBy: { createdAt: "desc" },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("目前綁定的互動腳本不是已發布版本");
    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      liveId: "live-1",
      currentStatus: "scheduled",
      initialValues: expect.objectContaining({
        title: "測試直播",
        scheduledAt: "2026-08-08T09:00",
        interactionScriptId: "",
        replayEnabled: true,
        flowVersion: 2,
        activeStep: 0,
      }),
      timeZone: "Asia/Taipei",
    }), undefined);
  });

  it("formats the same UTC instant using another merchant timezone", async () => {
    mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1", timezone: "America/New_York" });

    const tree = await EditLivePage({
      params: Promise.resolve({ id: "live-1" }),
      searchParams: Promise.resolve({}),
    });
    renderToStaticMarkup(tree);

    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      timeZone: "America/New_York",
      initialValues: expect.objectContaining({ scheduledAt: "2026-08-07T21:00" }),
    }), undefined);
  });

  it("warns and removes unavailable sales resources from the next saved draft", async () => {
    mocks.liveFindFirst.mockResolvedValue({
      ...live,
      interactionScriptId: null,
      videoId: "video-unready",
      formId: "form-broken",
      products: [{ productId: "product-inactive" }],
    });
    mocks.formFindMany.mockResolvedValue([{
      id: "form-broken",
      name: "缺欄位表單",
      fields: [],
    }]);

    const html = renderToStaticMarkup(await EditLivePage({
      params: Promise.resolve({ id: "live-1" }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain("影片或 Live Input 已無法播放");
    expect(html).toContain("商品已停用或尚未確認履約類型");
    expect(html).toContain("報名表已停用或缺少必要姓名／Email 欄位");
    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: expect.objectContaining({
        videoId: "",
        formId: "",
        productIds: [],
      }),
    }), undefined);
  });

  it("warns and unbinds a live reminder template that is no longer available", async () => {
    mocks.liveFindFirst.mockResolvedValue({
      ...live,
      interactionScriptId: null,
      liveReminderTemplateId: "disabled-reminder",
    });

    const html = renderToStaticMarkup(await EditLivePage({
      params: Promise.resolve({ id: "live-1" }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain("目前綁定的開播提醒模板已停用");
    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: expect.objectContaining({ liveReminderTemplateId: "" }),
    }), undefined);
  });

  it("announces durable reminder reconciliation after an edited schedule is accepted", async () => {
    mocks.liveFindFirst.mockResolvedValue({ ...live, interactionScriptId: null });

    const html = renderToStaticMarkup(await EditLivePage({
      params: Promise.resolve({ id: "live-1" }),
      searchParams: Promise.resolve({ notice: "reminders_reconciling" }),
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("正在分批更新已驗證報名者的開播提醒");
  });

  it("warns and unbinds a notification template that cannot send registration email", async () => {
    mocks.liveFindFirst.mockResolvedValue({ ...live, interactionScriptId: null, messageTemplateId: "legacy-sms" });

    const html = renderToStaticMarkup(await EditLivePage({
      params: Promise.resolve({ id: "live-1" }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain("目前綁定的通知模板不是啟用中的");
    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: expect.objectContaining({ messageTemplateId: "" }),
    }), undefined);
  });

  it("loads the current optimistic edit revision without creating a second writer", async () => {
    mocks.draftFindFirst.mockResolvedValue({
      id: "draft-live-1",
      revision: 7,
      payload: {
        ...emptyLiveStudioDraft(),
        title: "草稿中的標題",
        scheduledAt: "2026-08-09T10:00",
        replayEnabled: false,
      },
      updatedAt: new Date("2026-08-08T02:00:00.000Z"),
    });

    renderToStaticMarkup(await EditLivePage({
      params: Promise.resolve({ id: "live-1" }),
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.draftFindFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", liveId: "live-1", consumedAt: null, expiresAt: { gt: expect.any(Date) } },
      select: { id: true, revision: true, payload: true, updatedAt: true },
    });
    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      initialDraft: expect.objectContaining({
        id: "draft-live-1",
        revision: 7,
        payload: expect.objectContaining({ scheduledAt: "2026-08-09T10:00" }),
      }),
    }), undefined);
  });

  it("provides tenant-scoped Stream allocation choices without serializing member email", async () => {
    mocks.teamMembershipFindMany.mockResolvedValue([{
      id: "member-1",
      teamId: "team-1",
      team: { name: "北區團隊" },
      vendorMember: { user: { name: "王小明" } },
    }]);
    mocks.partnerFunnelPageFindMany.mockResolvedValue([{ id: "page-1", slug: "summer", headline: "夏日推廣頁" }]);

    renderToStaticMarkup(await EditLivePage({
      params: Promise.resolve({ id: "live-1" }),
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      streamMembers: [{ id: "member-1", teamId: "team-1", label: "北區團隊 · 王小明" }],
      streamPages: [{ id: "page-1", label: "夏日推廣頁 · /summer" }],
    }), undefined);
  });
});
