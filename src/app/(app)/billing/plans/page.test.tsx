import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  requireVendorFinance: vi.fn(),
  getCsrfToken: vi.fn(),
  paymentTransactionFindFirst: vi.fn(),
  paymentTransactionCount: vi.fn(),
  platformReferralClickFindUnique: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    billingPlan: { findMany: mocks.findMany },
    vendorSubscription: { findFirst: mocks.subscriptionFindFirst },
    paymentTransaction: { findFirst: mocks.paymentTransactionFindFirst, count: mocks.paymentTransactionCount },
    platformReferralClick: { findUnique: mocks.platformReferralClickFindUnique },
  }),
}));
vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import BillingPlansPage from "./page";
import { PAYUNI_STAGING_RETRY_VENDOR_ID, PAYUNI_STAGING_RETRY_TRANSACTION_ID, PAYUNI_STAGING_RETRY_MERCHANT_ID } from "@/lib/payuni-staging-plan-test";

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
  mocks.paymentTransactionCount.mockResolvedValue(0);
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
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/prelaunch-engineering-20260929");
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
  vi.stubEnv("STAGING_DATABASE_URL", "postgresql:" + "//postgres:synthetic@db.ocbugvgojrunvenozsbx.supabase.co/postgres");
}

describe("/billing/plans route", () => {
  it("explains the acknowledged one-order retry while preserving the duplicate payment warning", async () => {
    enableLiveStagingPlans();
    vi.stubEnv("PAYUNI_MERCHANT_ID", PAYUNI_STAGING_RETRY_MERCHANT_ID);
    mocks.requireVendorFinance.mockResolvedValue({ vendor: { id: PAYUNI_STAGING_RETRY_VENDOR_ID }, member: { role: "owner" } });
    mocks.paymentTransactionCount.mockResolvedValue(1);
    const description = `staging-payuni-plan-v1:${JSON.stringify({
      deploymentHost: "staging-test.vercel.app", merchantId: PAYUNI_STAGING_RETRY_MERCHANT_ID, vendorId: PAYUNI_STAGING_RETRY_VENDOR_ID,
      expiresAt: "2099-01-01T00:00:00.000Z", retryAttemptId: "00000000-0000-4000-8000-000000000001", acknowledgedPendingTransactionId: PAYUNI_STAGING_RETRY_TRANSACTION_ID,
    })}`;
    mocks.findMany.mockResolvedValue([100, 200, 300].map((cents, index) => ({
      ...plans[0], id: `retry-plan-${index}`, code: ["staging-payuni-starter", "staging-payuni-growth", "staging-payuni-team-pro"][index],
      monthlyPriceCents: cents, isActive: false, description,
    })));
    const html = renderToStaticMarkup(await BillingPlansPage({}));
    expect(html).toContain("依您的同意");
    expect(html).toContain("建立一筆新付款");
    expect(html).toContain("可能出現兩筆付款");
    expect(html).toContain("無法再換方案重開");
    expect(html).not.toContain("不會自動取消、重送或建立替代付款");
    expect(html).not.toContain(PAYUNI_STAGING_RETRY_TRANSACTION_ID);
    expect(html).not.toContain('action="https://api.payuni.com.tw/api/upp"');
  });

  it("reports unresolved local checkouts only to the tenant owner without exposing or sending a form", async () => {
    enableLiveStagingPlans();
    mocks.paymentTransactionCount.mockResolvedValue(1);
    const html = renderToStaticMarkup(await BillingPlansPage({}));
    expect(html).toContain("不代表 PAYUNi 已收到交易或付款成功");
    expect(html).not.toContain('action="https://api.payuni.com.tw/api/upp"');
    expect(mocks.paymentTransactionCount).toHaveBeenCalledWith({ where: {
      vendorId: "vendor-current", providerName: "payuni", paymentMode: "platform", status: "pending",
    } });
    mocks.paymentTransactionCount.mockClear();
    mocks.requireVendorFinance.mockResolvedValue({ vendor: { id: "vendor-current" }, member: { role: "finance" } });
    expect(renderToStaticMarkup(await BillingPlansPage({}))).not.toContain("尚有待確認的 PAYUNi 付款紀錄");
    expect(mocks.paymentTransactionCount).not.toHaveBeenCalled();
  });
  it("does not attribute a general concurrency conflict to a payment when none is pending", async () => {
    enableLiveStagingPlans();
    const query = { searchParams: Promise.resolve({ error: "conflict" }) };
    const noPending = renderToStaticMarkup(await BillingPlansPage(query));
    expect(noPending).toContain("方案更新發生衝突");
    expect(noPending).not.toContain("舊 PAYUNi 付款結果");
    mocks.paymentTransactionCount.mockResolvedValue(1);
    const pending = renderToStaticMarkup(await BillingPlansPage(query));
    expect(pending).toContain("舊 PAYUNi 付款結果尚未確認");
    expect(pending).not.toContain("方案更新發生衝突");
  });
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
    expect(ready).not.toContain("設定尚未通過檢查");
    mocks.findMany.mockResolvedValue([{ ...plans[0], code: "starter", monthlyPriceCents: 248000 }]);
    const blocked = renderToStaticMarkup(await BillingPlansPage({}));
    expect(blocked).toContain("設定尚未通過檢查");
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
  it("queries only active ordinary plans and excludes global synthetic fixtures", async () => {
    await BillingPlansPage({});

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { OR: [{ isActive: true, id: { not: "wp4_synthetic_plan_v1" } }] },
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
