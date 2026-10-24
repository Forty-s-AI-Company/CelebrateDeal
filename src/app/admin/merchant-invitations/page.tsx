import { CsrfField } from "@/components/csrf-field";
import { MerchantInvitationForm } from "@/components/merchant-invitation-form";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatInvitationTime, MERCHANT_INVITATION_AUDIT_ACTION } from "@/lib/merchant-invitation-admin";
import { MERCHANT_REGISTRATION_INVITE_TTL_DAYS } from "@/lib/merchant-registration-invite";
import { registrationMode } from "@/lib/registration-mode";

const RECENT_LIMIT = 30;

type InvitationAuditAfter = { email?: unknown; expiresAt?: unknown; note?: unknown };

function readAfter(value: unknown) {
  const after = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as InvitationAuditAfter;
  return {
    email: typeof after.email === "string" ? after.email : null,
    expiresAt: typeof after.expiresAt === "string" ? after.expiresAt : null,
    note: typeof after.note === "string" ? after.note : null,
  };
}

/** Recent invitations from their audit entries, with a status read at request time. */
async function recentInvitations(now = new Date()) {
  const db = getDb();
  const entries = await db.auditLog.findMany({
    where: { action: MERCHANT_INVITATION_AUDIT_ACTION, vendorId: null },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: { id: true, createdAt: true, after: true },
  });
  const invitations = entries.map((entry) => ({ id: entry.id, createdAt: entry.createdAt, ...readAfter(entry.after) }));
  const emails = [...new Set(invitations.flatMap((invitation) => invitation.email ? [invitation.email] : []))];
  const registered = new Set(emails.length > 0
    ? (await db.user.findMany({ where: { email: { in: emails } }, select: { email: true } })).map((user) => user.email)
    : []);
  return invitations.map((invitation) => {
    const expired = invitation.expiresAt ? new Date(invitation.expiresAt) <= now : false;
    const status = invitation.email && registered.has(invitation.email) ? "已註冊" : expired ? "已過期" : "尚未註冊";
    return { ...invitation, status };
  });
}

export default async function AdminMerchantInvitationsPage() {
  await requireFinanceAdmin();
  const mode = registrationMode();
  const invitations = await recentInvitations();

  return (
    <>
      <PageHeader
        title="商家邀請"
        description={`封測期間只有受邀商家能註冊。輸入商家的 Email 產生專屬邀請連結（${MERCHANT_REGISTRATION_INVITE_TTL_DAYS} 天內有效），系統不會自動寄信，請自行寄給對方。`}
      />
      <p role="status" className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700" data-registration-mode={mode}>
        {mode === "invite"
          ? "目前註冊模式：僅限受邀（REGISTRATION_MODE=invite）。沒有邀請連結的人無法建立商家帳號。"
          : "目前註冊模式：開放註冊（REGISTRATION_MODE=open）。任何人都能註冊，邀請連結仍可使用但不是必要。"}
      </p>
      <MerchantInvitationForm csrfField={<CsrfField />} />
      <section aria-labelledby="recent-merchant-invitations" className="mt-8">
        <h2 id="recent-merchant-invitations" className="mb-3 text-lg font-semibold text-slate-950">最近產生的邀請</h2>
        {invitations.length === 0 ? <EmptyState title="還沒有產生過邀請" description="產生的邀請會記錄在稽核紀錄，並列在這裡。" /> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Email</th>
                  <th scope="col" className="px-3 py-2 font-semibold">產生時間</th>
                  <th scope="col" className="px-3 py-2 font-semibold">有效期限</th>
                  <th scope="col" className="px-3 py-2 font-semibold">狀態</th>
                  <th scope="col" className="px-3 py-2 font-semibold">備註</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id} className="border-t border-border">
                    <td className="break-all px-3 py-2 text-slate-900">{invitation.email ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{formatInvitationTime(invitation.createdAt)}</td>
                    <td className="px-3 py-2 text-slate-700">{invitation.expiresAt ? formatInvitationTime(invitation.expiresAt) : "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{invitation.status}</td>
                    <td className="px-3 py-2 text-slate-600">{invitation.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
