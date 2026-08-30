import { ExternalLink, Plus, SquarePen } from "lucide-react";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { TeamLiveShareManager, type TeamLiveSharePage } from "@/components/team-live-share-manager";
import { getCsrfToken } from "@/lib/csrf";
import { requireAuth, requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

type TeamMembershipForShare = {
  id: string;
  teamId: string;
  vendorMemberId: string;
  vendorMember: { user: { name: string | null; email: string } };
  downlineRelationships: Array<{ uplineMembershipId: string }>;
};

type PartnerPageForShare = {
  id: string;
  teamId: string;
  slug: string;
  headline: string;
  promoterMembershipId: string;
  contentOwnerMembershipId: string;
  live: {
    id: string;
    title: string;
    status: string;
    replayEnabled: boolean;
    seminarOwnerMembershipId: string | null;
  } | null;
  liveShares: Array<{ promoterMembershipId: string; expiresAt: Date | null }>;
};

function buildLiveSharePages(
  currentMemberships: Array<{ team: { memberships: TeamMembershipForShare[] } }>,
  pages: PartnerPageForShare[],
): TeamLiveSharePage[] {
  return pages.flatMap((page) => {
    const team = currentMemberships.find((membership) => membership.team.memberships.some((candidate) => candidate.id === page.promoterMembershipId))?.team;
    const source = team?.memberships.find((membership) => membership.id === page.promoterMembershipId);
    const live = page.live;
    if (
      !team
      || !source
      || !live
      || live.seminarOwnerMembershipId !== page.contentOwnerMembershipId
      || !["scheduled", "live"].includes(live.status) && !(live.status === "ended" && live.replayEnabled)
    ) return [];

    const targets = team.memberships
      .filter((candidate) => candidate.id !== source.id && candidate.downlineRelationships.some((relationship) => relationship.uplineMembershipId === source.id))
      .map((candidate) => ({
        membershipId: candidate.id,
        label: candidate.vendorMember.user.name || candidate.vendorMember.user.email,
        email: candidate.vendorMember.user.email,
        activeShare: page.liveShares.find((share) => share.promoterMembershipId === candidate.id)
          ? { expiresAt: page.liveShares.find((share) => share.promoterMembershipId === candidate.id)?.expiresAt?.toISOString() ?? null }
          : null,
      }));

    return [{
      id: page.id,
      teamId: page.teamId,
      slug: page.slug,
      headline: page.headline,
      liveTitle: live.title,
      liveStatus: live.status,
      targets,
    }];
  });
}

export default async function PartnerPagesPage() {
  const [vendor, auth] = await Promise.all([requireVendor(), requireAuth()]);
  const memberships = auth.member ? await getDb().teamMembership.findMany({
    where: { vendorId: vendor.id, vendorMemberId: auth.member.id, status: "ACTIVE", leftAt: null },
    include: {
      team: {
        include: {
          memberships: {
            where: { status: "ACTIVE", leftAt: null },
            orderBy: { createdAt: "asc" },
            include: {
              vendorMember: { include: { user: { select: { name: true, email: true } } } },
              downlineRelationships: { where: { endedAt: null }, select: { uplineMembershipId: true } },
            },
          },
        },
      },
    },
  }) : [];
  const pages = memberships.length ? await getDb().partnerFunnelPage.findMany({
    where: { vendorId: vendor.id, promoterMembershipId: { in: memberships.map((membership) => membership.id) } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      teamId: true,
      slug: true,
      headline: true,
      promoterMembershipId: true,
      contentOwnerMembershipId: true,
      sharing: { select: { accessMode: true, isEnabled: true } },
      templateVersion: { select: { version: true, template: { select: { name: true } } } },
      live: { select: { id: true, title: true, status: true, replayEnabled: true, seminarOwnerMembershipId: true } },
      liveShares: { where: { isEnabled: true }, select: { promoterMembershipId: true, expiresAt: true } },
    },
  }) : [];
  const csrfToken = await getCsrfToken();
  const liveSharePages = buildLiveSharePages(memberships, pages);
  return <>
    <PageHeader title="我的夥伴頁" description="管理從團隊模板取得的頁面、商品槽與公開狀態。" action={<ButtonLink href="/team-template" tone="cta"><Plus size={16} />取得模板</ButtonLink>} />
    {!pages.length ? <EmptyState title="還沒有夥伴頁" description="使用團隊提供的安全分享連結取得模板後，會在這裡管理你的副本。" action={<ButtonLink href="/team-template" tone="cta">開啟取得頁</ButtonLink>} /> : <div className="grid gap-4">{pages.map((page) => {
      const published = page.sharing?.accessMode === "PUBLIC" && page.sharing.isEnabled;
      return <Card key={page.id}><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-950">/{page.slug}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${published ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{published ? "已發布" : "未發布"}</span></div><p className="mt-1 text-sm text-slate-500">{page.templateVersion.template.name} · v{page.templateVersion.version} · {page.live?.title ?? "未綁定研討會"}</p></div><div className="flex gap-2"><ButtonLink href={`/partner-pages/${page.id}/edit`} tone="secondary"><SquarePen size={16} />編輯</ButtonLink>{published ? <ButtonLink href={`/p/${page.slug}`} tone="secondary"><ExternalLink size={16} />公開預覽</ButtonLink> : null}</div></div></Card>;
    })}</div>}
    <TeamLiveShareManager csrfToken={csrfToken} pages={liveSharePages} />
  </>;
}
