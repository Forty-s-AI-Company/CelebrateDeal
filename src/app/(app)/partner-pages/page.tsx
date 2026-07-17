import { ExternalLink, Plus, SquarePen } from "lucide-react";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAuth, requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function PartnerPagesPage() {
  const [vendor, auth] = await Promise.all([requireVendor(), requireAuth()]);
  const memberships = auth.member ? await getDb().teamMembership.findMany({ where: { vendorId: vendor.id, vendorMemberId: auth.member.id, status: "ACTIVE", leftAt: null }, select: { id: true } }) : [];
  const pages = memberships.length ? await getDb().partnerFunnelPage.findMany({
    where: { vendorId: vendor.id, promoterMembershipId: { in: memberships.map((membership) => membership.id) } },
    orderBy: { updatedAt: "desc" },
    include: { sharing: { select: { accessMode: true, isEnabled: true } }, templateVersion: { include: { template: { select: { name: true } } } }, live: { select: { title: true } } },
  }) : [];
  return <>
    <PageHeader title="我的夥伴頁" description="管理從團隊模板取得的頁面、商品槽與公開狀態。" action={<ButtonLink href="/team-template" tone="cta"><Plus size={16} />取得模板</ButtonLink>} />
    {!pages.length ? <EmptyState title="還沒有夥伴頁" description="使用團隊提供的安全分享連結取得模板後，會在這裡管理你的副本。" action={<ButtonLink href="/team-template" tone="cta">開啟取得頁</ButtonLink>} /> : <div className="grid gap-4">{pages.map((page) => {
      const published = page.sharing?.accessMode === "PUBLIC" && page.sharing.isEnabled;
      return <Card key={page.id}><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-950">/{page.slug}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${published ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{published ? "已發布" : "未發布"}</span></div><p className="mt-1 text-sm text-slate-500">{page.templateVersion.template.name} · v{page.templateVersion.version} · {page.live?.title ?? "未綁定研討會"}</p></div><div className="flex gap-2"><ButtonLink href={`/partner-pages/${page.id}/edit`} tone="secondary"><SquarePen size={16} />編輯</ButtonLink>{published ? <ButtonLink href={`/p/${page.slug}`} tone="secondary"><ExternalLink size={16} />公開預覽</ButtonLink> : null}</div></div></Card>;
    })}</div>}
  </>;
}
