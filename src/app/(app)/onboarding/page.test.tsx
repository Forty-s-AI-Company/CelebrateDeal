import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  paymentMethodCount: vi.fn(),
  productCount: vi.fn(),
  formFindMany: vi.fn(),
  roleCount: vi.fn(),
  scriptCount: vi.fn(),
  templateFindMany: vi.fn(),
  videoCount: vi.fn(),
  liveFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    paymentMethodReference: { count: mocks.paymentMethodCount },
    product: { count: mocks.productCount },
    registrationForm: { findMany: mocks.formFindMany },
    interactionRole: { count: mocks.roleCount },
    interactionScript: { count: mocks.scriptCount },
    messageTemplate: { findMany: mocks.templateFindMany },
    video: { count: mocks.videoCount },
    live: { findMany: mocks.liveFindMany },
  }),
}));

import OnboardingPage from "./page";
import { sellableLiveReadinessQuery } from "@/lib/sellable-live";

const vendor = {
  id: "vendor-onboarding",
  supportEmail: "support@example.test",
  tracking: { googleTagManagerId: "GTM-SYNTHETIC", facebookPixelId: null, tiktokPixelId: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue(vendor);
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

    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.paymentMethodCount).toHaveBeenCalledWith({
      where: {
        vendorId: vendor.id,
        scopeType: "VENDOR",
        membershipId: null,
        status: "verified",
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
    });
    expect(mocks.liveFindMany).toHaveBeenCalledWith(sellableLiveReadinessQuery(vendor.id));
    expect(html).toContain("商家上線導引");
    expect(html).toContain("5 / 5");
    expect(html).toContain("核心流程完成");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("不取代法務、財務、客服 SLA、外部監控或 release owner 簽核");
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
    mocks.requireVendorManager.mockResolvedValue({ ...vendor, supportEmail: null, tracking: null });
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
});
