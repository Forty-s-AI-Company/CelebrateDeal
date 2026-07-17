import { Plus } from "lucide-react";
import { manageTeamFunnelTemplateAction } from "@/app/actions/team-funnel-template-actions";
import { TeamTemplateList, type TeamTemplateListItem } from "@/components/team-template-list";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireAuth, requireVendor } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function TeamTemplatesPage() {
  const [vendor, auth, csrfToken] = await Promise.all([requireVendor(), requireAuth(), getCsrfToken()]);
  const memberships = await getDb().teamMembership.findMany({
    where: { vendorId: vendor.id, vendorMemberId: auth.member?.id, status: "ACTIVE", leftAt: null },
    select: { id: true, teamId: true, team: { select: { name: true } } },
  });
  const teamIds = memberships.map((membership) => membership.teamId);
  const templates = teamIds.length === 0 ? [] : await getDb().teamFunnelTemplate.findMany({
    where: { vendorId: vendor.id, teamId: { in: teamIds } },
    orderBy: { updatedAt: "desc" },
    include: {
      versions: { orderBy: { version: "desc" }, include: { partnerFunnelPages: { select: { id: true, slug: true, promoterMembershipId: true, sharing: { select: { isEnabled: true } } } } } },
      team: { select: { name: true } },
    },
  });

  const membershipByTeam = new Map(memberships.map((membership) => [membership.teamId, membership.id]));
  const items: TeamTemplateListItem[] = templates.map((template) => {
    const latest = template.versions[0];
    const sourceRecord = template.versions
      .flatMap((version) => version.partnerFunnelPages)
      .find((page) => page.promoterMembershipId === membershipByTeam.get(template.teamId));
    const copiedPartnerCount = new Set(template.versions.flatMap((version) => version.partnerFunnelPages)
      .filter((page) => page.promoterMembershipId !== membershipByTeam.get(template.teamId))
      .map((page) => page.promoterMembershipId)).size;

    return {
      id: template.id,
      name: template.name,
      teamId: template.teamId,
      teamName: template.team.name,
      status: template.status,
      latestVersion: latest?.version ?? 0,
      copiedPartnerCount,
      sourcePage: sourceRecord ? { id: sourceRecord.id, slug: sourceRecord.slug, shareEnabled: sourceRecord.sharing?.isEnabled ?? false } : null,
    };
  });

  return (
    <>
      <PageHeader title="團隊展業" description="建立 A 端原始頁、發佈不可變版本，並用受控分享連結讓夥伴複製。" action={<ButtonLink href="/team-templates/new" tone="cta"><Plus size={16} />建立模板</ButtonLink>} />
      {memberships.length === 0 ? <p role="status" className="mb-4 rounded-md bg-orange-50 p-3 text-sm text-orange-800">你目前沒有可管理的有效團隊，無法建立或發佈團隊模板。</p> : null}
      <TeamTemplateList templates={items} csrfToken={csrfToken} action={manageTeamFunnelTemplateAction} />
    </>
  );
}
