import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorContext: vi.fn(),
  liveCount: vi.fn(),
  productCount: vi.fn(),
  leadCount: vi.fn(),
  liveChatMessageCount: vi.fn(),
  interactionEventCount: vi.fn(),
  analyticsFindMany: vi.fn(),
  liveFindMany: vi.fn(),
  affiliateFindMany: vi.fn(),
  usageFindUnique: vi.fn(),
  scriptCount: vi.fn(),
  roleCount: vi.fn(),
  paymentMethodReferenceCount: vi.fn(),
  formCount: vi.fn(),
  messageTemplateCount: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorContext: mocks.requireVendorContext }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: { count: mocks.liveCount, findMany: mocks.liveFindMany },
    product: { count: mocks.productCount },
    formSubmission: { count: mocks.leadCount },
    liveChatMessage: { count: mocks.liveChatMessageCount },
    interactionEvent: { count: mocks.interactionEventCount },
    analyticsEvent: { findMany: mocks.analyticsFindMany },
    affiliate: { findMany: mocks.affiliateFindMany },
    vendorUsageLimit: { findUnique: mocks.usageFindUnique },
    interactionScript: { count: mocks.scriptCount },
    interactionRole: { count: mocks.roleCount },
    paymentMethodReference: { count: mocks.paymentMethodReferenceCount },
    registrationForm: { count: mocks.formCount },
    messageTemplate: { count: mocks.messageTemplateCount },
  }),
}));

import DashboardPage from "./page";

const vendor = {
  id: "vendor-dashboard",
  supportEmail: "support@example.test",
  tracking: { googleTagManagerId: "GTM-SYNTHETIC", facebookPixelId: null },
};
const recentLive = {
  id: "live-recent",
  title: "夏日直播",
  status: "published",
  scheduledAt: new Date("2026-08-01T10:00:00.000Z"),
  submissions: [{ verificationStatus: "VERIFIED" }, { verificationStatus: "UNVERIFIED" }],
  products: [],
};
const upcomingLive = {
  id: "live-upcoming",
  title: "下週直播",
  scheduledAt: new Date("2026-08-08T10:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorContext.mockResolvedValue({
    auth: { member: { role: "owner" } },
    vendor,
  });
  mocks.liveCount.mockResolvedValue(2);
  mocks.productCount.mockResolvedValue(3);
  mocks.leadCount.mockResolvedValue(4);
  mocks.liveChatMessageCount.mockResolvedValue(9);
  mocks.interactionEventCount.mockResolvedValue(12);
  mocks.analyticsFindMany.mockResolvedValue([
    ...Array.from({ length: 100 }, (_, index) => ({ eventType: "page_view", visitorId: `view-session-${index}` })),
    ...Array.from({ length: 20 }, (_, index) => ({ eventType: "product_click", visitorId: `product-session-${index}` })),
    ...Array.from({ length: 10 }, (_, index) => ({ eventType: "cta_click", visitorId: `cta-session-${index}` })),
  ]);
  mocks.liveFindMany
    .mockResolvedValueOnce([recentLive])
    .mockResolvedValueOnce([upcomingLive])
    .mockResolvedValueOnce([{
      form: { fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ] },
      messageTemplate: { subject: "報名成功", body: "內容" },
    }]);
  mocks.affiliateFindMany.mockResolvedValue([{ id: "affiliate-1", code: "SUMMER", name: "夏日夥伴", clicks: [{ id: "click-1" }, { id: "click-2" }] }]);
  mocks.usageFindUnique.mockResolvedValue({ creditsUsed: 25, creditsLimit: 100, billingPlan: { name: "商家方案" } });
  mocks.scriptCount.mockResolvedValue(2);
  mocks.roleCount.mockResolvedValue(1);
  mocks.paymentMethodReferenceCount.mockResolvedValue(0);
  mocks.formCount.mockResolvedValue(1);
  mocks.messageTemplateCount.mockResolvedValue(1);
});

describe("/dashboard route", () => {
  it("redirects support to the support queue before dashboard data is queried", async () => {
    mocks.requireVendorContext.mockResolvedValue({ auth: { member: { role: "support" } }, vendor });
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });

    await expect(DashboardPage()).rejects.toThrow("redirect:/support-cases");

    expect(mocks.redirect).toHaveBeenCalledWith("/support-cases");
    expect(mocks.liveCount).not.toHaveBeenCalled();
  });

  it("scopes all dashboard reads to the current vendor and renders populated states", async () => {
    const html = renderToStaticMarkup(await DashboardPage());

    expect(mocks.requireVendorContext).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.liveCount).toHaveBeenCalledWith({ where: { vendorId: vendor.id } });
    expect(mocks.productCount).toHaveBeenCalledWith({ where: { vendorId: vendor.id, isActive: true, fulfillmentTypeConfirmed: true } });
    expect(mocks.leadCount).toHaveBeenCalledWith({
      where: {
        form: { vendorId: vendor.id },
        verificationStatus: "VERIFIED",
        createdAt: { gte: expect.any(Date) },
      },
    });
    expect(mocks.analyticsFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: vendor.id,
        trustLevel: "ADMITTED_LIVE_SESSION",
        eventType: { in: ["page_view", "product_click", "cta_click"] },
        createdAt: { gte: expect.any(Date) },
      },
      select: { eventType: true, visitorId: true },
      distinct: ["eventType", "visitorId"],
    });
    expect(mocks.liveChatMessageCount).toHaveBeenCalledWith({ where: {
      vendorId: vendor.id,
      source: "viewer",
      isSimulated: false,
      status: "visible",
      formSubmissionId: { not: null },
      roleId: null,
      createdAt: { gte: expect.any(Date) },
    } });
    expect(mocks.interactionEventCount).toHaveBeenCalledWith({ where: {
      eventType: { in: ["chat_message", "reminder"] },
      message: { not: null },
      isSimulated: true,
      script: { vendorId: vendor.id, status: "published" },
      role: { is: { vendorId: vendor.id, isActive: true, isScheduled: true } },
    } });
    expect(mocks.scriptCount).toHaveBeenCalledWith({ where: { vendorId: vendor.id, status: "published" } });
    expect(mocks.roleCount).toHaveBeenCalledWith({ where: { vendorId: vendor.id, isActive: true } });
    expect(mocks.paymentMethodReferenceCount).toHaveBeenCalledWith({
      where: {
        vendorId: vendor.id,
        scopeType: "VENDOR",
        membershipId: null,
        status: "verified",
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
    });
    expect(mocks.liveFindMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({
        vendorId: vendor.id,
        form: { is: { vendorId: vendor.id, isActive: true } },
        interactionScript: { is: { vendorId: vendor.id, status: "published" } },
      }),
    }));
    expect(html).toContain("Dashboard");
    expect(html).toContain("夏日直播");
    expect(html).toContain("下週直播");
    expect(html).toContain("夏日夥伴");
    expect(html).toContain("商家方案");
    expect(html).toContain("近 7 天播放 session");
    expect(html).toContain("近 7 天真實留言");
    expect(html).toContain(">9<");
    expect(html).toContain("排程留言腳本（設定數）");
    expect(html).toContain(">12<");
    expect(html).toContain("已通過直播 admission 的不重複播放 session");
    expect(html).toContain("1 已驗證");
    expect(html).toContain("1 待驗證");
    expect(html).toContain("25%");
    expect(html).toContain("完成商家 onboarding");
    expect(html).toContain('href="/onboarding"');
  });

  it("renders empty and non-manager states without manager-only links", async () => {
    mocks.requireVendorContext.mockResolvedValue({ auth: { member: { role: "viewer" } }, vendor: { ...vendor, tracking: null } });
    mocks.liveCount.mockResolvedValue(0);
    mocks.productCount.mockResolvedValue(0);
    mocks.leadCount.mockResolvedValue(0);
    mocks.liveChatMessageCount.mockResolvedValue(0);
    mocks.interactionEventCount.mockResolvedValue(0);
    mocks.analyticsFindMany.mockResolvedValue([]);
    mocks.liveFindMany.mockReset().mockResolvedValue([]);
    mocks.affiliateFindMany.mockResolvedValue([]);
    mocks.usageFindUnique.mockResolvedValue(null);
    mocks.scriptCount.mockResolvedValue(0);
    mocks.roleCount.mockResolvedValue(0);
    mocks.paymentMethodReferenceCount.mockResolvedValue(0);
    mocks.formCount.mockResolvedValue(0);
    mocks.messageTemplateCount.mockResolvedValue(0);

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("目前還沒有直播資料");
    expect(html).toContain("目前沒有排定中的直播");
    expect(html).toContain("尚未建立聯盟來源");
    expect(html).toContain("尚未設定方案");
    expect(html).not.toContain('href="/lives/new"');
    expect(html).not.toContain("查看全部");
  });
});
