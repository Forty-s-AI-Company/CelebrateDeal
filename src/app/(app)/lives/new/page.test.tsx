import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  getCsrfToken: vi.fn(),
  videoFindMany: vi.fn(),
  productFindMany: vi.fn(),
  registrationFormFindMany: vi.fn(),
  messageTemplateFindMany: vi.fn(),
  interactionScriptFindMany: vi.fn(),
  affiliateFindMany: vi.fn(),
  teamMembershipFindMany: vi.fn(),
  partnerFunnelPageFindMany: vi.fn(),
  liveStudioDraftFindFirst: vi.fn(),
  liveStudioDraftFindMany: vi.fn(),
  liveStepperForm: vi.fn(() => null),
}));

vi.mock("@/lib/auth", () => ({
  requireVendorManager: mocks.requireVendorManager,
}));
vi.mock("@/lib/csrf", () => ({
  getCsrfToken: mocks.getCsrfToken,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    video: { findMany: mocks.videoFindMany },
    product: { findMany: mocks.productFindMany },
    registrationForm: { findMany: mocks.registrationFormFindMany },
    messageTemplate: { findMany: mocks.messageTemplateFindMany },
    interactionScript: { findMany: mocks.interactionScriptFindMany },
    affiliate: { findMany: mocks.affiliateFindMany },
    teamMembership: { findMany: mocks.teamMembershipFindMany },
    partnerFunnelPage: { findMany: mocks.partnerFunnelPageFindMany },
    liveStudioDraft: {
      findFirst: mocks.liveStudioDraftFindFirst,
      findMany: mocks.liveStudioDraftFindMany,
    },
  }),
}));
vi.mock("@/components/live-stepper-form", () => ({
  LiveStepperForm: mocks.liveStepperForm,
}));

import NewLivePage from "./page";
import { liveReadyVideoWhere } from "@/lib/live-video-readiness";
import {
  LIVE_REMINDER_EMAIL_TEMPLATE_WHERE,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
} from "@/lib/message-template";

describe("NewLivePage data minimization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
    mocks.getCsrfToken.mockResolvedValue("csrf-token");
    mocks.liveStudioDraftFindFirst.mockResolvedValue(null);
    mocks.liveStudioDraftFindMany.mockResolvedValue([]);
    for (const mock of [
      mocks.videoFindMany,
      mocks.productFindMany,
      mocks.registrationFormFindMany,
      mocks.messageTemplateFindMany,
      mocks.interactionScriptFindMany,
      mocks.affiliateFindMany,
      mocks.teamMembershipFindMany,
      mocks.partnerFunnelPageFindMany,
    ]) {
      mock.mockResolvedValue([]);
    }
  });

  it("only serializes the video identifier and title into the client form", async () => {
    renderToStaticMarkup(await NewLivePage({ searchParams: Promise.resolve({}) }));

    expect(mocks.videoFindMany).toHaveBeenCalledExactlyOnceWith({
      where: liveReadyVideoWhere("vendor-1"),
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });
    expect(mocks.messageTemplateFindMany).toHaveBeenCalledExactlyOnceWith({
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
    expect(mocks.registrationFormFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", isActive: true },
      select: { id: true, name: true, fields: true },
      orderBy: { createdAt: "desc" },
    });
    expect(mocks.interactionScriptFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", status: "published" },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    });
    expect(mocks.affiliateFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { createdAt: "desc" },
    });
    expect(mocks.teamMembershipFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", status: "ACTIVE", leftAt: null },
      select: {
        id: true,
        teamId: true,
        team: { select: { name: true } },
        vendorMember: { select: { user: { select: { name: true } } } },
      },
      orderBy: [{ teamId: "asc" }, { createdAt: "asc" }],
    });
  });

  it("passes only tenant-scoped member and page labels to the visual Stream editor", async () => {
    mocks.teamMembershipFindMany.mockResolvedValue([{
      id: "member-1",
      teamId: "team-1",
      team: { name: "北區團隊" },
      vendorMember: { user: { name: "王小明" } },
    }]);
    mocks.partnerFunnelPageFindMany.mockResolvedValue([{ id: "page-1", slug: "summer", headline: "夏日推廣頁" }]);

    renderToStaticMarkup(await NewLivePage({ searchParams: Promise.resolve({}) }));

    expect(mocks.partnerFunnelPageFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1" },
      select: { id: true, slug: true, headline: true },
      orderBy: { updatedAt: "desc" },
    });
    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      streamMembers: [{ id: "member-1", teamId: "team-1", label: "北區團隊 · 王小明" }],
      streamPages: [{ id: "page-1", label: "夏日推廣頁 · /summer" }],
    }), undefined);
  });

  it("offers only structurally valid forms and message templates to publish readiness", async () => {
    mocks.registrationFormFindMany.mockResolvedValue([
      {
        id: "form-ready",
        name: "有效表單",
        fields: [
          { key: "name", label: "姓名", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
      },
      { id: "form-broken", name: "缺欄位表單", fields: [] },
    ]);
    mocks.messageTemplateFindMany.mockResolvedValue([
      { id: "template-ready", name: "可寄送", channel: "email", trigger: "registration_confirmed", subject: "報名成功", body: "{{name}} {{unsubscribe_url}}" },
      { id: "template-broken", name: "變數錯誤", channel: "email", trigger: "registration_confirmed", subject: "報名成功", body: "{{unsupported}}" },
    ]);

    renderToStaticMarkup(await NewLivePage({ searchParams: Promise.resolve({}) }));

    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      forms: [{ id: "form-ready", name: "有效表單" }],
      templates: [{ id: "template-ready", name: "可寄送", channel: "email", trigger: "registration_confirmed" }],
    }), undefined);
  });

  it("restores only a current-vendor, unconsumed create draft", async () => {
    mocks.liveStudioDraftFindFirst.mockResolvedValue({
      id: "draft-1",
      revision: 4,
      payload: { title: "可復原直播" },
      updatedAt: new Date("2026-08-08T01:00:00.000Z"),
    });

    renderToStaticMarkup(await NewLivePage({ searchParams: Promise.resolve({ draft: "draft-1" }) }));

    expect(mocks.liveStudioDraftFindFirst).toHaveBeenCalledWith({
      where: {
        id: "draft-1",
        vendorId: "vendor-1",
        liveId: null,
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true, revision: true, payload: true, updatedAt: true },
    });
    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({
      initialDraft: expect.objectContaining({ id: "draft-1", revision: 4 }),
    }), undefined);
  });

  it("offers tenant-scoped unconsumed drafts when the merchant returns without a draft URL", async () => {
    mocks.liveStudioDraftFindMany.mockResolvedValue([
      {
        id: "draft-latest",
        payload: { title: "週五新品直播", activeStep: 3 },
        updatedAt: new Date("2026-08-08T01:00:00.000Z"),
      },
      {
        id: "draft-earlier",
        payload: { title: "會員回饋場", activeStep: 1 },
        updatedAt: new Date("2026-08-07T01:00:00.000Z"),
      },
    ]);

    const html = renderToStaticMarkup(await NewLivePage({ searchParams: Promise.resolve({}) }));

    expect(mocks.liveStudioDraftFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        liveId: null,
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true, payload: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 3,
    });
    expect(html).toContain("找到未完成的直播草稿");
    expect(html).toContain("週五新品直播");
    expect(html).toContain("第 4 步：直播與互動");
    expect(html).toContain("/lives/new?draft=draft-latest");
    expect(html).toContain("會員回饋場");
    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({ initialDraft: undefined }), undefined);
  });

  it("does not load an unavailable draft and explains how to recover", async () => {
    mocks.liveStudioDraftFindMany.mockResolvedValue([{
      id: "draft-current",
      payload: { title: "仍可續作", activeStep: 2 },
      updatedAt: new Date("2026-08-08T01:00:00.000Z"),
    }]);

    const html = renderToStaticMarkup(await NewLivePage({
      searchParams: Promise.resolve({ draft: "draft-expired" }),
    }));

    expect(html).toContain("指定的直播草稿已失效、已完成或不屬於目前商店");
    expect(html).toContain("仍可續作");
    expect(mocks.liveStepperForm).toHaveBeenCalledWith(expect.objectContaining({ initialDraft: undefined }), undefined);
  });
});
