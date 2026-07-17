import type { BillingPlan, PaymentTransaction, UsageRecord, VendorSubscription } from "@prisma/client";
import { getDb } from "@/lib/db";

type SubscriptionWithPlan = VendorSubscription & { plan: BillingPlan };

export function monthRange(monthKey: string) {
  const [yearValue, monthValue] = monthKey.split("-").map((part) => Number.parseInt(part, 10));
  const year = Number.isFinite(yearValue) ? yearValue : new Date().getFullYear();
  const month = Number.isFinite(monthValue) ? monthValue : new Date().getMonth() + 1;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  return { start, end };
}

function ceilCharge(units: number, blockSize: number, unitPriceCents: number) {
  if (units <= 0 || unitPriceCents <= 0) return 0;
  return Math.ceil(units / blockSize) * unitPriceCents;
}

function usageTotals(records: UsageRecord[]) {
  const streamQuantity = records
    .filter((record) => record.recordType === "stream_minutes")
    .reduce((sum, record) => sum + record.quantity, 0);
  const storageQuantity = records
    .filter((record) => record.recordType === "storage_minutes")
    .reduce((sum, record) => sum + record.quantity, 0);

  return {
    totalWatchMinutes: Math.max(streamQuantity, ...records.map((record) => record.totalWatchMinutes)),
    totalEvents: Math.max(0, ...records.map((record) => record.totalEvents)),
    totalAffiliates: Math.max(0, ...records.map((record) => record.totalAffiliates)),
    totalStorageMinutes: Math.max(storageQuantity, ...records.map((record) => record.totalStorageMinutes)),
  };
}

export async function calculateSettlement(vendorId: string, monthKey: string) {
  const db = getDb();
  const { start, end } = monthRange(monthKey);
  const [subscription, usageRecords, transactions, refundTotal, commissionTotal] = await Promise.all([
    db.vendorSubscription.findFirst({
      where: {
        vendorId,
        status: "active",
        startedAt: { lt: end },
        OR: [{ endedAt: null }, { endedAt: { gte: start } }],
      },
      include: { plan: true },
      orderBy: { startedAt: "desc" },
    }) as Promise<SubscriptionWithPlan | null>,
    db.usageRecord.findMany({ where: { vendorId, monthKey } }),
    db.paymentTransaction.findMany({
      where: {
        vendorId,
        status: { in: ["paid", "partially_refunded", "refunded"] },
        occurredAt: { gte: start, lt: end },
      },
    }),
    db.refundRecord.aggregate({
      where: {
        vendorId,
        monthKey,
        status: "processed",
      },
      _sum: {
        refundAmountCents: true,
        gatewayFeeRefundCents: true,
        platformFeeRefundCents: true,
      },
    }),
    db.affiliateCommission.aggregate({
      where: {
        vendorId,
        monthKey,
        status: { in: ["pending", "approved", "locked"] },
      },
      _sum: { commissionAmountCents: true },
    }),
  ]);

  if (!subscription) {
    throw new Error("找不到有效訂閱方案，無法產生月結。");
  }

  const plan = subscription.plan;
  const totals = usageTotals(usageRecords);
  const overflowWatchMinutes = Math.max(0, totals.totalWatchMinutes - plan.includedStreamMinutes);
  const overflowEvents = Math.max(0, totals.totalEvents - plan.includedEvents);
  const overflowAffiliates = Math.max(0, totals.totalAffiliates - plan.includedAffiliates);
  const overflowStorageMinutes = Math.max(0, totals.totalStorageMinutes - plan.includedStorageMinutes);

  const overflowFeeCents =
    ceilCharge(overflowWatchMinutes / 60, 100, plan.overflowWatchHourPriceCents) +
    ceilCharge(overflowEvents, 10, plan.overflowEventUnitPriceCents) +
    ceilCharge(overflowAffiliates, 10, plan.overflowAffiliateUnitPriceCents) +
    ceilCharge(overflowStorageMinutes, 100, plan.overflowStorageMinutePriceCents * 100);

  const paymentMode = subscription.paymentMode;
  const refundAmountCents = refundTotal._sum.refundAmountCents ?? 0;
  const gatewayFeeRefundCents = refundTotal._sum.gatewayFeeRefundCents ?? 0;
  const platformFeeRefundCents = refundTotal._sum.platformFeeRefundCents ?? 0;
  const grossRevenueBeforeRefundCents = transactions.reduce((sum: number, transaction: PaymentTransaction) => sum + transaction.grossAmountCents, 0);
  const grossRevenueCents = Math.max(0, grossRevenueBeforeRefundCents - refundAmountCents);
  const paymentGatewayFeeCents = paymentMode === "platform"
    ? Math.max(0, transactions.reduce((sum: number, transaction: PaymentTransaction) => sum + transaction.gatewayFeeCents, 0) - gatewayFeeRefundCents)
    : 0;
  const recordedPlatformFeeCents = transactions.reduce(
    (sum: number, transaction: PaymentTransaction) => sum + transaction.platformFeeCents,
    0,
  );
  const transactionServiceFeeCents = paymentMode === "platform"
    ? Math.max(0, recordedPlatformFeeCents - platformFeeRefundCents)
    : 0;
  const paymentServiceFeeCents = paymentMode === "platform" ? plan.paymentServiceFeeCents : 0;
  const affiliateManagementFeeCents = plan.affiliateManagementFeeCents;
  const monthlyFeeCents = plan.monthlyPriceCents;
  const payoutableAmountCents = paymentMode === "platform"
    ? grossRevenueCents - paymentGatewayFeeCents - transactionServiceFeeCents - (commissionTotal._sum.commissionAmountCents ?? 0)
    : 0;

  return {
    subscription,
    totals,
    overflowWatchMinutes,
    overflowEvents,
    overflowAffiliates,
    overflowStorageMinutes,
    monthlyFeeCents,
    overflowFeeCents,
    paymentServiceFeeCents,
    transactionServiceFeeCents,
    affiliateManagementFeeCents,
    paymentGatewayFeeCents,
    grossRevenueCents,
    grossRevenueBeforeRefundCents,
    refundAmountCents,
    gatewayFeeRefundCents,
    platformFeeRefundCents,
    payoutableAmountCents,
    finalPayoutAmountCents: payoutableAmountCents,
  };
}

export function invoiceNumber(vendorSlug: string, monthKey: string) {
  return `INV-${monthKey.replace("-", "")}-${vendorSlug.toUpperCase().slice(0, 12)}`;
}

export function payoutBatchNumber(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = date.getTime().toString().slice(-5);
  return `PB-${stamp}-${suffix}`;
}
