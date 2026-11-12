import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManagerContext: vi.fn(),
  paymentMethodCount: vi.fn(),
  productCount: vi.fn(),
  formFindMany: vi.fn(),
  roleCount: vi.fn(),
  scriptCount: vi.fn(),
  templateFindMany: vi.fn(),
  videoCount: vi.fn(),
  liveFindMany: vi.fn(),
  preference: vi.fn(),
  projectFindFirst: vi.fn(),
  taskStates: vi.fn(),
  projectProductCount: vi.fn(),
  projectFormCount: vi.fn(),
  liveCount: vi.fn(),
  consultations: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.requireVendorManagerContext }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    paymentMethodReference: { count: mocks.paymentMethodCount },
    product: { count: mocks.productCount },
    registrationForm: { findMany: mocks.formFindMany, count: mocks.projectFormCount },
    interactionRole: { count: mocks.roleCount },
    interactionScript: { count: mocks.scriptCount },
    messageTemplate: { findMany: mocks.templateFindMany },
    video: { count: mocks.videoCount },
    live: { findMany: mocks.liveFindMany, count: mocks.liveCount },
    userOnboardingPreference: { findUnique: mocks.preference },
    salesProject: { findFirst: mocks.projectFindFirst },
    onboardingTaskState: { findMany: mocks.taskStates },
    salesProjectProduct: { count: mocks.projectProductCount },
    consultationEvent: { findMany: mocks.consultations },
  }),
}));

import OnboardingPage from "./page";
import { sellableLiveReadinessQuery } from "@/lib/sellable-live";

const vendor = {
  betaFeatureGrants: ["courses", "billing", "funnel_binding", "consultation_booking", "browser_live", "danmaku"],
  id: "vendor-onboarding",
  supportEmail: "support@example.test",
  tracking: { googleTagManagerId: "GTM-SYNTHETIC", facebookPixelId: null, tiktokPixelId: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManagerContext.mockResolvedValue({ auth: { user: { id: "user-onboarding" } }, vendor });
  mocks.preference.mockResolvedValue(null);
  mocks.taskStates.mockResolvedValue([]);
  mocks.consultations.mockResolvedValue([]);
  for (const count of [
    mocks.paymentMethodCount,
    mocks.productCount,
    mocks.roleCount,
    mocks.scriptCount,
  ]) count.mockResolvedValue(1);
  mocks.formFindMany.mockResolvedValue([{ fields: [
    { key: "name", label: "姓名", type: "text", required: true },
    { key: "email", label: "Email", type: "email", required: true },
  ] }]);
  mocks.templateFindMany.mockResolvedValue([{ subject: "報名成功", body: "內容" }]);
  mocks.videoCount.mockResolvedValue(1);
  mocks.liveFindMany.mockResolvedValue([{
    scheduledAt: new Date("2026-08-18T08:00:00.000Z"),
    status: "live",
    startedAt: new Date("2026-08-18T08:00:00.000Z"),
    endedAt: null,
    replayAvailableUntil: null,
    replayEnabled: true,
    streamMode: "live",
    video: {
      durationSec: null,
      sourceType: "url",
      status: "ready",
      cloudflareReadyToStream: false,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    },
    form: { fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ] },
    messageTemplate: { subject: "報名成功", body: "內容" },
  }]);
});

describe("/onboarding route", () => {
  it("derives a complete refresh-safe journey from tenant-scoped sellable data", async () => {
    const html = renderToStaticMarkup(await OnboardingPage());

    expect(mocks.requireVendorManagerContext).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.preference).toHaveBeenCalledWith({ where: { userId_vendorId: { userId: "user-onboarding", vendorId: vendor.id } }, select: { selectedProjectId: true } });
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
    expect(mocks.paymentMethodCount).toHaveBeenCalledWith({
      where: {
        vendorId: vendor.id,
        scopeType: "VENDOR",
        membershipId: null,
        status: "verified",
        verifiedAt: { not: null, lte: expect.any(Date) },
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
    });
    // Readiness reads stop at the first usable row (batches of ONBOARDING_READINESS_BATCH_SIZE, by id).
    const live = sellableLiveReadinessQuery(vendor.id);
    expect(mocks.liveFindMany).toHaveBeenCalledExactlyOnceWith({ where: live.where, select: { ...live.select, id: true }, orderBy: { id: "asc" }, take: 50 });
    expect(mocks.formFindMany).toHaveBeenCalledExactlyOnceWith({ where: { vendorId: vendor.id, isActive: true }, select: { id: true, fields: true }, orderBy: { id: "asc" }, take: 50 });
    expect(html).toContain(">上線導引<");
    expect(html).toContain("5 / 5");
    expect(html).toContain("核心流程完成");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("不取代法務、財務、客服回覆時限、外部監控或上線負責人簽核");
  });

  it("does not claim launch readiness when the live has no playable media", async () => {
    mocks.liveFindMany.mockResolvedValue([{
      video: null,
      form: { fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ] },
      messageTemplate: { subject: "報名成功", body: "內容" },
    }]);

    const html = renderToStaticMarkup(await OnboardingPage());

    expect(html).toContain("4 / 5");
    expect(html).not.toContain("核心流程完成");
    expect(html).toContain("可播放媒體");
    expect(html).toContain('aria-valuenow="80"');
  });

  it("links directly to the first missing persisted requirement", async () => {
    mocks.requireVendorManagerContext.mockResolvedValue({ auth: { user: { id: "user-onboarding" } }, vendor: { ...vendor, supportEmail: null, tracking: null } });
    for (const count of [
      mocks.paymentMethodCount,
      mocks.productCount,
      mocks.roleCount,
      mocks.scriptCount,
    ]) count.mockResolvedValue(0);
    mocks.formFindMany.mockResolvedValue([]);
    mocks.templateFindMany.mockResolvedValue([]);
    mocks.videoCount.mockResolvedValue(0);
    mocks.liveFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await OnboardingPage());

    expect(html).toContain("0 / 5");
    expect(html).toContain("繼續：設定商店資料");
    expect(html).toContain('href="/settings/brand"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain("選配");
    expect(html).toContain("準備可播放媒體");
    expect(html).toContain('href="/videos/new"');
  });

  it("does not count malformed forms or empty Email templates as launch-ready resources", async () => {
    mocks.paymentMethodCount.mockResolvedValue(0);
    mocks.formFindMany.mockResolvedValue([{ fields: [{ key: "nickname", label: "暱稱", type: "text", required: false }] }]);
    mocks.templateFindMany.mockResolvedValue([{ subject: "", body: "" }]);
    mocks.liveFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await OnboardingPage());

    expect(html).toContain("準備有效報名表單");
    expect(html).toContain("啟用報名成功 Email");
    expect(html).toContain("外部驗證，可稍後");
  });

  it("adds the selected project's publish tasks as the last step, bound to this vendor", async () => {
    mocks.preference.mockResolvedValue({ selectedProjectId: "project-onboarding" });
    mocks.projectFindFirst.mockResolvedValue({ id: "project-onboarding", name: "春季講座", primaryFlow: "live", publishedAt: null });
    mocks.projectProductCount.mockResolvedValue(1);
    mocks.projectFormCount.mockResolvedValue(0);
    mocks.liveCount.mockResolvedValue(1);

    const html = renderToStaticMarkup(await OnboardingPage());

    expect(mocks.projectFindFirst).toHaveBeenCalledWith({ where: { id: "project-onboarding", vendorId: vendor.id, status: { not: "archived" } }, select: { id: true, name: true, primaryFlow: true, publishedAt: true } });
    for (const query of [mocks.projectProductCount, mocks.projectFormCount, mocks.liveCount, mocks.consultations]) {
      expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: vendor.id, projectId: "project-onboarding" }) }));
    }
    expect(mocks.taskStates).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: vendor.id, scopeKey: "project-onboarding" } }));
    expect(html).toContain("5 / 6");
    expect(html).toContain("Step 6. 發布專案「春季講座」");
    expect(html).toContain("建立報名表單");
    expect(html).not.toContain("選擇漏斗頁模板");
    expect(html).toContain("繼續：建立報名表單");
    expect(html).toContain('href="/forms/new"');
  });

  it("shows the sellable-live step as not applicable for a consultation project", async () => {
    mocks.preference.mockResolvedValue({ selectedProjectId: "project-consult" });
    mocks.projectFindFirst.mockResolvedValue({ id: "project-consult", name: "一對一諮詢", primaryFlow: "consultation", publishedAt: null });
    mocks.projectProductCount.mockResolvedValue(0);
    mocks.projectFormCount.mockResolvedValue(0);
    mocks.liveCount.mockResolvedValue(0);
    mocks.liveFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await OnboardingPage());

    expect(html).toContain("諮詢專案不適用");
    // 4 applicable merchant steps done + the unfinished project step.
    expect(html).toContain("4 / 5");
    expect(html).toContain("繼續：建立諮詢服務");
  });
});
