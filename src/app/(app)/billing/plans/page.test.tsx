import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => vi.unstubAllEnvs());

function enableLiveStagingPlans() {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "production");
  vi.stubEnv("PAYMENT_PROVIDER", "payuni");
  vi.stubEnv("PAYUNI_STAGING_PLAN_TEST_ENABLED", "true");
  vi.stubEnv("PAYUNI_STAGING_PLAN_TEST_VENDOR_ID", "vendor-current");
  vi.stubEnv("VERCEL_URL", "staging-test.vercel.app");
  vi.stubEnv("PAYUNI_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_HASH_KEY", "12345678901234567890123456789012");
  vi.stubEnv("PAYUNI_HASH_IV", "1234567890123456");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://celebrate-deal-staging.carry-digital-nomad.in.net");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ocbugvgojrunvenozsbx.supabase.co");
  vi.stubEnv("DATABASE_URL", "postgresql:" + "//postgres.ocbugvgojrunvenozsbx:synthetic@aws-0-ap-northeast-1.pooler.supabase.com/postgres");
  vi.stubEnv("DIRECT_URL", "postgresql:" + "//postgres:synthetic@db.ocbugvgojrunvenozsbx.supabase.co/postgres");
}

describe("/billing/plans route", () => {
  it("shows 1, 2 and 3 TWD only when all scoped staging prices are ready", async () => {
    enableLiveStagingPlans();
    const description = `staging-payuni-plan-v1:${JSON.stringify({ deploymentHost: "staging-test.vercel.app", merchantId: "TESTMER", vendorId: "vendor-current", expiresAt: "2099-01-01T00:00:00.000Z" })}`;
    mocks.findMany.mockResolvedValue([
      { ...plans[0], id: "starter", code: "staging-payuni-starter", name: "Starter", monthlyPriceCents: 100, isActive: false, description },
      { ...plans[0], id: "growth", code: "staging-payuni-growth", name: "Growth", monthlyPriceCents: 200, isActive: false, description },
      { ...plans[0], id: "team", code: "staging-payuni-team-pro", name: "Team / Pro", monthlyPriceCents: 300, isActive: false, description },
    ]);
    const ready = renderToStaticMarkup(await BillingPlansPage({}));
    expect(ready).toContain("$1");
    expect(ready).toContain("$2");
    expect(ready).toContain("$3");
    expect(ready).not.toContain("尚未完成隔離設定");
    mocks.findMany.mockResolvedValue([{ ...plans[0], code: "starter", monthlyPriceCents: 248000 }]);
    const blocked = renderToStaticMarkup(await BillingPlansPage({}));
    expect(blocked).toContain("尚未完成隔離設定");
    expect(blocked).not.toContain("$2,480");
  });

  it("hides an existing production payment form when the staging test switch is closed", async () => {
    enableLiveStagingPlans();
    vi.stubEnv("PAYUNI_STAGING_PLAN_TEST_ENABLED", "false");
    mocks.paymentTransactionFindFirst.mockResolvedValue({
      id: "pending-transaction", grossAmountCents: 100,
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: "pending-subscription",
        billingPlanId: "starter-id",
        checkoutSession: { provider: "payuni", mode: "form_post", nextAction: "submit_payuni_upp_form", formMethod: "POST", formAction: "https://api.payuni.com.tw/api/upp", formPayload: { MerID: "TESTMER", Version: "2.0", EncryptInfo: "synthetic", HashInfo: "synthetic" } },
      },
    });
    mocks.subscriptionFindFirst.mockImplementation(async (query) => query.where?.status === "pending_payment"
      ? { id: "pending-subscription", plan: { code: "starter", monthlyPriceCents: 100 } }
      : null);
    const html = renderToStaticMarkup(await BillingPlansPage({ searchParams: Promise.resolve({ status: "checkout", transactionId: "pending-transaction" }) }));
    expect(html).toContain("找不到可安全繼續的方案付款");
    expect(html).not.toContain('action="https://api.payuni.com.tw/api/upp"');
  });
  it("renders only a pending form whose permit matches the current deployment and plan", async () => {
    enableLiveStagingPlans();
    const permit = `staging-payuni-plan-v1:${JSON.stringify({ deploymentHost: "staging-test.vercel.app", merchantId: "TESTMER", vendorId: "vendor-current", expiresAt: "2099-01-01T00:00:00.000Z" })}`;
    mocks.paymentTransactionFindFirst.mockResolvedValue({
      id: "pending-transaction", grossAmountCents: 100,
      metadata: {
        billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "pending-subscription",
        billingPlanId: "starter-id", stagingPayUniPlanPermit: permit,
        checkoutSession: { provider: "payuni", mode: "form_post", nextAction: "submit_payuni_upp_form", formMethod: "POST", formAction: "https://api.payuni.com.tw/api/upp", formPayload: { MerID: "TESTMER", Version: "2.0", EncryptInfo: "synthetic", HashInfo: "synthetic" } },
      },
    });
    mocks.subscriptionFindFirst.mockImplementation(async (query) => query.where?.status === "pending_payment"
      ? { id: "pending-subscription", plan: { code: "staging-payuni-starter", monthlyPriceCents: 100, isActive: false, description: permit } }
      : null);
    const query = { searchParams: Promise.resolve({ status: "checkout", transactionId: "pending-transaction" }) };
    const ready = renderToStaticMarkup(await BillingPlansPage(query));
    expect(ready).toContain('action="https://api.payuni.com.tw/api/upp"');
    mocks.paymentTransactionFindFirst.mockResolvedValueOnce({
      id: "pending-transaction", grossAmountCents: 100,
      metadata: { billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "pending-subscription", billingPlanId: "starter-id", stagingPayUniPlanPermit: "old-permit", checkoutSession: { provider: "payuni", mode: "form_post", nextAction: "submit_payuni_upp_form", formMethod: "POST", formAction: "https://api.payuni.com.tw/api/upp", formPayload: { MerID: "TESTMER", Version: "2.0", EncryptInfo: "synthetic", HashInfo: "synthetic" } } },
    });
    const stale = renderToStaticMarkup(await BillingPlansPage(query));
    expect(stale).not.toContain('action="https://api.payuni.com.tw/api/upp"');
  });
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
