import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorOwnerFinance: vi.fn(),
  requestAuditMeta: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  transaction: vi.fn(),
  billingPlanFindFirst: vi.fn(),
  subscriptionFindMany: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  subscriptionCreate: vi.fn(),
  usageLimitUpsert: vi.fn(),
  auditLogCreate: vi.fn(),
  cookies: vi.fn(),
  capturePlatformReferralAttribution: vi.fn(),
  getPaymentProvider: vi.fn(),
  paymentTransactionCreate: vi.fn(),
  paymentTransactionFindUnique: vi.fn(),
  paymentTransactionFindFirst: vi.fn(),
  paymentTransactionUpdateMany: vi.fn(),
  paymentTransactionUpdate: vi.fn(),
  platformReferralAttributionDeleteMany: vi.fn(),
  createCheckoutSession: vi.fn(),
  checkoutReadiness: vi.fn(),
  webhookEventCount: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorOwnerFinance: mocks.requireVendorOwnerFinance }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  requestAuditMeta: mocks.requestAuditMeta,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/platform-referral", () => ({
  PLATFORM_REFERRAL_COOKIE: "celebratedeal_platform_referral",
  capturePlatformReferralAttribution: mocks.capturePlatformReferralAttribution,
}));
vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    $transaction: mocks.transaction,
    paymentTransaction: { update: mocks.paymentTransactionUpdate },
  }),
}));

import { selectBillingPlanAction } from "./actions";
import {
  PAYUNI_STAGING_RETRY_VENDOR_ID,
  PAYUNI_STAGING_RETRY_TRANSACTION_ID,
  PAYUNI_STAGING_RETRY_ORDER_NUMBER,
  PAYUNI_STAGING_RETRY_MERCHANT_ID,
} from "@/lib/payuni-staging-plan-test";

const plan = {
  id: "plan-pro",
  code: "PRO",
  name: "專業方案",
  isActive: true,
  monthlyPriceCents: 19900,
  includedStreamMinutes: 6000,
  includedStorageMinutes: 1200,
  includedCredits: 500,
};

const previousSubscription = {
  id: "subscription-old",
  vendorId: "vendor-current",
  planId: "plan-basic",
  paymentMode: "platform",
  billingCycleDay: 8,
  status: "active",
  startedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const createdSubscription = {
  ...previousSubscription,
  id: "subscription-new",
  planId: plan.id,
  status: "pending_payment",
};

const createdTransaction = {
  id: "transaction-plan-checkout",
  orderNumber: "CD-20260807010101-ABC123",
  vendorId: "vendor-current",
  providerName: "demo",
  grossAmountCents: plan.monthlyPriceCents,
  paymentMode: "platform",
  status: "pending",
};

function formData(platformReferralClickId?: string) {
  const data = new FormData();
  data.set("_csrf", "valid-token");
  data.set("planId", plan.id);
  data.set("monthlyPriceCents", "1");
  data.set("vendorId", "vendor-attacker");
  if (platformReferralClickId) data.set("platformReferralClickId", platformReferralClickId);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireVendorOwnerFinance.mockResolvedValue({
    vendor: { id: "vendor-current" },
    member: { id: "member-owner", role: "owner" },
  });
  mocks.billingPlanFindFirst.mockResolvedValue(plan);
  mocks.subscriptionFindMany.mockResolvedValue([previousSubscription]);
  mocks.subscriptionFindUnique.mockResolvedValue(null);
  mocks.subscriptionFindFirst.mockResolvedValue(null);
  mocks.subscriptionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.subscriptionCreate.mockResolvedValue(createdSubscription);
  mocks.paymentTransactionCreate.mockResolvedValue(createdTransaction);
  mocks.paymentTransactionFindUnique.mockResolvedValue(null);
  mocks.paymentTransactionFindFirst.mockResolvedValue(null);
  mocks.webhookEventCount.mockResolvedValue(0);
  mocks.paymentTransactionUpdate.mockResolvedValue(createdTransaction);
  mocks.createCheckoutSession.mockResolvedValue({
    provider: "demo",
    mode: "manual",
    checkoutUrl: null,
    nextAction: "demo_checkout_transaction_created",
    formPayload: { orderNumber: createdTransaction.orderNumber, transactionId: createdTransaction.id },
    externalRequired: false,
  });
  mocks.checkoutReadiness.mockReturnValue("local_only");
  mocks.getPaymentProvider.mockReturnValue({
    id: "demo",
    checkoutReadiness: mocks.checkoutReadiness,
    createCheckoutSession: mocks.createCheckoutSession,
  });
  mocks.usageLimitUpsert.mockResolvedValue({ id: "limit-current" });
  mocks.auditLogCreate.mockResolvedValue({ id: "audit-plan-change" });
  mocks.requestAuditMeta.mockResolvedValue({ ipAddress: "203.0.113.5", userAgent: "test-agent" });
  mocks.cookies.mockResolvedValue({ get: () => undefined });
  mocks.transaction.mockImplementation(async (callback) => callback({
    billingPlan: { findFirst: mocks.billingPlanFindFirst },
    vendorSubscription: {
      findMany: mocks.subscriptionFindMany,
      findUnique: mocks.subscriptionFindUnique,
      findFirst: mocks.subscriptionFindFirst,
      updateMany: mocks.subscriptionUpdateMany,
      create: mocks.subscriptionCreate,
    },
    paymentTransaction: {
      create: mocks.paymentTransactionCreate,
      findUnique: mocks.paymentTransactionFindUnique,
      findFirst: mocks.paymentTransactionFindFirst,
      updateMany: mocks.paymentTransactionUpdateMany,
      update: mocks.paymentTransactionUpdate,
    },
    platformReferralAttribution: { deleteMany: mocks.platformReferralAttributionDeleteMany },
    webhookEvent: { count: mocks.webhookEventCount },
    vendorUsageLimit: { upsert: mocks.usageLimitUpsert },
    auditLog: { create: mocks.auditLogCreate },
  }));
});

const retryAttemptId = "00000000-0000-4000-8000-000000000001";

function enableAcknowledgedRetry(cents = 100) {
  enableStagingLivePlanTest();
  vi.stubEnv("PAYUNI_MERCHANT_ID", PAYUNI_STAGING_RETRY_MERCHANT_ID);
  mocks.requireVendorOwnerFinance.mockResolvedValue({
    vendor: { id: PAYUNI_STAGING_RETRY_VENDOR_ID }, member: { id: "member-owner", role: "owner" },
  });
  const permitData = {
    deploymentHost: "staging-test.vercel.app", merchantId: PAYUNI_STAGING_RETRY_MERCHANT_ID,
    vendorId: PAYUNI_STAGING_RETRY_VENDOR_ID, expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const permit = `staging-payuni-plan-v1:${JSON.stringify({ ...permitData, retryAttemptId, acknowledgedPendingTransactionId: PAYUNI_STAGING_RETRY_TRANSACTION_ID })}`;
  const oldPermit = `staging-payuni-plan-v1:${JSON.stringify({ ...permitData, expiresAt: "2000-01-01T00:00:00.000Z" })}`;
  const selectedPlan = {
    ...plan, code: cents === 100 ? "staging-payuni-starter" : cents === 200 ? "staging-payuni-growth" : "staging-payuni-team-pro",
    monthlyPriceCents: cents, isActive: false, description: permit,
  };
  const acknowledgedSubscription = {
    id: "acknowledged-subscription", vendorId: PAYUNI_STAGING_RETRY_VENDOR_ID, planId: "acknowledged-plan", status: "pending_payment",
    plan: { ...plan, id: "acknowledged-plan", code: "staging-payuni-starter", monthlyPriceCents: 100, isActive: false },
  };
  const acknowledged = {
    ...createdTransaction, id: PAYUNI_STAGING_RETRY_TRANSACTION_ID, vendorId: PAYUNI_STAGING_RETRY_VENDOR_ID,
    orderNumber: PAYUNI_STAGING_RETRY_ORDER_NUMBER, providerName: "payuni", providerTradeNo: null, currency: "TWD", grossAmountCents: 100,
    checkoutIdempotencyKey: `platform-plan:v1:${PAYUNI_STAGING_RETRY_VENDOR_ID}:acknowledged-plan`,
    metadata: {
      billingPurpose: "platform_subscription_checkout", platformSubscriptionId: acknowledgedSubscription.id,
      billingPlanId: "acknowledged-plan", billingPlanCode: "staging-payuni-starter", stagingPayUniPlanPermit: oldPermit,
      checkoutSession: { provider: "payuni", mode: "form_post", formMethod: "POST", formAction: "https://api.payuni.com.tw/api/upp", formPayload: { MerID: PAYUNI_STAGING_RETRY_MERCHANT_ID, EncryptInfo: "old-synthetic-never-resubmit" } },
    },
  };
  const subscription = { ...createdSubscription, vendorId: PAYUNI_STAGING_RETRY_VENDOR_ID, plan: selectedPlan };
  mocks.billingPlanFindFirst.mockResolvedValue(selectedPlan);
  mocks.subscriptionFindMany.mockResolvedValue([]);
  mocks.subscriptionFindUnique.mockImplementation(async ({ where }) => where.id === acknowledgedSubscription.id ? acknowledgedSubscription : subscription);
  mocks.paymentTransactionFindUnique.mockImplementation(async ({ where }) => where.id === acknowledged.id ? acknowledged : null);
  mocks.subscriptionCreate.mockResolvedValue(subscription);
  mocks.paymentTransactionCreate.mockImplementation(async ({ data }) => ({ ...createdTransaction, currency: "TWD", ...data }));
  return { acknowledged, acknowledgedSubscription, selectedPlan, subscription, permit };
}

describe("one owner-acknowledged staging retry", () => {
  it.each([100, 200, 300])("creates one new %i-cent order while preserving the unresolved old payment", async (cents) => {
    const { acknowledged, permit } = enableAcknowledgedRetry(cents);
    const originalSnapshot = structuredClone(acknowledged);
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("status=checkout");
    const data = mocks.paymentTransactionCreate.mock.calls[0]?.[0].data;
    expect(data.grossAmountCents).toBe(cents);
    expect(data.orderNumber).not.toBe(PAYUNI_STAGING_RETRY_ORDER_NUMBER);
    expect(data.checkoutIdempotencyKey).toBe(`platform-plan:staging-retry:v1:${PAYUNI_STAGING_RETRY_VENDOR_ID}:${retryAttemptId}`);
    expect(data.metadata).toMatchObject({
      stagingPayUniPlanPermit: permit, stagingPayUniRetryAttemptId: retryAttemptId,
      stagingPayUniAcknowledgedPendingTransactionId: PAYUNI_STAGING_RETRY_TRANSACTION_ID,
    });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledWith({
      where: { id: createdTransaction.id }, data: { metadata: expect.objectContaining(data.metadata) },
    });
    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { vendorId: PAYUNI_STAGING_RETRY_VENDOR_ID, status: "pending_payment" },
      data: { status: "payment_superseded", endedAt: expect.any(Date) },
    });
    expect(acknowledged).toEqual(originalSnapshot);
    expect(mocks.paymentTransactionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession.mock.calls[0]?.[0].transaction.id).toBe(createdTransaction.id);
    expect(JSON.stringify(mocks.createCheckoutSession.mock.calls)).not.toContain("old-synthetic-never-resubmit");
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("reuses only the same new order on a second submission, including after a late old result", async () => {
    const fixture = enableAcknowledgedRetry();
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("status=checkout");
    const data = mocks.paymentTransactionCreate.mock.calls[0]?.[0].data;
    const saved = { ...createdTransaction, currency: "TWD", ...data, metadata: mocks.paymentTransactionUpdate.mock.calls[0]?.[0].data.metadata };
    mocks.paymentTransactionFindFirst.mockImplementation(async ({ where }) => where.metadata ? saved : null);
    fixture.acknowledged.status = "paid";
    fixture.acknowledgedSubscription.status = "payment_superseded";
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("status=checkout");
    expect(mocks.paymentTransactionCreate).toHaveBeenCalledOnce();
    expect(mocks.subscriptionCreate).toHaveBeenCalledOnce();
    expect(mocks.createCheckoutSession).toHaveBeenCalledOnce();
  });

  it("blocks switching plan after a new pending order exists", async () => {
    const fixture = enableAcknowledgedRetry();
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("status=checkout");
    const data = mocks.paymentTransactionCreate.mock.calls[0]?.[0].data;
    const saved = { ...createdTransaction, currency: "TWD", ...data, metadata: mocks.paymentTransactionUpdate.mock.calls[0]?.[0].data.metadata };
    mocks.paymentTransactionFindFirst.mockImplementation(async ({ where }) => where.metadata ? saved : null);
    mocks.billingPlanFindFirst.mockResolvedValue({ ...fixture.selectedPlan, id: "growth-id", code: "staging-payuni-growth", monthlyPriceCents: 200 });
    const switched = formData(); switched.set("planId", "growth-id");
    await expect(selectBillingPlanAction(switched)).rejects.toThrow("error=conflict");
    expect(mocks.paymentTransactionCreate).toHaveBeenCalledOnce();
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledOnce();
  });

  it.each(["paid", "failed", "refunded"])("keeps the acknowledgment spent after %s clears the transient key", async (status) => {
    const fixture = enableAcknowledgedRetry();
    mocks.paymentTransactionFindFirst.mockResolvedValueOnce({ id: "spent-new-order", status, checkoutIdempotencyKey: null,
      metadata: { stagingPayUniRetryAttemptId: retryAttemptId, stagingPayUniAcknowledgedPendingTransactionId: PAYUNI_STAGING_RETRY_TRANSACTION_ID } });
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("error=conflict");
    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
    expect(fixture.acknowledged.status).toBe("pending");
  });

  it("keeps a spent acknowledgment closed even under a different permit nonce", async () => {
    enableAcknowledgedRetry();
    mocks.paymentTransactionFindFirst.mockResolvedValueOnce({ status: "pending", metadata: { stagingPayUniRetryAttemptId: "different-attempt" } });
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("error=conflict");
    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
  });

  it.each(["extra-payment", "extra-subscription", "callback", "altered-old-scope"])("blocks %s without changing the old payment", async (reason) => {
    const fixture = enableAcknowledgedRetry();
    if (reason === "extra-payment") mocks.paymentTransactionFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "additional-pending" });
    if (reason === "extra-subscription") mocks.subscriptionFindFirst.mockResolvedValueOnce({ id: "additional-subscription" });
    if (reason === "callback") mocks.webhookEventCount.mockResolvedValueOnce(1);
    if (reason === "altered-old-scope") fixture.acknowledged.orderNumber = "wrong-order";
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("error=conflict");
    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
  });

  it("preserves the spent attempt marker if provider setup fails", async () => {
    enableAcknowledgedRetry();
    mocks.createCheckoutSession.mockRejectedValueOnce(new Error("setup failed"));
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("error=checkout");
    const created = mocks.paymentTransactionCreate.mock.calls[0]?.[0].data;
    expect(created.metadata.stagingPayUniRetryAttemptId).toBe(retryAttemptId);
    mocks.paymentTransactionFindFirst.mockResolvedValueOnce({ ...created, id: createdTransaction.id, status: "failed", checkoutIdempotencyKey: null });
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("error=conflict");
    expect(mocks.paymentTransactionCreate).toHaveBeenCalledOnce();
  });
});

afterEach(() => vi.unstubAllEnvs());

function enableStagingLivePlanTest() {
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
  mocks.getPaymentProvider.mockReturnValue({ id: "payuni", checkoutReadiness: mocks.checkoutReadiness, createCheckoutSession: mocks.createCheckoutSession });
  mocks.checkoutReadiness.mockReturnValue("unavailable");
  mocks.createCheckoutSession.mockResolvedValue({
    provider: "payuni", mode: "form_post", checkoutUrl: null,
    formAction: "https://api.payuni.com.tw/api/upp", formMethod: "POST",
    formPayload: { MerID: "TESTMER", EncryptInfo: "synthetic", HashInfo: "synthetic" },
    nextAction: "submit_payuni_upp_form", externalRequired: true,
  });
}

describe("selectBillingPlanAction", () => {
  it("validates CSRF and owner access before changing the current vendor plan", async () => {
    const data = formData();

    await expect(selectBillingPlanAction(data)).rejects.toThrow("redirect:/billing/plans?status=checkout&transactionId=transaction-plan-checkout");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(data);
    expect(mocks.requireVendorOwnerFinance).toHaveBeenCalledExactlyOnceWith("/billing/plans");
    expect(mocks.billingPlanFindFirst).toHaveBeenCalledWith({
      where: { id: plan.id },
    });
    expect(mocks.subscriptionFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", status: "active" },
      orderBy: { startedAt: "desc" },
    });
    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", status: "pending_payment" },
      data: { status: "payment_superseded", endedAt: expect.any(Date) },
    });
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-current",
        planId: plan.id,
        paymentMode: "platform",
        billingCycleDay: 8,
        status: "pending_payment",
      }),
    });
    expect(mocks.subscriptionCreate.mock.calls[0]?.[0].data).not.toHaveProperty("monthlyPriceCents");
    expect(mocks.subscriptionCreate.mock.calls[0]?.[0].data.vendorId).not.toBe("vendor-attacker");
    expect(mocks.usageLimitUpsert).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-current",
        providerName: "demo",
        paymentMode: "platform",
        grossAmountCents: plan.monthlyPriceCents,
        status: "pending",
        checkoutIdempotencyKey: "platform-plan:v1:vendor-current:plan-pro",
        metadata: expect.objectContaining({
          platformSubscriptionId: "subscription-new",
          billingPlanId: plan.id,
        }),
      }),
    });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledWith({
      where: { id: createdTransaction.id },
      data: { metadata: expect.objectContaining({ checkoutSession: expect.objectContaining({ provider: "demo" }) }) },
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-current",
        actorId: "member-owner",
        action: "start_platform_subscription_checkout",
        targetId: "subscription-new",
        ipAddress: "203.0.113.5",
        userAgent: "test-agent",
      }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/billing/plans");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/billing/usage");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("captures a server-side platform referral snapshot without accruing commission", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "click-1" }) });

    await expect(selectBillingPlanAction(formData("click-1"))).rejects.toThrow("redirect:/billing/plans?status=checkout&transactionId=transaction-plan-checkout&referral=1");

    expect(mocks.capturePlatformReferralAttribution).toHaveBeenCalledWith(expect.anything(), {
      clickId: "click-1",
      subscriptionId: "subscription-new",
      capturedAt: expect.any(Date),
    });
  });

  it("does not inherit a stale referral cookie on direct plan entry", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "stale-click" }) });

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?status=checkout&transactionId=transaction-plan-checkout");

    expect(mocks.capturePlatformReferralAttribution).not.toHaveBeenCalled();
  });

  it("releases an uncompleted referral snapshot when provider checkout setup fails", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "click-1" }) });
    mocks.createCheckoutSession.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?error=checkout");

    expect(mocks.paymentTransactionUpdateMany).toHaveBeenCalledWith({
      where: { id: createdTransaction.id, status: "pending" },
      data: { status: "failed", checkoutIdempotencyKey: null },
    });
    expect(mocks.platformReferralAttributionDeleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: createdSubscription.id },
    });
    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { id: createdSubscription.id, status: "pending_payment" },
      data: { status: "payment_failed" },
    });
  });

  it("reuses a valid pending checkout for the same vendor and plan", async () => {
    const checkout = {
      ...createdTransaction,
      checkoutIdempotencyKey: "platform-plan:v1:vendor-current:plan-pro",
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: createdSubscription.id,
        billingPlanId: plan.id,
        checkoutSession: { provider: "demo", mode: "manual", nextAction: "existing_checkout" },
      },
    };
    mocks.paymentTransactionFindUnique.mockResolvedValue(checkout);
    mocks.subscriptionFindUnique.mockResolvedValue({ ...createdSubscription, plan });

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?status=checkout&transactionId=transaction-plan-checkout");

    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("keeps repeated submissions idempotent when the selected plan is already current", async () => {
    mocks.subscriptionFindMany.mockResolvedValue([{ ...previousSubscription, planId: plan.id }]);

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?status=current");

    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", status: "pending_payment" },
      data: { status: "payment_superseded", endedAt: expect.any(Date) },
    });
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
    expect(mocks.usageLimitUpsert).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing or inactive plan without changing subscriptions", async () => {
    mocks.billingPlanFindFirst.mockResolvedValue(null);

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?error=unavailable");

    expect(mocks.subscriptionFindMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
  });

  it("fails closed when the configured payment provider is unavailable", async () => {
    mocks.getPaymentProvider.mockImplementation(() => {
      throw new Error("unsupported payment provider");
    });

    await expect(selectBillingPlanAction(formData())).rejects.toThrow(
      "redirect:/billing/plans?error=provider_not_configured",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
  });

  it("does not create a paid subscription or payment transaction when checkout is unavailable", async () => {
    mocks.checkoutReadiness.mockReturnValueOnce("unavailable");

    await expect(selectBillingPlanAction(formData())).rejects.toThrow(
      "redirect:/billing/plans?error=checkout",
    );

    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
    expect(mocks.capturePlatformReferralAttribution).not.toHaveBeenCalled();
  });

  it("creates the scoped staging plan transaction at the database's 1 TWD price", async () => {
    enableStagingLivePlanTest();
    const permit = `staging-payuni-plan-v1:${JSON.stringify({ deploymentHost: "staging-test.vercel.app", merchantId: "TESTMER", vendorId: "vendor-current", expiresAt: "2099-01-01T00:00:00.000Z" })}`;
    mocks.billingPlanFindFirst.mockResolvedValue({ ...plan, code: "staging-payuni-starter", monthlyPriceCents: 100, isActive: false, description: permit });
    mocks.paymentTransactionCreate.mockResolvedValue({ ...createdTransaction, providerName: "payuni", grossAmountCents: 100, metadata: { stagingPayUniPlanPermit: permit } });
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?status=checkout&transactionId=transaction-plan-checkout");
    expect(mocks.paymentTransactionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ providerName: "payuni", grossAmountCents: 100 }) });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { metadata: expect.objectContaining({ stagingPayUniPlanPermit: permit }) } }));
    expect(mocks.createCheckoutSession).toHaveBeenCalledOnce();
  });

  it("does not create a live staging payment when the plan retains its normal price", async () => {
    enableStagingLivePlanTest();
    mocks.billingPlanFindFirst.mockResolvedValue({ ...plan, code: "staging-payuni-starter", monthlyPriceCents: 248000, isActive: false });
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?error=unavailable");
    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
  });

  it("blocks a new live plan while a superseded PAYUNi platform transaction remains payable", async () => {
    enableStagingLivePlanTest();
    mocks.billingPlanFindFirst.mockResolvedValue({ ...plan, code: "staging-payuni-starter", monthlyPriceCents: 100, isActive: false, description: `staging-payuni-plan-v1:${JSON.stringify({ deploymentHost: "staging-test.vercel.app", merchantId: "TESTMER", vendorId: "vendor-current", expiresAt: "2099-01-01T00:00:00.000Z" })}` });
    mocks.paymentTransactionFindFirst.mockResolvedValueOnce({ id: "old-pending-payment" });
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?error=conflict");
    expect(mocks.paymentTransactionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ checkoutIdempotencyKey: { not: "platform-plan:v1:vendor-current:plan-pro" } }) }));
    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
  });

  it("does not reuse a pending production form after the staging test switch is closed", async () => {
    enableStagingLivePlanTest();
    vi.stubEnv("PAYUNI_STAGING_PLAN_TEST_ENABLED", "false");
    mocks.billingPlanFindFirst.mockResolvedValue({ ...plan, code: "staging-payuni-starter", monthlyPriceCents: 100, isActive: false });
    mocks.paymentTransactionFindUnique.mockResolvedValue({
      ...createdTransaction,
      grossAmountCents: 100,
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        billingPlanId: plan.id,
        platformSubscriptionId: createdSubscription.id,
        checkoutSession: { provider: "payuni", mode: "form_post", nextAction: "submit_payuni_upp_form", formAction: "https://api.payuni.com.tw/api/upp", formMethod: "POST" },
      },
    });
    mocks.subscriptionFindUnique.mockResolvedValue({ ...createdSubscription, plan: { ...plan, code: "staging-payuni-starter", monthlyPriceCents: 100 } });
    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?error=unavailable");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("defaults a first-time plan selection to platform billing", async () => {
    mocks.subscriptionFindMany.mockResolvedValue([]);
    mocks.subscriptionCreate.mockResolvedValue({
      ...createdSubscription,
      paymentMode: "platform",
    });

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?status=checkout&transactionId=transaction-plan-checkout");

    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-current",
        planId: plan.id,
        paymentMode: "platform",
        billingCycleDay: 5,
      }),
    });
  });

  it("does not access billing data when owner authorization fails", async () => {
    mocks.requireVendorOwnerFinance.mockRejectedValue(new Error("redirect:/settings/security?error=owner_required"));

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("owner_required");

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("converges duplicate active subscriptions to one newly selected subscription", async () => {
    mocks.subscriptionFindMany.mockResolvedValue([
      { ...previousSubscription, id: "duplicate-1", planId: plan.id },
      { ...previousSubscription, id: "duplicate-2", planId: plan.id },
    ]);

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?status=checkout&transactionId=transaction-plan-checkout");

    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", status: "pending_payment" },
      data: { status: "payment_superseded", endedAt: expect.any(Date) },
    });
    expect(mocks.subscriptionCreate).toHaveBeenCalledOnce();
  });

  it("bounds serialization retries and returns a safe conflict state", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" });

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?error=conflict");

    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });
});
