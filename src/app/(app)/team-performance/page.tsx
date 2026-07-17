import { EmptyState } from "@/components/ui";
import { TeamPerformanceDashboard } from "@/components/team-performance-dashboard";
import { requireAuth, requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamFunnelPerformanceReport, resolvePerformanceRange } from "@/lib/team-funnel-performance";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function TeamPerformancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [query, vendor, auth] = await Promise.all([searchParams, requireVendor(), requireAuth()]);
  const memberships = auth.member ? await getDb().teamMembership.findMany({
    where: { vendorId: vendor.id, vendorMemberId: auth.member.id, status: "ACTIVE", leftAt: null },
    select: { teamId: true, team: { select: { name: true } } },
    orderBy: { joinedAt: "asc" },
    take: 50,
  }) : [];
  if (memberships.length === 0) {
    return <EmptyState title="沒有可查看的團隊成效" description="你目前沒有有效團隊成員身分，因此沒有可授權的展業資料。" />;
  }

  const teamId = first(query.teamId) && memberships.some((membership) => membership.teamId === first(query.teamId))
    ? first(query.teamId)!
    : memberships[0].teamId;
  const range = resolvePerformanceRange(first(query.startDate), first(query.endDate), vendor.timezone);
  const selected = {
    teamId,
    startDate: first(query.startDate) ?? dateForInput(range.start, vendor.timezone),
    endDate: first(query.endDate) ?? dateForInput(new Date(range.endExclusive.getTime() - 1), vendor.timezone),
    templateId: first(query.templateId) || undefined,
    partnerMembershipId: first(query.partnerMembershipId) || undefined,
  };
  const report = await getTeamFunnelPerformanceReport({ ...selected, timezone: vendor.timezone });

  return <TeamPerformanceDashboard report={report} teams={memberships.map((membership) => ({ id: membership.teamId, name: membership.team.name }))} selected={selected} />;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function dateForInput(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
