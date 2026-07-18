import { getDb } from "@/lib/db";
import {
  assertTeamFunnelAccess,
  requireTeamFunnelActor,
} from "@/lib/team-funnel-access";

const MAX_DAYS = 93;
const MAX_PAGES = 200;
const MAX_EVENTS_PER_SOURCE = 5_000;
const ANALYTICS_DELAY_MS = 15 * 60 * 1_000;
const PAGE_VIEW_EVENT_TYPES = ["page_view", "pageview", "view"];

export type TeamFunnelPerformanceInput = {
  teamId: string;
  startDate?: string | null;
  endDate?: string | null;
  templateId?: string | null;
  partnerMembershipId?: string | null;
  timezone: string;
};

export type TeamFunnelPerformanceMetric = number | null;

export type TeamFunnelPerformanceRow = {
  pageId: string;
  pageSlug: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  partnerMembershipId: string;
  partnerName: string;
  views: TeamFunnelPerformanceMetric;
  clicks: number;
  submissions: number;
  conversions: number;
  netConversionAmountCents: number;
  refundCount: number;
  refundAmountCents: number;
  viewToClickRate: number | null;
  viewToSubmissionRate: number | null;
  analyticsState: "available" | "missing" | "delayed";
};

export type TeamFunnelPerformanceReport = {
  scope: "leader_template" | "partner_self" | "mixed";
  range: { start: Date; endExclusive: Date; timezone: string };
  generatedAt: Date;
  delayedData: boolean;
  truncated: boolean;
  rows: TeamFunnelPerformanceRow[];
  templates: Array<{ id: string; name: string }>;
  partners: Array<{ id: string; name: string }>;
};

export class TeamFunnelPerformanceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamFunnelPerformanceInputError";
  }
}

/**
 * Loads one bounded report scope. Page ownership is expressed in the database
 * predicate: a leader sees pages using a version they own; a partner sees only
 * pages promoted by themselves. This deliberately never expands to peers.
 *
 * Query assumptions: the existing attribution indexes cover team/member/time;
 * production databases should retain a composite page scope index on
 * PartnerFunnelPage(teamId, promoterMembershipId) and its version relation.
 * The fixed takes keep this endpoint bounded even where the latter is absent.
 * Authorization uses the already verified current membership only: the report
 * resource is always the actor's own scope, so loading the whole membership
 * graph would add an unbounded query without expanding their visibility.
 */
export async function getTeamFunnelPerformanceReport(input: TeamFunnelPerformanceInput): Promise<TeamFunnelPerformanceReport> {
  const now = new Date();
  const range = resolvePerformanceRange(input.startDate, input.endDate, input.timezone, now);
  const db = getDb();
  const actor = await requireTeamFunnelActor(input.teamId);
  assertTeamFunnelAccess({
    action: "report",
    actor,
    resource: { id: `team-performance:${actor.id}`, kind: "report", vendorId: actor.vendorId, teamId: actor.teamId, subjectMembershipId: actor.id },
    memberships: [actor],
    relationships: [],
    now,
  });

  const pages = await db.partnerFunnelPage.findMany({
    where: {
      vendorId: actor.vendorId,
      teamId: actor.teamId,
      ...(input.templateId ? { templateVersion: { templateId: input.templateId } } : {}),
      ...(input.partnerMembershipId ? { promoterMembershipId: input.partnerMembershipId } : {}),
      OR: [
        { promoterMembershipId: actor.id },
        { templateVersion: { contentOwnerMembershipId: actor.id } },
      ],
    },
    select: {
      id: true, slug: true, liveId: true, promoterMembershipId: true,
      promoter: { select: { vendorMember: { select: { user: { select: { name: true } } } } } },
      templateVersion: { select: { version: true, templateId: true, contentOwnerMembershipId: true, template: { select: { name: true } } } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: MAX_PAGES + 1,
  });
  const truncated = pages.length > MAX_PAGES;
  const visiblePages = pages.slice(0, MAX_PAGES);
  const pageIds = visiblePages.map((page) => page.id);
  const liveIds = [...new Set(visiblePages.map((page) => page.liveId).filter((id): id is string => Boolean(id)))];

  const [clicks, leads, conversions, refunds, analytics] = pageIds.length === 0 ? [[], [], [], [], []] : await Promise.all([
    db.teamClickAttribution.findMany({
      where: {
        vendorId: actor.vendorId, teamId: actor.teamId, pageId: { in: pageIds },
        affiliateClick: { createdAt: { gte: range.start, lt: range.endExclusive } },
      },
      select: { pageId: true },
      take: MAX_EVENTS_PER_SOURCE + 1,
    }),
    db.teamLeadAttribution.findMany({
      where: {
        vendorId: actor.vendorId, teamId: actor.teamId, pageId: { in: pageIds },
        formSubmission: { createdAt: { gte: range.start, lt: range.endExclusive } },
      },
      select: { pageId: true },
      take: MAX_EVENTS_PER_SOURCE + 1,
    }),
    db.teamConversionAttribution.findMany({
      where: {
        vendorId: actor.vendorId, teamId: actor.teamId, pageId: { in: pageIds },
        paymentTransaction: { occurredAt: { gte: range.start, lt: range.endExclusive } },
      },
      select: {
        pageId: true,
        paymentTransaction: { select: { grossAmountCents: true, refundedAmountCents: true } },
      },
      take: MAX_EVENTS_PER_SOURCE + 1,
    }),
    db.refundRecord.findMany({
      where: {
        vendorId: actor.vendorId,
        processedAt: { gte: range.start, lt: range.endExclusive },
        paymentTransaction: {
          teamAttribution: {
            vendorId: actor.vendorId,
            teamId: actor.teamId,
            pageId: { in: pageIds },
          },
        },
      },
      select: {
        refundAmountCents: true,
        paymentTransaction: { select: { teamAttribution: { select: { pageId: true } } } },
      },
      take: MAX_EVENTS_PER_SOURCE + 1,
    }),
    liveIds.length === 0 ? Promise.resolve([]) : db.analyticsEvent.findMany({
      where: {
        vendorId: actor.vendorId, liveId: { in: liveIds }, eventType: { in: PAGE_VIEW_EVENT_TYPES },
        createdAt: { gte: range.start, lt: range.endExclusive },
      },
      select: { payload: true },
      take: MAX_EVENTS_PER_SOURCE + 1,
    }),
  ]);

  const eventTruncated = clicks.length > MAX_EVENTS_PER_SOURCE || leads.length > MAX_EVENTS_PER_SOURCE || conversions.length > MAX_EVENTS_PER_SOURCE || refunds.length > MAX_EVENTS_PER_SOURCE || analytics.length > MAX_EVENTS_PER_SOURCE;
  const clickCounts = countByPage(clicks.slice(0, MAX_EVENTS_PER_SOURCE));
  const leadCounts = countByPage(leads.slice(0, MAX_EVENTS_PER_SOURCE));
  const conversionMetrics = aggregateConversionsByPage(conversions.slice(0, MAX_EVENTS_PER_SOURCE));
  const refundMetrics = aggregateRefundsByPage(refunds.slice(0, MAX_EVENTS_PER_SOURCE));
  const viewCounts = countPageScopedViews(analytics.slice(0, MAX_EVENTS_PER_SOURCE), new Set(pageIds));
  const delayedData = range.endExclusive.getTime() > now.getTime() - ANALYTICS_DELAY_MS;

  const rows = visiblePages.map((page) => {
    const views = viewCounts.has(page.id) ? viewCounts.get(page.id)! : null;
    const clicksForPage = clickCounts.get(page.id) ?? 0;
    const submissions = leadCounts.get(page.id) ?? 0;
    const conversionsForPage = conversionMetrics.get(page.id) ?? { count: 0, netAmountCents: 0 };
    const refundsForPage = refundMetrics.get(page.id) ?? { count: 0, amountCents: 0 };
    const analyticsState: TeamFunnelPerformanceRow["analyticsState"] = views === null ? "missing" : delayedData ? "delayed" : "available";
    return {
      pageId: page.id,
      pageSlug: page.slug,
      templateId: page.templateVersion.templateId,
      templateName: page.templateVersion.template.name,
      templateVersion: page.templateVersion.version,
      partnerMembershipId: page.promoterMembershipId,
      partnerName: page.promoter.vendorMember.user.name,
      views,
      clicks: clicksForPage,
      submissions,
      conversions: conversionsForPage.count,
      netConversionAmountCents: conversionsForPage.netAmountCents,
      refundCount: refundsForPage.count,
      refundAmountCents: refundsForPage.amountCents,
      viewToClickRate: percentage(clicksForPage, views),
      viewToSubmissionRate: percentage(submissions, views),
      analyticsState,
    };
  });

  const leaderTemplateScope = visiblePages.some((page) => page.templateVersion.contentOwnerMembershipId === actor.id);
  const partnerSelfScope = visiblePages.some((page) => page.promoterMembershipId === actor.id && page.templateVersion.contentOwnerMembershipId !== actor.id);
  return {
    scope: leaderTemplateScope && partnerSelfScope ? "mixed" : leaderTemplateScope ? "leader_template" : "partner_self",
    range,
    generatedAt: now,
    delayedData,
    truncated: truncated || eventTruncated,
    rows,
    templates: uniqueOptions(rows.map((row) => ({ id: row.templateId, name: row.templateName }))),
    partners: uniqueOptions(rows.map((row) => ({ id: row.partnerMembershipId, name: row.partnerName }))),
  };
}

export function resolvePerformanceRange(startDate: string | null | undefined, endDate: string | null | undefined, timezone: string, now = new Date()) {
  assertTimeZone(timezone);
  const today = formatDateInTimeZone(now, timezone);
  const start = parseLocalDate(startDate ?? daysBefore(today, 29));
  const end = parseLocalDate(endDate ?? today);
  if (start > end) throw new TeamFunnelPerformanceInputError("開始日期不得晚於結束日期");
  const days = Math.round((Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(start.year, start.month - 1, start.day)) / 86_400_000) + 1;
  if (days > MAX_DAYS) throw new TeamFunnelPerformanceInputError(`日期區間最多 ${MAX_DAYS} 天`);
  return {
    start: zonedMidnightToUtc(start, timezone),
    endExclusive: zonedMidnightToUtc(addDays(end, 1), timezone),
    timezone,
  };
}

function countByPage(records: readonly { pageId: string | null }[]) {
  return records.reduce((counts, record) => {
    if (record.pageId) counts.set(record.pageId, (counts.get(record.pageId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
}

function countPageScopedViews(records: readonly { payload: unknown }[], pageIds: ReadonlySet<string>) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const pageId = readPageId(record.payload);
    if (pageId && pageIds.has(pageId)) counts.set(pageId, (counts.get(pageId) ?? 0) + 1);
  }
  return counts;
}

function aggregateConversionsByPage(records: readonly {
  pageId: string | null;
  paymentTransaction: { grossAmountCents: number; refundedAmountCents: number };
}[]) {
  return records.reduce((metrics, record) => {
    if (!record.pageId) return metrics;
    const current = metrics.get(record.pageId) ?? { count: 0, netAmountCents: 0 };
    current.count += 1;
    current.netAmountCents += Math.max(0, record.paymentTransaction.grossAmountCents - record.paymentTransaction.refundedAmountCents);
    metrics.set(record.pageId, current);
    return metrics;
  }, new Map<string, { count: number; netAmountCents: number }>());
}

function aggregateRefundsByPage(records: readonly {
  refundAmountCents: number;
  paymentTransaction: { teamAttribution: { pageId: string | null } | null };
}[]) {
  return records.reduce((metrics, record) => {
    const pageId = record.paymentTransaction.teamAttribution?.pageId;
    if (!pageId) return metrics;
    const current = metrics.get(pageId) ?? { count: 0, amountCents: 0 };
    current.count += 1;
    current.amountCents += record.refundAmountCents;
    metrics.set(pageId, current);
    return metrics;
  }, new Map<string, { count: number; amountCents: number }>());
}

function readPageId(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).pageId;
  return typeof value === "string" && value ? value : null;
}

function percentage(numerator: number, denominator: number | null) {
  if (denominator === null || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function uniqueOptions(values: Array<{ id: string; name: string }>) {
  return [...new Map(values.map((value) => [value.id, value])).values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

type LocalDate = { year: number; month: number; day: number };

function parseLocalDate(value: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TeamFunnelPerformanceInputError("日期格式必須為 YYYY-MM-DD");
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const date = new Date(Date.UTC(result.year, result.month - 1, result.day));
  if (date.getUTCFullYear() !== result.year || date.getUTCMonth() !== result.month - 1 || date.getUTCDate() !== result.day) {
    throw new TeamFunnelPerformanceInputError("日期無效");
  }
  return result;
}

function formatDateInTimeZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function daysBefore(value: string, days: number) {
  const date = parseLocalDate(value);
  return localDateToString(addDays(date, -days));
}

function addDays(date: LocalDate, days: number): LocalDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function localDateToString(date: LocalDate) {
  return `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

function zonedMidnightToUtc(date: LocalDate, timezone: string) {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let instant = target;
  for (let index = 0; index < 2; index += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
    const localAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    instant = target - (localAsUtc - instant);
  }
  return new Date(instant);
}

function assertTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new TeamFunnelPerformanceInputError("時區無效");
  }
}
