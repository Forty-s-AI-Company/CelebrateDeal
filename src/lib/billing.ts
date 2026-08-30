import type { BillingPlan, PaymentTransaction, UsageRecord, VendorSubscription } from "@prisma/client";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { estimateVendorUsage, MONTHLY_USAGE_SNAPSHOT_RECORD_TYPE } from "@/lib/usage-estimation";

type SubscriptionWithPlan = VendorSubscription & { plan: BillingPlan };

export class StreamUsageReconciliationRequiredError extends Error {
  readonly code = "stream_reconciliation_required" as const;

  constructor() {
    super("stream_reconciliation_required");
    this.name = "StreamUsageReconciliationRequiredError";
  }
}

export function monthRange(monthKey: string) {
  const [yearValue, monthValue] = monthKey.split("-").map((part) => Number.parseInt(part, 10));
  const year = yearValue !== undefined && Number.isFinite(yearValue)
    ? yearValue
    : new Date().getFullYear();
  const month = monthValue !== undefined && Number.isFinite(monthValue)
    ? monthValue
    : new Date().getMonth() + 1;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  return { start, end };
}

/**
 * Invoice due dates are derived from the subscription's billing cycle and the
 * month being settled. Clamp an out-of-range cycle day to the last day of the
 * due month so February and short months never roll into a second month.
 */
export function invoiceDueAt(monthKey: string, billingCycleDay: number) {
  const { end } = monthRange(monthKey);
  const year = end.getUTCFullYear();
  const month = end.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const normalizedDay = Number.isInteger(billingCycleDay)
    ? Math.min(lastDay, Math.max(1, billingCycleDay))
    : 5;
  return new Date(Date.UTC(year, month, normalizedDay));
}

function ceilCharge(units: number, blockSize: number, unitPriceCents: number) {
  if (units <= 0 || unitPriceCents <= 0) return 0;
  return Math.ceil(units / blockSize) * unitPriceCents;
}

type UsageAggregateRecord = Pick<UsageRecord, "recordType" | "quantity" | "totalWatchMinutes" | "totalEvents" | "totalAffiliates" | "totalStorageMinutes">;

export function calculateStreamUsageMinutes(
  records: Pick<UsageAggregateRecord, "recordType" | "quantity" | "totalWatchMinutes">[],
  streamUsageSeconds = 0,
) {
  const streamQuantity = records
    .filter((record) => record.recordType === "stream_minutes")
    .reduce((sum, record) => sum + record.quantity, 0);
  const ledgerStreamMinutes = Math.ceil(Math.max(0, streamUsageSeconds) / 60);
  return Math.max(0, streamQuantity, ledgerStreamMinutes, ...records.map((record) => record.totalWatchMinutes));
}

function usageTotals(records: UsageAggregateRecord[], streamUsageSeconds = 0) {
  const storageQuantity = records
    .filter((record) => record.recordType === "storage_minutes")
    .reduce((sum, record) => sum + record.quantity, 0);

  return {
    totalWatchMinutes: calculateStreamUsageMinutes(records, streamUsageSeconds),
    totalEvents: Math.max(0, ...records.map((record) => record.totalEvents)),
    totalAffiliates: Math.max(0, ...records.map((record) => record.totalAffiliates)),
    totalStorageMinutes: Math.max(storageQuantity, ...records.map((record) => record.totalStorageMinutes)),
  };
}

type InternalStreamUsageAllocationRow = {
  recipientKey: string;
  recipientType: string;
  recipientMembershipId: string | null;
  allocatedWatchSeconds: number;
};

function isMissingAllocationTable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2021";
}

async function readInternalStreamUsageAllocations(db: ReturnType<typeof getDb>, vendorId: string, monthKey: string) {
  try {
    return {
      status: "AVAILABLE" as const,
      rows: await db.streamUsageAllocationEntry.findMany({
        where: { vendorId, monthKey },
        select: {
          recipientKey: true,
          recipientType: true,
          recipientMembershipId: true,
          allocatedWatchSeconds: true,
        },
      }),
    };
  } catch (error) {
    // A rolling deployment may run the new binary before the forward-only
    // migration reaches its database. Keep provider billing available, but
    // expose the missing internal read model instead of claiming allocation.
    if (isMissingAllocationTable(error)) return { status: "MIGRATION_REQUIRED" as const, rows: [] as InternalStreamUsageAllocationRow[] };
    throw error;
  }
}

type StreamUsageBillingDecision = {
  status: "NO_EVIDENCE" | "MIGRATION_REQUIRED" | "MATCHED" | "ACCEPT_INTERNAL" | "ACCEPT_PROVIDER";
  reconciliationId: string | null;
  providerWatchMinutes: number | null;
  providerStorageMinutes: number | null;
};

async function readStreamUsageBillingDecision(
  db: ReturnType<typeof getDb>,
  vendorId: string,
  monthKey: string,
): Promise<StreamUsageBillingDecision> {
  let reconciliation;
  try {
    const blocking = await db.streamUsageReconciliation.findFirst({
      where: {
        vendorId,
        monthKey,
        OR: [
          { status: "MISMATCH" },
          { status: "RESOLVED", resolution: "ESCALATED" },
        ],
      },
      select: { id: true },
    });
    if (blocking) throw new StreamUsageReconciliationRequiredError();
    reconciliation = await db.streamUsageReconciliation.findFirst({
      where: { vendorId, monthKey },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        resolution: true,
        providerWatchMinutes: true,
        providerStorageMinutes: true,
      },
    });
  } catch (error) {
    if (error instanceof StreamUsageReconciliationRequiredError) throw error;
    if (isMissingAllocationTable(error)) {
      return { status: "MIGRATION_REQUIRED", reconciliationId: null, providerWatchMinutes: null, providerStorageMinutes: null };
    }
    throw error;
  }

  if (!reconciliation) {
    return { status: "NO_EVIDENCE", reconciliationId: null, providerWatchMinutes: null, providerStorageMinutes: null };
  }
  if (reconciliation.status === "MISMATCH" || reconciliation.resolution === "ESCALATED") {
    throw new StreamUsageReconciliationRequiredError();
  }
  if (reconciliation.status === "MATCHED") {
    return { status: "MATCHED", reconciliationId: reconciliation.id, providerWatchMinutes: null, providerStorageMinutes: null };
  }
  if (reconciliation.status === "RESOLVED" && reconciliation.resolution === "ACCEPT_PROVIDER") {
    return {
      status: "ACCEPT_PROVIDER",
      reconciliationId: reconciliation.id,
      providerWatchMinutes: reconciliation.providerWatchMinutes,
      providerStorageMinutes: reconciliation.providerStorageMinutes,
    };
  }
  if (reconciliation.status === "RESOLVED" && reconciliation.resolution === "ACCEPT_INTERNAL") {
    return { status: "ACCEPT_INTERNAL", reconciliationId: reconciliation.id, providerWatchMinutes: null, providerStorageMinutes: null };
  }

  throw new StreamUsageReconciliationRequiredError();
}

export async function calculateSettlement(vendorId: string, monthKey: string) {
  const db = getDb();
  const { start, end } = monthRange(monthKey);
  const [subscription, usageRecords, measuredUsage, streamUsageLedgerEntries, streamUsageAllocationResult, streamUsageBillingDecision, transactions, refundTotal, commissionTotal] = await Promise.all([
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
    estimateVendorUsage(vendorId, monthKey),
    db.streamUsageLedgerEntry.findMany({
      where: { vendorId, monthKey },
      select: { watchSeconds: true },
    }),
    readInternalStreamUsageAllocations(db, vendorId, monthKey),
    readStreamUsageBillingDecision(db, vendorId, monthKey),
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
    db.affiliateCommissionLedgerEntry.aggregate({
      where: {
        vendorId,
        commission: {
          monthKey,
          status: { in: ["pending", "approved", "locked"] },
        },
      },
      _sum: { amountCents: true },
    }),
  ]);

  if (!subscription) {
    throw new Error("找不到有效訂閱方案，無法產生月結。");
  }

  const plan = subscription.plan;
  const internalStreamUsageAllocations = [...streamUsageAllocationResult.rows.reduce((totals, allocation) => {
    const existing = totals.get(allocation.recipientKey);
    if (existing) {
      existing.allocatedWatchSeconds += allocation.allocatedWatchSeconds;
    } else {
      totals.set(allocation.recipientKey, {
        recipientKey: allocation.recipientKey,
        recipientType: allocation.recipientType,
        recipientMembershipId: allocation.recipientMembershipId,
        allocatedWatchSeconds: allocation.allocatedWatchSeconds,
      });
    }
    return totals;
  }, new Map<string, {
    recipientKey: string;
    recipientType: string;
    recipientMembershipId: string | null;
    allocatedWatchSeconds: number;
  }>()).values()].sort((left, right) => left.recipientKey.localeCompare(right.recipientKey));
  const internalTotals = usageTotals(
    [
      ...usageRecords,
      {
        recordType: MONTHLY_USAGE_SNAPSHOT_RECORD_TYPE,
        quantity: measuredUsage.totalWatchMinutes,
        totalWatchMinutes: measuredUsage.totalWatchMinutes,
        totalEvents: measuredUsage.totalEvents,
        totalAffiliates: measuredUsage.totalAffiliates,
        totalStorageMinutes: measuredUsage.totalStorageMinutes,
      },
    ],
    streamUsageLedgerEntries.reduce((sum, entry) => sum + entry.watchSeconds, 0),
  );
  const totals = streamUsageBillingDecision.status === "ACCEPT_PROVIDER"
    ? {
        ...internalTotals,
        totalWatchMinutes: streamUsageBillingDecision.providerWatchMinutes ?? internalTotals.totalWatchMinutes,
        totalStorageMinutes: streamUsageBillingDecision.providerStorageMinutes ?? internalTotals.totalStorageMinutes,
      }
    : internalTotals;
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
    ? grossRevenueCents - paymentGatewayFeeCents - transactionServiceFeeCents - (commissionTotal._sum.amountCents ?? 0)
    : 0;

  return {
    subscription,
    totals,
    internalStreamUsageAllocations,
    internalStreamUsageAllocationStatus: streamUsageAllocationResult.status,
    streamUsageReconciliationStatus: streamUsageBillingDecision.status,
    streamUsageReconciliationId: streamUsageBillingDecision.reconciliationId,
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

export function invoiceNumber(vendorSlug: string, monthKey: string, vendorId: string) {
  const vendorKey = createHash("sha256").update(vendorId).digest("hex").slice(0, 8).toUpperCase();
  return `INV-${monthKey.replace("-", "")}-${vendorSlug.toUpperCase().slice(0, 12)}-${vendorKey}`;
}

export function payoutBatchNumber(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = date.getTime().toString().slice(-5);
  return `PB-${stamp}-${suffix}`;
}
