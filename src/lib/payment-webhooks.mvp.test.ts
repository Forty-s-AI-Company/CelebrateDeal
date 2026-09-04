import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => {
  const currentTransaction = {
    id: "transaction-mvp-1",
    vendorId: "vendor-mvp-1",
    providerName: "demo",
    orderNumber: "MVP-NO-ACCRUAL-1",
    providerTradeNo: null,
    paymentMode: "byo",
    grossAmountCents: 10_000,
    gatewayFeeCents: 0,
    platformFeeCents: 0,
    netAmountCents: 10_000,
    currency: "TWD",
    status: "pending",
    refundedAmountCents: 0,
    refunds: [],
    primaryCommerceOrder: null,
    metadata: {},
    occurredAt: new Date("2026-09-01T00:00:00.000Z"),
  };
  const paymentTransaction = {
    findFirst: vi.fn().mockResolvedValue(currentTransaction),
    update: vi.fn().mockResolvedValue({ ...currentTransaction, status: "paid" }),
  };
  const tx = {
    paymentTransaction,
    affiliate: { findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    teamLeadAttribution: { findFirst: vi.fn() },
    teamClickAttribution: { findFirst: vi.fn() },
    teamConversionAttribution: { findUnique: vi.fn(), create: vi.fn() },
    vendorSubscription: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    vendorUsageLimit: { upsert: vi.fn() },
    refundRecord: { create: vi.fn(), aggregate: vi.fn() },
  };

  return {
    tx,
    inventoryTransition: vi.fn().mockResolvedValue(undefined),
    commerceTransition: vi.fn().mockResolvedValue(null),
    paidDelivery: vi.fn().mockResolvedValue(undefined),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    refundAccounting: vi.fn(),
    platformReferralAccrual: vi.fn(),
    platformReferralRefund: vi.fn(),
    platformReferralDispute: vi.fn(),
    platformRefundProjection: vi.fn(),
    db: {
      vendor: { findUnique: vi.fn().mockResolvedValue({ id: "vendor-mvp-1", slug: "vendor-mvp" }) },
      paymentTransaction,
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    },
  };
});

// This test has no database connection: the webhook boundary receives only a
// transaction-shaped in-memory dependency. Do not mock mvpCommissionPolicy;
// it exercises the real phase-two default.
vi.mock("@/lib/db", () => ({ getDb: () => dependencies.db }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: <T>(value: T) => value,
  writeAuditLog: dependencies.writeAuditLog,
}));
vi.mock("@/lib/inventory-reservations", () => ({
  applyPaymentInventoryTransition: dependencies.inventoryTransition,
}));
vi.mock("@/lib/commerce-orders", () => ({
  reconcileCommerceOrderPaymentTransition: dependencies.commerceTransition,
}));
vi.mock("@/lib/commerce-order-email", () => ({
  ensureCommerceOrderPaidDelivery: dependencies.paidDelivery,
}));
vi.mock("@/lib/payment-refund-accounting", () => ({
  applyPaymentRefundAccounting: dependencies.refundAccounting,
  calculateNetReferenceAmountCents: () => 10_000,
}));
vi.mock("@/lib/platform-refund-projection", () => ({
  applyPlatformRefundProjection: dependencies.platformRefundProjection,
}));
vi.mock("@/lib/platform-referral-commission", () => ({
  accruePlatformReferralCommission: dependencies.platformReferralAccrual,
  applyPlatformReferralRefund: dependencies.platformReferralRefund,
  applyPlatformReferralDispute: dependencies.platformReferralDispute,
}));

import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";

function defaultTransaction() {
  return {
    id: "transaction-mvp-1",
    vendorId: "vendor-mvp-1",
    providerName: "demo",
    orderNumber: "MVP-NO-ACCRUAL-1",
    providerTradeNo: null,
    paymentMode: "byo",
    grossAmountCents: 10_000,
    gatewayFeeCents: 0,
    platformFeeCents: 0,
    netAmountCents: 10_000,
    currency: "TWD",
    status: "pending",
    refundedAmountCents: 0,
    refunds: [],
    primaryCommerceOrder: null,
    metadata: {},
    occurredAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  const transaction = defaultTransaction();

  dependencies.db.vendor.findUnique.mockResolvedValue({ id: "vendor-mvp-1", slug: "vendor-mvp" });
  dependencies.tx.paymentTransaction.findFirst.mockResolvedValue(transaction);
  dependencies.tx.paymentTransaction.update.mockImplementation(async ({ data }) => ({ ...transaction, ...data }));
  dependencies.db.$transaction.mockImplementation(async (callback: (tx: typeof dependencies.tx) => unknown) => callback(dependencies.tx));
  dependencies.inventoryTransition.mockResolvedValue(undefined);
  dependencies.commerceTransition.mockResolvedValue(null);
  dependencies.paidDelivery.mockResolvedValue(undefined);
  dependencies.writeAuditLog.mockResolvedValue(undefined);
  dependencies.refundAccounting.mockResolvedValue({
    affiliateCommission: null,
    courseRefundAllocations: [],
    commerceOrderRefund: null,
  });
  dependencies.platformReferralRefund.mockResolvedValue(null);
  dependencies.platformReferralAccrual.mockResolvedValue(null);
  dependencies.platformRefundProjection.mockResolvedValue({ subscription: null, invoice: null });
});

describe("payment webhook phase-two commission policy", () => {
  it("沒有受信任歸因資料時不建立佣金，但仍處理付款與商品交付核心流程", async () => {
    const result = await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: "evt-mvp-no-accrual-1",
      eventType: "paid",
      vendorId: "vendor-mvp-1",
      orderNumber: "MVP-NO-ACCRUAL-1",
      grossAmountCents: 10_000,
      currency: "TWD",
    }));

    expect(result.transaction).toMatchObject({ id: "transaction-mvp-1", status: "paid" });
    expect(result).toMatchObject({
      commission: null,
      courseAllocations: [],
      platformReferralCommission: null,
    });
    expect(dependencies.tx.affiliate.findFirst).not.toHaveBeenCalled();
    expect(dependencies.tx.product.findFirst).not.toHaveBeenCalled();
    expect(dependencies.inventoryTransition).toHaveBeenCalledOnce();
    expect(dependencies.commerceTransition).toHaveBeenCalledOnce();
    expect(dependencies.paidDelivery).toHaveBeenCalledOnce();
  });

  it("不建立新平台推薦佣金時，仍會啟用受信任的 pending SaaS 訂閱", async () => {
    const subscriptionTransaction = {
      id: "transaction-mvp-saas-1",
      vendorId: "vendor-mvp-1",
      providerName: "demo",
      orderNumber: "MVP-SAAS-1",
      providerTradeNo: null,
      paymentMode: "platform",
      grossAmountCents: 10_000,
      gatewayFeeCents: 0,
      platformFeeCents: 0,
      netAmountCents: 10_000,
      currency: "TWD",
      status: "pending",
      refundedAmountCents: 0,
      refunds: [],
      primaryCommerceOrder: null,
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        billingPlanId: "plan-mvp-1",
        platformSubscriptionId: "subscription-mvp-1",
      },
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    const pendingSubscription = {
      id: "subscription-mvp-1",
      vendorId: "vendor-mvp-1",
      planId: "plan-mvp-1",
      status: "pending_payment",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      plan: { includedStreamMinutes: 10, includedStorageMinutes: 20, includedCredits: 30 },
    };
    dependencies.tx.paymentTransaction.findFirst.mockResolvedValue(subscriptionTransaction);
    dependencies.tx.paymentTransaction.update.mockResolvedValue({ ...subscriptionTransaction, status: "paid" });
    dependencies.tx.vendorSubscription.findUnique.mockResolvedValue(pendingSubscription);
    dependencies.tx.vendorSubscription.findFirst.mockResolvedValue(null);
    dependencies.tx.vendorSubscription.updateMany.mockResolvedValue({ count: 0 });
    dependencies.tx.vendorSubscription.update.mockResolvedValue({ ...pendingSubscription, status: "active" });
    dependencies.tx.vendorUsageLimit.upsert.mockResolvedValue({});

    const result = await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: "evt-mvp-saas-1",
      eventType: "paid",
      vendorId: "vendor-mvp-1",
      orderNumber: "MVP-SAAS-1",
      grossAmountCents: 10_000,
      currency: "TWD",
    }));

    expect(result.platformSubscription).toMatchObject({ id: "subscription-mvp-1", status: "active" });
    expect(result.platformReferralCommission).toBeNull();
    expect(dependencies.tx.vendorSubscription.update).toHaveBeenCalledOnce();
    expect(dependencies.tx.vendorUsageLimit.upsert).toHaveBeenCalledOnce();
  });

  it("預設 policy 不會略過既有佣金的退款與 reversal 處理", async () => {
    const paidTransaction = {
      ...defaultTransaction(),
      id: "transaction-mvp-refund-1",
      orderNumber: "MVP-REFUND-1",
      status: "paid",
      metadata: {},
    };
    const reversedAffiliateCommission = { id: "affiliate-commission-existing", status: "void" };
    const reversedPlatformReferral = { id: "platform-referral-existing", status: "void" };
    dependencies.tx.paymentTransaction.findFirst.mockResolvedValue(paidTransaction);
    dependencies.tx.paymentTransaction.update.mockImplementation(async ({ data }) => ({ ...paidTransaction, ...data }));
    dependencies.tx.refundRecord.create.mockResolvedValue({ id: "refund-record-1" });
    dependencies.tx.refundRecord.aggregate.mockResolvedValue({
      _sum: { gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 },
    });
    dependencies.refundAccounting.mockResolvedValue({
      affiliateCommission: reversedAffiliateCommission,
      courseRefundAllocations: [],
      commerceOrderRefund: null,
    });
    dependencies.platformReferralRefund.mockResolvedValue(reversedPlatformReferral);

    const result = await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: "evt-mvp-refund-1",
      eventType: "refunded",
      vendorId: "vendor-mvp-1",
      orderNumber: "MVP-REFUND-1",
      refundAmountCents: 10_000,
      currency: "TWD",
    }));

    expect(result.refundCommission).toBe(reversedAffiliateCommission);
    expect(result.platformReferralRefund).toBe(reversedPlatformReferral);
    expect(dependencies.refundAccounting).toHaveBeenCalledOnce();
    expect(dependencies.platformReferralRefund).toHaveBeenCalledOnce();
    expect(dependencies.platformReferralAccrual).not.toHaveBeenCalled();
  });

  it.each([
    ["full", "refunded", 10_000],
    ["partial", "partially_refunded", 2_000],
  ] as const)("passes a %s platform refund to the common in-transaction projection", async (_label, eventType, refundAmountCents) => {
    const platformTransaction = {
      ...defaultTransaction(),
      id: `transaction-mvp-platform-${eventType}`,
      orderNumber: `MVP-PLATFORM-${eventType}`,
      paymentMode: "platform",
      status: "paid",
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: "subscription-mvp-1",
        billingPlanId: "plan-mvp-1",
      },
    };
    const storedTransaction = { ...platformTransaction };
    dependencies.tx.paymentTransaction.findFirst.mockResolvedValue(storedTransaction);
    dependencies.tx.paymentTransaction.update.mockImplementation(async ({ data }) => Object.assign(storedTransaction, data));
    dependencies.tx.vendorSubscription.findUnique.mockResolvedValue({
      id: "subscription-mvp-1", vendorId: "vendor-mvp-1", planId: "plan-mvp-1", paymentMode: "platform", status: "active",
      plan: { monthlyPriceCents: 999_999 },
    });
    dependencies.tx.refundRecord.create.mockResolvedValue({ id: `refund-${eventType}` });
    dependencies.tx.refundRecord.aggregate.mockResolvedValue({
      _sum: { gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-mvp-platform-${eventType}`,
      eventType,
      vendorId: "vendor-mvp-1",
      orderNumber: platformTransaction.orderNumber,
      refundAmountCents,
      currency: "TWD",
    }));

    expect(dependencies.platformRefundProjection).toHaveBeenCalledWith(
      dependencies.tx,
      expect.objectContaining({ status: eventType, refundedAmountCents: refundAmountCents }),
      expect.any(Date),
    );
  });

  it("uses a verified duplicate refund only for projection recovery, without another refund record or ledger reversal", async () => {
    const terminalTransaction = {
      ...defaultTransaction(),
      id: "transaction-mvp-platform-duplicate",
      orderNumber: "MVP-PLATFORM-DUPLICATE",
      paymentMode: "platform",
      status: "refunded",
      refundedAmountCents: 10_000,
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: "subscription-mvp-1",
        billingPlanId: "plan-mvp-1",
      },
      refunds: [{ providerEventId: "evt-mvp-platform-duplicate", refundAmountCents: 10_000, status: "processed" }],
    };
    const storedTransaction = { ...terminalTransaction };
    dependencies.tx.paymentTransaction.findFirst.mockResolvedValue(storedTransaction);
    dependencies.tx.paymentTransaction.update.mockImplementation(async ({ data }) => Object.assign(storedTransaction, data));
    dependencies.tx.vendorSubscription.findUnique.mockResolvedValue({
      id: "subscription-mvp-1", vendorId: "vendor-mvp-1", planId: "plan-mvp-1", paymentMode: "platform", status: "payment_refunded",
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: "evt-mvp-platform-duplicate",
      eventType: "refunded",
      vendorId: "vendor-mvp-1",
      orderNumber: terminalTransaction.orderNumber,
      refundAmountCents: 10_000,
      currency: "TWD",
    }));

    expect(dependencies.platformRefundProjection).toHaveBeenCalledWith(
      dependencies.tx,
      expect.objectContaining({ status: "refunded", refundedAmountCents: 10_000 }),
      expect.any(Date),
    );
    expect(dependencies.tx.refundRecord.create).not.toHaveBeenCalled();
    expect(dependencies.refundAccounting).not.toHaveBeenCalled();
  });
});
