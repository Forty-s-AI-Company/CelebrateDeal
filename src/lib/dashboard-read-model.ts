import { Prisma, type PrismaClient } from "@prisma/client";
import { realViewerMessageWhere, scheduledMessageEventWhere } from "@/lib/live-chat-analytics";

type DashboardDb = PrismaClient;

export type DashboardMeasurementEntry = {
  name: string;
  durationMs: number;
};

export type DashboardMeasurementSnapshot = {
  /** Number of measured read-model operations, not a raw SQL statement count. */
  readOperationCount: number;
  totalDurationMs: number;
  entries: DashboardMeasurementEntry[];
};

export function createDashboardMeasurement() {
  const entries: DashboardMeasurementEntry[] = [];

  return {
    async measure<T>(name: string, operation: () => Promise<T>) {
      const startedAt = Date.now();
      try {
        return await operation();
      } finally {
        entries.push({ name, durationMs: Math.max(0, Date.now() - startedAt) });
      }
    },
    snapshot(): DashboardMeasurementSnapshot {
      return {
        readOperationCount: entries.length,
        totalDurationMs: entries.reduce((total, entry) => total + entry.durationMs, 0),
        entries: [...entries],
      };
    },
  };
}

export function emitDashboardMeasurement(scope: string, snapshot: DashboardMeasurementSnapshot) {
  if (process.env.NODE_ENV !== "production") {
    console.info("[dashboard.measurement]", { scope, ...snapshot });
  }
}

/**
 * Expose only aggregate timing metadata to local QA and performance probes.
 * Never include vendor identifiers, query arguments, or row data in markup.
 */
export function dashboardMeasurementAttributes(measurement: DashboardMeasurementSnapshot) {
  return {
    "data-dashboard-read-operation-count": String(measurement.readOperationCount),
    "data-dashboard-read-operation-duration-ms": String(Math.round(measurement.totalDurationMs)),
  };
}

export type DashboardRegistrationCounts = {
  total: number;
  verified: number;
};

export type DashboardEmailCounts = {
  sent: number;
  failed: number;
};

export type DashboardAnalyticsCounts = {
  views: number;
  productClicks: number;
  ctaClicks: number;
};

export type DashboardLiveSubmissionCounts = {
  verified: number;
  pending: number;
};

export type DashboardKpiCounts = {
  registrations: number;
  verifiedRegistrations: number;
  views: number;
  productClicks: number;
  ctaClicks: number;
  orders: number;
  emailSent: number;
  emailFailed: number;
  realViewerMessages: number;
  scheduledMessages: number;
};

export type DashboardQueryMeasurement = {
  readOperationCount: number;
  durationMs: number;
};

export function createDashboardQueryMeasurement(): DashboardQueryMeasurement {
  return { readOperationCount: 0, durationMs: 0 };
}

export function dashboardQueryMeasurementAttributes(measurement: DashboardQueryMeasurement) {
  return {
    "data-dashboard-read-operation-count": String(measurement.readOperationCount),
    "data-dashboard-read-operation-duration-ms": String(Math.round(measurement.durationMs)),
  };
}

async function measuredQuery<T>(
  measurement: DashboardQueryMeasurement,
  query: () => Promise<T>,
) {
  const startedAt = performance.now();
  measurement.readOperationCount += 1;
  try {
    return await query();
  } finally {
    measurement.durationMs += Math.max(0, performance.now() - startedAt);
  }
}

function countRows(rows: Array<{ _count: { _all: number }; verificationStatus?: string; status?: string }>, key: string) {
  return rows.find((row) => row.verificationStatus === key || row.status === key)?._count._all ?? 0;
}

/**
 * Uses one grouped query when the real Prisma delegate is available. The
 * sequential fallback keeps lightweight route tests and older adapters
 * compatible without reintroducing concurrent pool pressure.
 */
export async function readDashboardRegistrationCounts(
  db: DashboardDb,
  vendorId: string,
  createdAt: Date,
): Promise<DashboardRegistrationCounts> {
  if (typeof (db.formSubmission as { groupBy?: unknown }).groupBy === "function") {
    const rows = await db.formSubmission.groupBy({
      by: ["verificationStatus"],
      where: { form: { vendorId }, createdAt: { gte: createdAt } },
      _count: { _all: true },
    });
    return {
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      verified: countRows(rows, "VERIFIED"),
    };
  }

  const total = await db.formSubmission.count({ where: { form: { vendorId }, createdAt: { gte: createdAt } } });
  const verified = await db.formSubmission.count({ where: { form: { vendorId }, verificationStatus: "VERIFIED", createdAt: { gte: createdAt } } });
  return { total, verified };
}

export async function readDashboardEmailCounts(
  db: DashboardDb,
  vendorId: string,
  createdAt: Date,
): Promise<DashboardEmailCounts> {
  if (typeof (db.emailDelivery as { groupBy?: unknown }).groupBy === "function") {
    const rows = await db.emailDelivery.groupBy({
      by: ["status"],
      where: { vendorId, createdAt: { gte: createdAt } },
      _count: { _all: true },
    });
    return { sent: countRows(rows, "sent"), failed: countRows(rows, "failed") };
  }

  const sent = await db.emailDelivery.count({ where: { vendorId, status: "sent", createdAt: { gte: createdAt } } });
  const failed = await db.emailDelivery.count({ where: { vendorId, status: "failed", createdAt: { gte: createdAt } } });
  return { sent, failed };
}

export async function readDashboardLiveSubmissionCounts(
  db: DashboardDb,
  vendorId: string,
  liveIds: string[],
): Promise<Record<string, DashboardLiveSubmissionCounts>> {
  const counts: Record<string, DashboardLiveSubmissionCounts> = {};
  if (liveIds.length === 0) return counts;

  if (typeof (db.formSubmission as { groupBy?: unknown }).groupBy === "function") {
    const rows = await db.formSubmission.groupBy({
      by: ["liveId", "verificationStatus"],
      where: { liveId: { in: liveIds }, live: { vendorId } },
      _count: { _all: true },
    });
    for (const row of rows) {
      if (!row.liveId) continue;
      const current = counts[row.liveId] ?? { verified: 0, pending: 0 };
      if (row.verificationStatus === "VERIFIED") current.verified += row._count._all;
      else current.pending += row._count._all;
      counts[row.liveId] = current;
    }
    return counts;
  }

  // Lightweight adapters and route tests do not expose groupBy. Keep the
  // fallback bounded to the five live ids already selected by the page.
  for (const liveId of liveIds) {
    const verified = await db.formSubmission.count({
      where: { liveId, live: { vendorId }, verificationStatus: "VERIFIED" },
    });
    const pending = await db.formSubmission.count({
      where: { liveId, live: { vendorId }, verificationStatus: "UNVERIFIED" },
    });
    counts[liveId] = { verified, pending };
  }
  return counts;
}

function analyticsCountsFromRows(rows: Array<{ eventType: string; uniqueVisitors: number | bigint }>): DashboardAnalyticsCounts {
  const counts = new Map(rows.map((row) => [row.eventType, Number(row.uniqueVisitors)]));
  return {
    views: counts.get("page_view") ?? 0,
    productClicks: counts.get("product_click") ?? 0,
    ctaClicks: counts.get("cta_click") ?? 0,
  };
}

export async function readDashboardAnalyticsCounts(
  db: DashboardDb,
  vendorId: string,
  createdAt: Date,
): Promise<DashboardAnalyticsCounts> {
  if (typeof (db as { $queryRaw?: unknown }).$queryRaw === "function") {
    const rows = await db.$queryRaw<Array<{ eventType: string; uniqueVisitors: number | bigint }>>(Prisma.sql`
      SELECT "eventType" AS "eventType",
             COUNT(DISTINCT "visitorId")::int AS "uniqueVisitors"
      FROM "AnalyticsEvent"
      WHERE "vendorId" = ${vendorId}
        AND "trustLevel"::text = 'ADMITTED_LIVE_SESSION'
        AND "eventType" IN ('page_view', 'product_click', 'cta_click')
        AND "createdAt" >= ${createdAt}
      GROUP BY "eventType"
    `);
    return analyticsCountsFromRows(rows);
  }

  const analyticsEvent = (db as { analyticsEvent?: { groupBy?: unknown } }).analyticsEvent;
  if (!analyticsEvent || typeof analyticsEvent.groupBy !== "function") {
    return { views: 0, productClicks: 0, ctaClicks: 0 };
  }

  // Test adapters may not expose $queryRaw. Keep this fallback aggregate-only
  // and avoid loading raw visitor rows into application memory.
  const rows = await db.analyticsEvent.groupBy({
    by: ["eventType", "visitorId"],
    where: {
      vendorId,
      trustLevel: "ADMITTED_LIVE_SESSION",
      eventType: { in: ["page_view", "product_click", "cta_click"] },
      createdAt: { gte: createdAt },
    },
  });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.eventType, (counts.get(row.eventType) ?? 0) + 1);
  return {
    views: counts.get("page_view") ?? 0,
    productClicks: counts.get("product_click") ?? 0,
    ctaClicks: counts.get("cta_click") ?? 0,
  };
}

export async function readDashboardKpiCounts(
  db: DashboardDb,
  vendorId: string,
  createdAt: Date,
  measurement = createDashboardQueryMeasurement(),
): Promise<{ counts: DashboardKpiCounts; measurement: DashboardQueryMeasurement }> {
  const registrations = await measuredQuery(measurement, () => readDashboardRegistrationCounts(db, vendorId, createdAt));
  const analytics = await measuredQuery(measurement, () => readDashboardAnalyticsCounts(db, vendorId, createdAt));
  const orders = await measuredQuery(measurement, () => db.commerceOrder.count({
    where: { vendorId, createdAt: { gte: createdAt } },
  }));
  const email = await measuredQuery(measurement, () => readDashboardEmailCounts(db, vendorId, createdAt));
  const realViewerMessages = await measuredQuery(measurement, () => db.liveChatMessage.count({
    where: realViewerMessageWhere({ vendorId, createdAtGte: createdAt }),
  }));
  const scheduledMessages = await measuredQuery(measurement, () => db.interactionEvent.count({
    where: scheduledMessageEventWhere({ vendorId }),
  }));

  return {
    counts: {
      registrations: registrations.total,
      verifiedRegistrations: registrations.verified,
      views: analytics.views,
      productClicks: analytics.productClicks,
      ctaClicks: analytics.ctaClicks,
      orders,
      emailSent: email.sent,
      emailFailed: email.failed,
      realViewerMessages,
      scheduledMessages,
    },
    measurement,
  };
}
