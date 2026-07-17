import { notFound } from "next/navigation";
import { manageTeamFunnelTemplateAction } from "@/app/actions/team-funnel-template-actions";
import { TeamTemplateForm } from "@/components/team-template-form";
import { PageHeader } from "@/components/ui";
import { requireAuth, requireVendor } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function EditTeamTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, vendor, auth, csrfToken] = await Promise.all([params, requireVendor(), requireAuth(), getCsrfToken()]);
  const memberships = await getDb().teamMembership.findMany({ where: { vendorId: vendor.id, vendorMemberId: auth.member?.id, status: "ACTIVE", leftAt: null }, include: { team: { select: { name: true } } } });
  const template = await getDb().teamFunnelTemplate.findFirst({
    where: { id, vendorId: vendor.id, teamId: { in: memberships.map((membership) => membership.teamId) } },
    include: { versions: { orderBy: { version: "desc" }, take: 1, include: { fieldLocks: true, productSlots: true } } },
  });
  if (!template || !template.versions[0]) notFound();
  const [products, webinars] = await Promise.all([
    getDb().product.findMany({ where: { vendorId: vendor.id, isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    getDb().live.findMany({ where: { vendorId: vendor.id, teamId: template.teamId }, select: { id: true, title: true, scheduledAt: true }, orderBy: { scheduledAt: "desc" } }),
  ]);
  const version = template.versions[0];
  const source = await getDb().partnerFunnelPage.findFirst({
    where: {
      vendorId: vendor.id,
      teamId: template.teamId,
      promoterMembershipId: memberships.find((membership) => membership.teamId === template.teamId)?.id,
      templateVersion: { templateId: template.id },
    },
    select: { id: true, slug: true, liveId: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <>
      <PageHeader title={`編輯 ${template.name}`} description={`目前版本 v${version.version}；發布後會建立新的不可變版本。`} />
      <TeamTemplateForm
        template={{ id: template.id, name: template.name, teamId: template.teamId, sourcePageId: source?.id, slug: source?.slug ?? `${template.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-v${version.version}`, webinarId: source?.liveId, headline: version.headline, subheadline: version.subheadline, body: version.body, ctaLabel: version.ctaLabel, ctaUrl: version.ctaUrl, lockedFields: version.fieldLocks.map((lock) => lock.field), productSlots: Object.fromEntries(version.productSlots.map((slot) => [slot.slotKey, { productId: slot.productId, offerLabel: slot.offerLabel }])) }}
        teams={memberships.map((membership) => ({ id: membership.teamId, name: membership.team.name }))}
        products={products}
        webinars={webinars.map((webinar) => ({ ...webinar, scheduledAt: webinar.scheduledAt.toLocaleString("zh-TW") }))}
        csrfToken={csrfToken}
        action={manageTeamFunnelTemplateAction}
      />
    </>
  );
}
