import { notFound } from "next/navigation";
import { savePartnerPageAction, setPartnerPagePublishAction } from "@/app/actions/team-funnel-partner-actions";
import { PartnerPageEditor, type PartnerPageEditorData } from "@/components/partner-page-editor";
import { PageHeader } from "@/components/ui";
import { requireAuth, requireVendor } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function EditPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, vendor, auth, csrfToken] = await Promise.all([params, requireVendor(), requireAuth(), getCsrfToken()]);
  const memberships = auth.member ? await getDb().teamMembership.findMany({ where: { vendorId: vendor.id, vendorMemberId: auth.member.id, status: "ACTIVE", leftAt: null }, select: { id: true } }) : [];
  const page = await getDb().partnerFunnelPage.findFirst({
    where: { id, vendorId: vendor.id, promoterMembershipId: { in: memberships.map((membership) => membership.id) } },
    include: {
      sharing: { select: { accessMode: true, isEnabled: true } },
      promoter: { include: { vendorMember: { include: { user: { select: { name: true, email: true } } } } } },
      live: { select: { title: true } },
      templateVersion: { include: { template: { select: { name: true } }, contentOwner: { include: { vendorMember: { include: { user: { select: { name: true } } } } } }, fieldLocks: { select: { field: true } }, productSlots: { select: { id: true, slotKey: true } } } },
      productOverrides: { select: { productSlotId: true, productId: true, overrideUrl: true } },
    },
  });
  if (!page) notFound();
  const products = await getDb().product.findMany({ where: { vendorId: vendor.id, isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } });
  const overrideBySlot = new Map(page.productOverrides.map((override) => [override.productSlotId, override]));
  const editorPage: PartnerPageEditorData = {
    id: page.id, teamId: page.teamId, slug: page.slug, headline: page.headline, subheadline: page.subheadline, body: page.body, ctaLabel: page.ctaLabel, ctaUrl: page.ctaUrl,
    source: { name: page.templateVersion.template.name, ownerName: page.templateVersion.contentOwner.vendorMember.user.name, version: page.templateVersion.version, webinar: page.live?.title ?? null },
    lockedFields: page.templateVersion.fieldLocks.map((lock) => lock.field), partner: { name: page.promoter.vendorMember.user.name, email: page.promoter.vendorMember.user.email },
    isPublished: page.sharing?.accessMode === "PUBLIC" && page.sharing.isEnabled,
    slots: ["main_product", "bundle_product", "join_member", "consultation"].map((key) => {
      const templateSlot = page.templateVersion.productSlots.find((slot) => slot.slotKey === key); const override = templateSlot ? overrideBySlot.get(templateSlot.id) : undefined;
      return { key, available: Boolean(templateSlot), productId: override?.productId ?? null, overrideUrl: override?.overrideUrl ?? null };
    }),
  };
  return <><PageHeader title="編輯夥伴頁" description={`/p/${page.slug} 的內容、個人資料、商品槽與公開狀態。`} /><PartnerPageEditor page={editorPage} products={products} csrfToken={csrfToken} saveAction={savePartnerPageAction} publishAction={setPartnerPagePublishAction} /></>;
}
