import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

export const MONTHLY_USAGE_SNAPSHOT_RECORD_TYPE = "monthly_usage_snapshot";

export type VendorUsageSnapshot = {
  totalWatchMinutes: number;
  totalEvents: number;
  totalAffiliates: number;
  totalStorageMinutes: number;
};

export class UsageEstimationError extends Error {
  constructor(public readonly code: "invalid_month") {
    super(code);
    this.name = "UsageEstimationError";
  }
}

export function usageMonthRange(monthKey: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new UsageEstimationError("invalid_month");
  }

  const [yearText, monthText] = monthKey.split("-");
  if (yearText === undefined || monthText === undefined) {
    throw new UsageEstimationError("invalid_month");
  }

  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

function snapshotRecordId(vendorId: string, monthKey: string) {
  const digest = createHash("sha256").update(`${vendorId}:${monthKey}`).digest("hex").slice(0, 40);
  return `usage-snapshot-${digest}`;
}

function nonNegativeInteger(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

/**
 * Builds a provider-neutral monthly usage estimate from server-owned records.
 *
 * StreamUsageLedgerEntry is the canonical delivered-minutes source for local
 * billing. AnalyticsEvent counts tracked product events, active Affiliate
 * rows are the configured promoter count, and Video.estimatedMinutes is the
 * current stored-minute estimate. Provider dashboards are intentionally not
 * queried here; external reconciliation remains a separate release gate.
 */
export async function estimateVendorUsage(vendorId: string, monthKey: string): Promise<VendorUsageSnapshot> {
  const { end, start } = usageMonthRange(monthKey);
  const db = getDb();
  const [streamUsage, eventCount, affiliateCount, storedMinutes] = await Promise.all([
    db.streamUsageLedgerEntry.aggregate({
      where: { vendorId, monthKey },
      _sum: { watchSeconds: true },
    }),
    db.analyticsEvent.count({
      where: { vendorId, createdAt: { gte: start, lt: end } },
    }),
    db.affiliate.count({
      where: { vendorId, isActive: true, createdAt: { lt: end } },
    }),
    db.video.aggregate({
      where: { vendorId, createdAt: { lt: end }, estimatedMinutes: { gt: 0 } },
      _sum: { estimatedMinutes: true },
    }),
  ]);

  return {
    totalWatchMinutes: Math.ceil(nonNegativeInteger(streamUsage._sum.watchSeconds) / 60),
    totalEvents: nonNegativeInteger(eventCount),
    totalAffiliates: nonNegativeInteger(affiliateCount),
    totalStorageMinutes: nonNegativeInteger(storedMinutes._sum.estimatedMinutes),
  };
}

function snapshotMetadata(snapshot: VendorUsageSnapshot, generatedAt: Date): Prisma.InputJsonObject {
  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    sourceAttribution: {
      deliveredMinutes: "StreamUsageLedgerEntry.watchSeconds",
      events: "AnalyticsEvent.count within month window",
      affiliates: "active Affiliate rows created before month end",
      storedMinutes: "Video.estimatedMinutes created before month end",
    },
    totals: snapshot,
  };
}

/**
 * Persists one deterministic snapshot per vendor/month. Re-running a job
 * refreshes the same row instead of creating duplicate billable records.
 */
export async function upsertUsageSnapshot(vendorId: string, monthKey: string) {
  const snapshot = await estimateVendorUsage(vendorId, monthKey);
  const generatedAt = new Date();
  const metadata = snapshotMetadata(snapshot, generatedAt);
  const record = await getDb().usageRecord.upsert({
    where: { id: snapshotRecordId(vendorId, monthKey) },
    create: {
      id: snapshotRecordId(vendorId, monthKey),
      vendorId,
      monthKey,
      recordType: MONTHLY_USAGE_SNAPSHOT_RECORD_TYPE,
      quantity: snapshot.totalWatchMinutes,
      unit: "minute",
      creditsDelta: 0,
      totalWatchMinutes: snapshot.totalWatchMinutes,
      totalEvents: snapshot.totalEvents,
      totalAffiliates: snapshot.totalAffiliates,
      totalStorageMinutes: snapshot.totalStorageMinutes,
      description: "Cloudflare Stream 伺服器用量估算快照",
      metadata,
    },
    update: {
      quantity: snapshot.totalWatchMinutes,
      unit: "minute",
      creditsDelta: 0,
      totalWatchMinutes: snapshot.totalWatchMinutes,
      totalEvents: snapshot.totalEvents,
      totalAffiliates: snapshot.totalAffiliates,
      totalStorageMinutes: snapshot.totalStorageMinutes,
      description: "Cloudflare Stream 伺服器用量估算快照",
      metadata,
    },
    select: { id: true, createdAt: true },
  });

  return { snapshot, record };
}
