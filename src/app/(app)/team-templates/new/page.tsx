import { manageTeamFunnelTemplateAction } from "@/app/actions/team-funnel-template-actions";
import { TeamTemplateForm } from "@/components/team-template-form";
import { PageHeader } from "@/components/ui";
import { requireAuth, requireVendor } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function NewTeamTemplatePage() {
  const [vendor, auth, csrfToken] = await Promise.all([requireVendor(), requireAuth(), getCsrfToken()]);
  const [memberships, products] = await Promise.all([
    getDb().teamMembership.findMany({ where: { vendorId: vendor.id, vendorMemberId: auth.member?.id, status: "ACTIVE", leftAt: null }, include: { team: { select: { name: true } } } }),
    getDb().product.findMany({ where: { vendorId: vendor.id, isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const teamIds = memberships.map((membership) => membership.teamId);
  const webinars = teamIds.length === 0 ? [] : await getDb().live.findMany({
    where: { vendorId: vendor.id, teamId: { in: teamIds }, seminarOwnerMembershipId: { in: memberships.map((membership) => membership.id) } },
    select: { id: true, title: true, scheduledAt: true }, orderBy: { scheduledAt: "desc" },
  });

  return (
    <>
      <PageHeader title="建立團隊原始頁" description="先配置 A 端內容與限制；夥伴複製後會保留版本與鎖定規則。" />
      <TeamTemplateForm teams={memberships.map((membership) => ({ id: membership.teamId, name: membership.team.name }))} products={products} webinars={webinars.map((webinar) => ({ ...webinar, scheduledAt: webinar.scheduledAt.toLocaleString("zh-TW") }))} csrfToken={csrfToken} action={manageTeamFunnelTemplateAction} />
    </>
  );
}
