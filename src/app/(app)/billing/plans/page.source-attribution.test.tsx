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

const vendor = { id: "vendor-current", name: "目前商家" };
const activePlan = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([activePlan]);
  mocks.subscriptionFindFirst.mockResolvedValue(null);
  mocks.paymentTransactionFindFirst.mockResolvedValue(null);
  mocks.platformReferralClickFindUnique.mockResolvedValue(null);
  mocks.cookies.mockResolvedValue({ get: () => undefined });
  mocks.getCsrfToken.mockResolvedValue("csrf-test-token");
  mocks.requireVendorFinance.mockResolvedValue({
    vendor,
    member: { id: "member-owner", role: "owner", status: "active" },
  });
});

describe("billing plans source attribution", () => {
  it("renders a sanitized form-post pending checkout for an owner", async () => {
    mocks.subscriptionFindFirst.mockImplementation(async (query) => {
      if (query.where?.status === "pending_payment") return { id: "subscription-pending" };
      return {
        id: "subscription-current",
        planId: "plan-retired",
        plan: { id: "plan-retired", name: "舊方案" },
      };
    });
    mocks.paymentTransactionFindFirst.mockResolvedValue({
      id: "transaction-1",
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: "subscription-pending",
        billingPlanId: activePlan.id,
        checkoutSession: {
          provider: "payuni",
          mode: "form_post",
          formAction: "https://sandbox-api.payuni.com.tw/api/upp",
          checkoutUrl: "https://evil.example/ignored",
          nextAction: "submit",
          formPayload: {
            MerID: "synthetic-merchant",
            Version: "2.0",
            EncryptInfo: "synthetic-encrypted",
            HashInfo: "synthetic-hash",
            unexpected: "must-not-render",
            ignoredNumber: 9900,
            tooLong: "x".repeat(4097),
          },
        },
      },
    });

    const html = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({
        status: "checkout",
        error: ["checkout"],
        transactionId: ["transaction-1", "transaction-2"],
      }),
    }));

    expect(mocks.paymentTransactionFindFirst).toHaveBeenCalledWith({
      where: {
        id: "transaction-1",
        vendorId: vendor.id,
        paymentMode: "platform",
        status: "pending",
      },
      select: { id: true, metadata: true },
    });
    expect(mocks.subscriptionFindFirst).toHaveBeenCalledWith({
      where: {
        id: "subscription-pending",
        vendorId: vendor.id,
        planId: activePlan.id,
        status: "pending_payment",
      },
      select: { id: true },
    });
    expect(mocks.getCsrfToken).toHaveBeenCalledExactlyOnceWith();
    expect(html).toContain("付款頁建立失敗");
    expect(html).toContain("方案付款已建立");
    expect(html).toContain("變更方案");
    expect(html).toContain("https://sandbox-api.payuni.com.tw/api/upp");
    expect(html).toContain('name="MerID" value="synthetic-merchant"');
    expect(html).toContain('name="Version" value="2.0"');
    expect(html).toContain('name="EncryptInfo" value="synthetic-encrypted"');
    expect(html).toContain('name="HashInfo" value="synthetic-hash"');
    expect(html).not.toContain('name="unexpected"');
    expect(html).not.toContain("must-not-render");
    expect(html).not.toContain("ignoredNumber");
    expect(html).not.toContain("tooLong");
    expect(html).not.toContain("evil.example");
  });

  it("renders only an allowlisted redirect and fails closed for an unsafe checkout URL", async () => {
    mocks.subscriptionFindFirst.mockImplementation(async (query) => (
      query.where?.status === "pending_payment" ? { id: "subscription-pending" } : null
    ));
    mocks.paymentTransactionFindFirst.mockResolvedValue({
      id: "transaction-redirect",
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: "subscription-pending",
        billingPlanId: activePlan.id,
        checkoutSession: {
          provider: "payuni",
          mode: "redirect",
          checkoutUrl: "https://sandbox-api.payuni.com.tw/api/upp",
        },
      },
    });

    const redirectHtml = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({ status: "checkout", transactionId: "transaction-redirect" }),
    }));

    expect(redirectHtml).toContain('href="https://sandbox-api.payuni.com.tw/api/upp"');
    expect(redirectHtml).toContain("前往安全付款頁");

    mocks.paymentTransactionFindFirst.mockResolvedValue({
      id: "transaction-unsafe",
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: "subscription-pending",
        billingPlanId: activePlan.id,
        checkoutSession: { provider: "payuni", mode: "manual", checkoutUrl: "https://evil.example/checkout" },
      },
    });

    const fallbackHtml = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({ status: "checkout", transactionId: "transaction-unsafe" }),
    }));

    expect(fallbackHtml).toContain("付款 adapter 尚未提供外部付款頁");
    expect(fallbackHtml).not.toContain("evil.example");
  });

  it("keeps non-owner checkout access read-only and preserves safe default error mapping", async () => {
    mocks.requireVendorFinance.mockResolvedValue({
      vendor,
      member: { id: "member-accountant", role: "accountant", status: "active" },
    });

    const currentHtml = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({ status: "current" }),
    }));
    const html = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({
        status: "changed",
        error: "unexpected-provider-value",
        transactionId: "owner-transaction",
      }),
    }));

    expect(currentHtml).toContain("這已經是目前方案");
    expect(html).toContain("方案已更新");
    expect(html).toContain("方案更新發生衝突");
    expect(html).toContain("僅限商店擁有者異動");
    expect(html).not.toContain('name="planId"');
    expect(mocks.getCsrfToken).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionFindFirst).not.toHaveBeenCalled();
  });

  it("fails closed when a tenant-scoped pending transaction belongs to another billing purpose", async () => {
    mocks.paymentTransactionFindFirst.mockResolvedValue({
      id: "transaction-invoice",
      metadata: {
        billingPurpose: "invoice_payment",
        invoiceId: "invoice-1",
        checkoutSession: {
          provider: "payuni",
          mode: "form_post",
          formAction: "https://sandbox-api.payuni.com.tw/api/upp",
          formPayload: {
            MerID: "synthetic-merchant",
            Version: "2.0",
            EncryptInfo: "synthetic-encrypted",
            HashInfo: "synthetic-hash",
          },
        },
      },
    });

    const html = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({ status: "checkout", transactionId: "transaction-invoice" }),
    }));

    expect(html).toContain("找不到可安全繼續的方案付款");
    expect(html).toContain("系統沒有送出付款資料");
    expect(html).not.toContain('action="https://sandbox-api.payuni.com.tw/api/upp"');
    expect(mocks.subscriptionFindFirst).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "pending_payment" }),
    }));
  });

  it("treats a direct plan URL as a new attribution context even when an old cookie exists", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "stale-click" }) });
    const html = renderToStaticMarkup(await BillingPlansPage({
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.platformReferralClickFindUnique).not.toHaveBeenCalled();
    expect(html).toContain("未記錄推薦人");
    expect(html).toContain("每個新訂閱只計首次成功付款");
    expect(html).not.toContain("platformReferralClickId");
  });
});
