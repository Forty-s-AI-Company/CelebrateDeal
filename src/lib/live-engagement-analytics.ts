import { Prisma, type PrismaClient } from "@prisma/client";
import { maskCustomerName, pollPercentagesFromCounts } from "@/lib/live-interaction";

type JsonRecord = Record<string, unknown>;

export type InteractionCountRow = {
  runId: string;
  value: string;
  _count: { _all: number };
};

export type PollRun = {
  id: string;
  title: string;
  configuration: unknown;
};

export type AffiliateConversion = {
  promoterMembershipId: string;
  promoterName: string | null;
  promoterCode: string | null;
  status: string;
  grossAmountCents: number;
};

export type LiveAffiliateAttributionRow = {
  attributionKey: string;
  name: string;
  clicks: number;
  registrations: number;
  confirmedOrders: number;
  pendingOrders: number;
  confirmedGrossCents: number;
  conversionRate: number;
};

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

/** Converts database groupBy rows into a compact run/value lookup. */
export function interactionCountsByRun(rows: readonly InteractionCountRow[]) {
  const result = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const counts = result.get(row.runId) ?? new Map<string, number>();
    let values: string[] = [row.value];
    if (row.value.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(row.value);
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) values = [...new Set(parsed)];
      } catch {
        // Legacy/free-text values remain one opaque choice.
      }
    }
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + row._count._all);
    result.set(row.runId, counts);
  }
  return result;
}

/** Builds poll bars from aggregated counts without loading individual votes. */
export function pollAnalytics(run: PollRun, counts: ReadonlyMap<string, number>) {
  const configuration = record(run.configuration);
  const rawOptions = Array.isArray(configuration.options) ? configuration.options : [];
  const options = rawOptions.flatMap((item, index) => {
    if (typeof item === "string") return [{ id: String(index), label: item }];
    const option = record(item);
    if (typeof option.label !== "string") return [];
    return [{ id: typeof option.id === "string" ? option.id : String(index), label: option.label }];
  });
  const choices = pollPercentagesFromCounts(options, counts);
  return {
    id: run.id,
    question: typeof configuration.question === "string" ? configuration.question : run.title,
    totalVotes: choices.reduce((sum, choice) => sum + choice.votes, 0),
    choices,
  };
}

export function conversionRate(conversions: number, claims: number) {
  if (claims <= 0) return 0;
  return Math.round((conversions / claims) * 1_000) / 10;
}

/** Keeps PII masking at the read-model boundary so UI callers cannot forget it. */
export function maskedQuestionAuthor(displayName: string | null) {
  return maskCustomerName(displayName ?? "");
}

export function affiliateLeaderboard(conversions: readonly AffiliateConversion[]) {
  const rows = new Map<string, {
    promoterMembershipId: string;
    name: string;
    confirmedOrders: number;
    pendingOrders: number;
    confirmedGrossCents: number;
  }>();
  for (const conversion of conversions) {
    const current = rows.get(conversion.promoterMembershipId) ?? {
      promoterMembershipId: conversion.promoterMembershipId,
      name: conversion.promoterName ?? conversion.promoterCode ?? "推廣夥伴",
      confirmedOrders: 0,
      pendingOrders: 0,
      confirmedGrossCents: 0,
    };
    if (conversion.status === "paid") {
      current.confirmedOrders += 1;
      current.confirmedGrossCents += conversion.grossAmountCents;
    } else {
      current.pendingOrders += 1;
    }
    rows.set(conversion.promoterMembershipId, current);
  }
  return [...rows.values()].sort((left, right) => (
    right.confirmedGrossCents - left.confirmedGrossCents
    || right.confirmedOrders - left.confirmedOrders
    || left.name.localeCompare(right.name, "zh-Hant")
  ));
}

type SqlAffiliateRow = {
  attributionKey: string;
  name: string;
  clicks: bigint | number;
  registrations: bigint | number;
  confirmedOrders: bigint | number;
  pendingOrders: bigint | number;
  confirmedGrossCents: bigint | number | null;
};

/**
 * Aggregates the entire affiliate funnel in PostgreSQL. Both tenant and live
 * predicates are mandatory parameters; no raw click, lead, or order list is
 * materialized in application memory.
 */
export async function loadLiveAffiliateAttribution(
  db: PrismaClient,
  input: { vendorId: string; liveId: string },
): Promise<LiveAffiliateAttributionRow[]> {
  const rows = await db.$queryRaw<SqlAffiliateRow[]>(Prisma.sql`
    WITH scoped_clicks AS (
      SELECT ac."id", ac."affiliateId", ac."referralCode"
      FROM "AffiliateClick" ac
      WHERE ac."vendorId" = ${input.vendorId} AND ac."liveId" = ${input.liveId}
    ), scoped_leads AS (
      SELECT fs."id", fs."affiliateClickId"
      FROM "FormSubmission" fs
      INNER JOIN scoped_clicks sc ON sc."id" = fs."affiliateClickId"
      WHERE fs."liveId" = ${input.liveId}
    ), scoped_orders AS (
      SELECT pt."id", pt."status", pt."grossAmountCents", pt."metadata"->>'formSubmissionId' AS "formSubmissionId"
      FROM "PaymentTransaction" pt
      WHERE pt."vendorId" = ${input.vendorId}
        AND pt."metadata"->>'sourceLiveId' = ${input.liveId}
        AND EXISTS (SELECT 1 FROM "CommerceOrder" co WHERE co."primaryPaymentTransactionId" = pt."id" AND co."vendorId" = ${input.vendorId})
    ), per_source AS (
      SELECT
        COALESCE(sc."affiliateId", sc."referralCode", 'unknown') AS "attributionKey",
        MAX(COALESCE(a."name", sc."referralCode", '未知推廣來源')) AS "name",
        COUNT(DISTINCT sc."id") AS "clicks",
        COUNT(DISTINCT sl."id") AS "registrations",
        COUNT(DISTINCT so."id") FILTER (WHERE so."status" = 'paid') AS "confirmedOrders",
        COUNT(DISTINCT so."id") FILTER (WHERE so."status" <> 'paid') AS "pendingOrders",
        COALESCE(SUM(so."grossAmountCents") FILTER (WHERE so."status" = 'paid'), 0) AS "confirmedGrossCents"
      FROM scoped_clicks sc
      LEFT JOIN "Affiliate" a ON a."id" = sc."affiliateId" AND a."vendorId" = ${input.vendorId}
      LEFT JOIN scoped_leads sl ON sl."affiliateClickId" = sc."id"
      LEFT JOIN scoped_orders so ON so."formSubmissionId" = sl."id"
      GROUP BY COALESCE(sc."affiliateId", sc."referralCode", 'unknown')
    )
    SELECT * FROM per_source ORDER BY "confirmedGrossCents" DESC, "confirmedOrders" DESC, "clicks" DESC
  `);
  return rows.map((row) => {
    const clicks = Number(row.clicks);
    const confirmedOrders = Number(row.confirmedOrders);
    return {
      attributionKey: row.attributionKey,
      name: row.name,
      clicks,
      registrations: Number(row.registrations),
      confirmedOrders,
      pendingOrders: Number(row.pendingOrders),
      confirmedGrossCents: Number(row.confirmedGrossCents ?? 0),
      conversionRate: conversionRate(confirmedOrders, clicks),
    };
  });
}
