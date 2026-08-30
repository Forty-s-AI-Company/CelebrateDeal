import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  requireVendorFinance: vi.fn(),
  getCsrfToken: vi.fn(),
  paymentTransactionFindFirst: vi.fn(),
  platformReferralClickFindUnique: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    billingPlan: { findMany: mocks.findMany },
    vendorSubscription: { findFirst: mocks.subscriptionFindFirst },
    paymentTransaction: { findFirst: mocks.paymentTransactionFindFirst },
    platformReferralClick: { findUnique: mocks.platformReferralClickFindUnique },
  }),
}));
vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import BillingPlansPage from "./page";

const plans = [
  {
    id: "plan-active",
    code: "ACTIVE",
    name: "可用方案",
    description: "仍可購買的方案",
    isActive: true,
    monthlyPriceCents: 9900,
    includedStreamMinutes: 6000,
    includedEvents: 10,
    includedAffiliates: 50,
    includedStorageMinutes: 1200,
    includedCredits: 500,
    paymentServiceFeeCents: 300,
    transactionFeeRateBps: 250,
    overflowWatchHourPriceCents: 500,
    overflowEventUnitPriceCents: 1000,
    overflowAffiliateUnitPriceCents: 200,
    overflowStorageMinutePriceCents: 3,
  },
  {
    id: "plan-retired",
    code: "RETIRED",
    name: "停售方案",
    description: "已停止銷售的方案",
    isActive: false,
    monthlyPriceCents: 4900,
    includedStreamMinutes: 3000,
    includedEvents: 5,
    includedAffiliates: 20,
    includedStorageMinutes: 600,
    includedCredits: 200,
    paymentServiceFeeCents: 100,
    transactionFeeRateBps: 300,
    overflowWatchHourPriceCents: 300,
    overflowEventUnitPriceCents: 800,
    overflowAffiliateUnitPriceCents: 100,
    overflowStorageMinutePriceCents: 2,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockImplementation(async (query) =>
    plans.filter((plan) => !query.where?.isActive || plan.isActive),
  );
  mocks.subscriptionFindFirst.mockResolvedValue(null);
  mocks.paymentTransactionFindFirst.mockResolvedValue(null);
  mocks.platformReferralClickFindUnique.mockResolvedValue(null);
  mocks.cookies.mockResolvedValue({ get: () => undefined });
  mocks.getCsrfToken.mockResolvedValue("csrf-test-token");
  mocks.requireVendorFinance.mockResolvedValue({
    vendor: { id: "vendor-current" },
    member: { id: "member-owner", role: "owner", status: "active" },
  });
});

describe("/billing/plans route", () => {
  it("queries only active billing plans", async () => {
    await BillingPlansPage({});

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { monthlyPriceCents: "asc" },
    });
    expect(mocks.subscriptionFindFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", status: "active" },
      include: { plan: true },
      orderBy: { startedAt: "desc" },
    });
  });

  it("renders active plans while preserving their prices and quotas", async () => {
    const html = renderToStaticMarkup(await BillingPlansPage({}));

    expect(html).toContain("可用方案");
    expect(html).toContain("仍可購買的方案");
    expect(html).toContain("$99");
    expect(html).toContain("100 小時 / 月");
    expect(html).toContain("10 場 / 月");
    expect(html).toContain("50 人");
    expect(html).not.toContain("停售方案");
    expect(html).not.toContain("已停止銷售的方案");
    expect(html).not.toContain("RETIRED");
    expect(html).toContain("選擇方案");
    expect(html).toContain('name="planId" value="plan-active"');
    expect(html).toContain('name="_csrf" value="csrf-test-token"');
    expect(html).toContain("pending 交易");
    expect(html).toContain("Stream 包含額度用完後會暫停新播放");
    expect(html).toContain("未啟用自動超額扣款");
    expect(html).toContain("儲存每 100 分鐘 $3");
  });

  it("marks the active subscription and does not render another purchase action", async () => {
    mocks.subscriptionFindFirst.mockResolvedValue({
      id: "subscription-current",
      planId: "plan-active",
      plan: plans[0],
    });

    const html = renderToStaticMarkup(await BillingPlansPage({}));

    expect(html).toContain("目前方案");
    expect(html).not.toContain("變更方案");
  });

  it("allows non-owners to view prices but not change the subscription", async () => {
    mocks.requireVendorFinance.mockResolvedValue({
      vendor: { id: "vendor-current" },
      member: { id: "member-accountant", role: "accountant", status: "active" },
    });

    const html = renderToStaticMarkup(await BillingPlansPage({}));

    expect(html).toContain("可用方案");
    expect(html).toContain("僅限商店擁有者異動");
    expect(html).not.toContain('name="planId"');
    expect(mocks.getCsrfToken).not.toHaveBeenCalled();
  });

  it("renders success and unavailable feedback from safe query states", async () => {
    const successHtml = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({ status: "changed" }),
    }));
    const errorHtml = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({ error: "unavailable" }),
    }));
    const providerHtml = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({ error: "provider_not_configured" }),
    }));

    expect(successHtml).toContain("方案已更新");
    expect(errorHtml).toContain("方案不存在或已停止銷售");
    expect(providerHtml).toContain("平台付款服務尚未完成設定");
  });

  it("shows a server-validated readonly platform referrer and carries it into checkout", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "click-platform-1" }) });
    mocks.platformReferralClickFindUnique.mockResolvedValue({
      id: "click-platform-1",
      expiresAt: new Date(Date.now() + 60_000),
      referralCode: { code: "AFF-A001", isActive: true, owner: { name: "王小明" } },
    });

    const html = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({ referral: "1" }),
    }));

    expect(html).toContain("推薦人 ID");
    expect(html).toContain("AFF-A001");
    expect(html).toContain("王小明");
    expect(html).toContain("已記錄");
    expect(html).toContain('name="platformReferralClickId" value="click-platform-1"');
  });
});
