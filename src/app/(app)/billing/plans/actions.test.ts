import { beforeEach, describe, expect, it, vi } from "vitest";

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
  subscriptionUpdateMany: vi.fn(),
  subscriptionCreate: vi.fn(),
  usageLimitUpsert: vi.fn(),
  auditLogCreate: vi.fn(),
  cookies: vi.fn(),
  capturePlatformReferralAttribution: vi.fn(),
  getPaymentProvider: vi.fn(),
  paymentTransactionCreate: vi.fn(),
  paymentTransactionFindUnique: vi.fn(),
  paymentTransactionUpdateMany: vi.fn(),
  paymentTransactionUpdate: vi.fn(),
  platformReferralAttributionDeleteMany: vi.fn(),
  createCheckoutSession: vi.fn(),
  checkoutReadiness: vi.fn(),
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
  mocks.subscriptionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.subscriptionCreate.mockResolvedValue(createdSubscription);
  mocks.paymentTransactionCreate.mockResolvedValue(createdTransaction);
  mocks.paymentTransactionFindUnique.mockResolvedValue(null);
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
      updateMany: mocks.subscriptionUpdateMany,
      create: mocks.subscriptionCreate,
    },
    paymentTransaction: {
      create: mocks.paymentTransactionCreate,
      findUnique: mocks.paymentTransactionFindUnique,
      updateMany: mocks.paymentTransactionUpdateMany,
      update: mocks.paymentTransactionUpdate,
    },
    platformReferralAttribution: { deleteMany: mocks.platformReferralAttributionDeleteMany },
    vendorUsageLimit: { upsert: mocks.usageLimitUpsert },
    auditLog: { create: mocks.auditLogCreate },
  }));
});

describe("selectBillingPlanAction", () => {
  it("validates CSRF and owner access before changing the current vendor plan", async () => {
    const data = formData();

    await expect(selectBillingPlanAction(data)).rejects.toThrow("redirect:/billing/plans?status=checkout&transactionId=transaction-plan-checkout");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(data);
    expect(mocks.requireVendorOwnerFinance).toHaveBeenCalledExactlyOnceWith("/billing/plans");
    expect(mocks.billingPlanFindFirst).toHaveBeenCalledWith({
      where: { id: plan.id, isActive: true },
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
