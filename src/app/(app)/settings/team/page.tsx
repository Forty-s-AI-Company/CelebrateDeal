import Link from "next/link";
import {
  deactivateVendorMemberAction,
  inviteVendorMemberAction,
  revokeVendorInvitationAction,
  switchWorkspaceAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, DangerButton, Field, PageHeader, SelectField, SubmitButton } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

const errorMessages: Record<string, string> = {
  invite_unavailable: "無法建立或更新這份邀請，請確認對方尚未加入且沒有有效邀請。",
  invite_delivery: "邀請信寄送失敗，原邀請已撤銷，請稍後再試。",
  workspace_unavailable: "無法切換到指定工作區。",
  member_not_found: "找不到可停用的成員。",
  self_deactivate: "不能停用自己的帳號。",
  last_owner: "至少要保留一位 active owner。",
  owner_step_up_required: "邀請另一位 owner 前，請先在安全設定完成 MFA，並驗證目前 session。",
};

const updatedMessages: Record<string, string> = {
  invitation_sent: "邀請已建立。",
  invitation_revoked: "邀請已撤銷。",
  member_deactivated: "成員已停用，該工作區的 session 已撤銷。",
};

function invitationStatus(invitation: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}) {
  if (invitation.acceptedAt) return { label: "accepted", tone: "green" as const };
  if (invitation.revokedAt) return { label: "revoked", tone: "gray" as const };
  if (invitation.expiresAt <= new Date()) return { label: "expired", tone: "orange" as const };
  return { label: "pending", tone: "blue" as const };
}

export default async function TeamSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string; preview?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireAuth();
  const vendorId = auth.vendor?.id;
  const isOwner = auth.member?.role === "owner";
  const [memberships, members, invitations] = await Promise.all([
    getDb().vendorMember.findMany({
      where: { userId: auth.user.id, status: "active" },
      include: { vendor: true },
      orderBy: { createdAt: "asc" },
    }),
    vendorId
      ? getDb().vendorMember.findMany({
          where: { vendorId },
          include: { user: true },
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        })
      : [],
    vendorId
      ? getDb().vendorInvitation.findMany({
          where: { vendorId },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [],
  ]);

  return (
    <>
      <PageHeader title="團隊與工作區" description="切換目前工作區，並管理成員邀請與存取狀態。" />
      {params.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{updatedMessages[params.updated] ?? "已更新。"}</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "操作失敗，請確認權限與輸入內容。"}</p> : null}
      {params.preview && process.env.NODE_ENV !== "production" ? (
        <p className="mb-4 break-all rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          本機寄信未設定，邀請預覽：<Link className="font-semibold underline" href={params.preview}>{params.preview}</Link>
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <h2 className="text-lg font-semibold text-slate-950">我的工作區</h2>
          <p className="mt-1 text-sm text-slate-500">只會顯示目前帳號的 active membership。</p>
          <div className="mt-4 grid gap-3">
            {memberships.map((membership) => {
              const selected = membership.vendorId === vendorId;
              return (
                <div key={membership.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{membership.vendor.name}</p>
                    <p className="text-xs text-slate-500">{membership.role}</p>
                  </div>
                  {selected ? (
                    <Badge tone="green">目前使用</Badge>
                  ) : (
                    <form action={switchWorkspaceAction}>
                      <CsrfField />
                      <input type="hidden" name="vendorId" value={membership.vendorId} />
                      <button className="h-9 rounded-md border border-border px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
                        切換
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">邀請成員</h2>
              <p className="mt-1 text-sm text-slate-500">邀請連結 72 小時內有效且只能使用一次，不會建立明文初始密碼。</p>
            </div>
            <Badge tone={isOwner ? "green" : "gray"}>{isOwner ? "owner" : auth.member?.role ?? "member"}</Badge>
          </div>
          {isOwner ? (
            <form action={inviteVendorMemberAction} className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
              <CsrfField />
              <Field label="Email" name="email" type="email" placeholder="member@example.com" required />
              <SelectField label="角色" name="role" defaultValue="accountant">
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="accountant">Accountant</option>
              </SelectField>
              <SubmitButton>寄送邀請</SubmitButton>
            </form>
          ) : (
            <p className="mt-4 rounded-md border border-border bg-slate-50 p-4 text-sm text-slate-600">只有 owner 可以邀請或停用成員。</p>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-950">成員</h2>
            <Badge tone="blue">{members.filter((member) => member.status === "active").length} active</Badge>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr><th className="px-4 py-3">成員</th><th className="px-4 py-3">角色</th><th className="px-4 py-3">狀態</th><th className="px-4 py-3 text-right">操作</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="px-4 py-3"><p className="font-semibold text-slate-900">{member.user.name}</p><p className="text-xs text-slate-500">{member.user.email}</p></td>
                    <td className="px-4 py-3 text-slate-600">{member.role}</td>
                    <td className="px-4 py-3"><Badge tone={member.status === "active" ? "green" : "gray"}>{member.status}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      {isOwner && member.status === "active" && member.userId !== auth.user.id ? (
                        <form action={deactivateVendorMemberAction}>
                          <CsrfField />
                          <input type="hidden" name="id" value={member.id} />
                          <DangerButton>停用</DangerButton>
                        </form>
                      ) : <span className="text-xs text-slate-400">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-950">邀請紀錄</h2>
            <Badge tone="gray">最近 {invitations.length} 筆</Badge>
          </div>
          <div className="grid gap-3">
            {invitations.length === 0 ? <p className="rounded-md border border-border bg-slate-50 p-4 text-sm text-slate-500">尚無邀請紀錄。</p> : null}
            {invitations.map((invitation) => {
              const status = invitationStatus(invitation);
              return (
                <div key={invitation.id} className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{invitation.email}</p>
                    <p className="mt-1 text-xs text-slate-500">{invitation.role} · 到期 {invitation.expiresAt.toLocaleString("zh-TW")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {isOwner && status.label === "pending" ? (
                      <form action={revokeVendorInvitationAction}>
                        <CsrfField />
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <button className="h-9 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400">撤銷</button>
                      </form>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}
