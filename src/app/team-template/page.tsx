import { ShieldAlert } from "lucide-react";
import { claimTeamTemplateAction } from "@/app/actions/team-funnel-partner-actions";
import { TeamTemplateClaim, TeamTemplateClaimError } from "@/components/team-template-claim";
import { Card, PageHeader } from "@/components/ui";
import { requireAuth, requireVendor } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { hashShareCode } from "@/lib/team-funnel-sharing";

type ShareProblem = "missing" | "expired" | "disabled" | "not_team";

function shareAudience(share: string): { type: "DIRECT_DOWNLINE" } | { type: "MEMBER"; membershipId: string } | null {
  const [version, encoded, entropy, ...rest] = share.split(".");
  if (version !== "tf1" || !encoded || !entropy || rest.length || entropy.length < 32) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object") return null;
    const audience = (claims as { audience?: unknown }).audience;
    if (!audience || typeof audience !== "object") return null;
    if ((audience as { type?: unknown }).type === "DIRECT_DOWNLINE") return { type: "DIRECT_DOWNLINE" };
    const membershipId = (audience as { membershipId?: unknown }).membershipId;
    return (audience as { type?: unknown }).type === "MEMBER" && typeof membershipId === "string" && membershipId.length > 0 ? { type: "MEMBER", membershipId } : null;
  } catch {
    return null;
  }
}

function ShareError({ problem }: { problem: ShareProblem }) {
  if (problem !== "missing") return <TeamTemplateClaimError state={problem} />;
  const content = {
    missing: ["找不到分享連結", "請確認分享連結完整且尚未被撤銷。"],
    expired: ["", ""], disabled: ["", ""], not_team: ["", ""],
  }[problem];
  return <Card className="mx-auto max-w-xl text-center"><ShieldAlert className="mx-auto text-orange-600" size={28} /><h1 className="mt-3 text-xl font-semibold text-slate-950">{content[0]}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{content[1]}</p></Card>;
}

export default async function TeamTemplateClaimPage({ searchParams }: { searchParams: Promise<{ share?: string }> }) {
  const [{ share }, vendor, auth, csrfToken] = await Promise.all([searchParams, requireVendor(), requireAuth(), getCsrfToken()]);
  if (!share) return <><PageHeader title="取得團隊模板" description="請使用夥伴提供的安全分享連結開啟此頁。" /><ShareError problem="missing" /></>;

  const setting = await getDb().partnerFunnelPageShareSetting.findFirst({
    where: { tokenHash: hashShareCode(share) },
    include: {
      page: {
        include: {
          contentOwner: { include: { vendorMember: { include: { user: { select: { name: true } } } } } },
          live: { select: { title: true } },
          templateVersion: { include: { template: { select: { name: true } }, fieldLocks: { select: { field: true } } } },
        },
      },
    },
  });
  if (!setting) return <><PageHeader title="取得團隊模板" /><ShareError problem="missing" /></>;
  if (!setting.isEnabled || setting.accessMode === "DISABLED") return <><PageHeader title="取得團隊模板" /><ShareError problem="disabled" /></>;
  if (setting.expiresAt && setting.expiresAt <= new Date()) return <><PageHeader title="取得團隊模板" /><ShareError problem="expired" /></>;
  if (setting.page.vendorId !== vendor.id) return <><PageHeader title="取得團隊模板" /><ShareError problem="not_team" /></>;
  const membership = auth.member ? await getDb().teamMembership.findFirst({ where: { vendorId: vendor.id, teamId: setting.page.teamId, vendorMemberId: auth.member.id, status: "ACTIVE", leftAt: null }, select: { id: true } }) : null;
  if (!membership) return <><PageHeader title="取得團隊模板" /><ShareError problem="not_team" /></>;
  const audience = shareAudience(share);
  if (!audience) return <><PageHeader title="取得團隊模板" /><ShareError problem="missing" /></>;
  if (audience.type === "MEMBER" && audience.membershipId !== membership.id) return <><PageHeader title="取得團隊模板" /><ShareError problem="not_team" /></>;
  if (audience.type === "DIRECT_DOWNLINE") {
    const relationship = await getDb().teamMembershipRelationship.findFirst({
      where: { teamId: setting.page.teamId, uplineMembershipId: setting.page.promoterMembershipId, downlineMembershipId: membership.id, effectiveAt: { lte: new Date() }, OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }] },
      select: { id: true },
    });
    if (!relationship) return <><PageHeader title="取得團隊模板" /><ShareError problem="not_team" /></>;
  }

  return <>
    <PageHeader title="取得團隊模板" description="建立前請確認來源、版本、研討會與可編輯範圍。" />
    <TeamTemplateClaim
      csrfToken={csrfToken}
      action={claimTeamTemplateAction}
      template={{
        teamId: setting.page.teamId,
        shareCode: share,
        sourceOwnerName: setting.page.contentOwner.vendorMember.user.name,
        templateName: setting.page.templateVersion.template.name,
        version: setting.page.templateVersion.version,
        webinar: setting.page.live?.title ?? null,
        lockedFields: setting.page.templateVersion.fieldLocks.map((lock) => lock.field),
      }}
    />
  </>;
}
