import { revokeMerchantInvitationAction } from "@/app/actions/merchant-invitation-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { MerchantInvitationForm } from "@/components/merchant-invitation-form";
import { StepUpMfaNotice } from "@/components/step-up-mfa-notice";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { formatInvitationTime, MERCHANT_INVITATIONS_PATH } from "@/lib/merchant-invitation-admin";
import { MERCHANT_REGISTRATION_INVITE_TTL_DAYS } from "@/lib/merchant-registration-invite";
import {
  MERCHANT_INVITE_ACTIVE_LIMIT,
  MERCHANT_INVITE_HISTORY_LIMIT,
  recentMerchantInvitations,
  type MerchantInvitationListItem,
} from "@/lib/merchant-registration-invite-records";
import { recentMfaStatus } from "@/lib/recent-mfa";
import { registrationMode } from "@/lib/registration-mode";

const STATUS_LABELS: Record<MerchantInvitationListItem["status"], string> = {
  registered: "已註冊",
  revoked: "已撤銷",
  expired: "已過期",
  pending: "尚未註冊",
};

const ERRORS: Record<string, string> = {
  revoke_not_found: "找不到這個邀請，未做任何變更。",
};

export default async function AdminMerchantInvitationsPage({ searchParams }: { searchParams: Promise<{ revoked?: string; error?: string }> }) {
  const { user, session } = await requireFinanceAdmin();
  const params = await searchParams;
  const mode = registrationMode();
  const stepUpStatus = recentMfaStatus({ user, session });
  const { items: invitations, activeTruncated } = await recentMerchantInvitations();
  const message = params.revoked ? "邀請已撤銷，這個連結不能再用來註冊。" : params.error ? ERRORS[params.error] ?? ERRORS.revoke_not_found : null;

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
      <div className="mb-4"><StepUpMfaNotice status={stepUpStatus} nextPath={MERCHANT_INVITATIONS_PATH} operation="產生或撤銷商家邀請" /></div>
      {message ? <p role={params.revoked ? "status" : "alert"} className={`mb-4 rounded-md px-3 py-2 text-sm ${params.revoked ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message}</p> : null}
      <MerchantInvitationForm csrfField={<CsrfField />} />
      <section aria-labelledby="recent-merchant-invitations" className="mt-8">
        <h2 id="recent-merchant-invitations" className="mb-1 text-lg font-semibold text-slate-950">最近產生的邀請</h2>
        <p className="mb-3 text-sm text-slate-600">{`近 ${MERCHANT_REGISTRATION_INVITE_TTL_DAYS} 天內產生、可能仍有效的邀請全部列出，另附最近 ${MERCHANT_INVITE_HISTORY_LIMIT} 筆較早的紀錄。為保護個資，只顯示遮罩後的 Email。尚未註冊的邀請可以撤銷；撤銷擋不住已送出的註冊，撤銷後請確認狀態不是「已註冊」。`}</p>
        {activeTruncated ? <p role="alert" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{`仍可能有效的邀請超過 ${MERCHANT_INVITE_ACTIVE_LIMIT} 筆，這裡只列出最新的 ${MERCHANT_INVITE_ACTIVE_LIMIT} 筆；較早的邀請無法在此撤銷，請聯絡工程端。`}</p> : null}
        {invitations.length === 0 ? <EmptyState title="還沒有產生過邀請" description="產生的邀請會記錄在稽核紀錄，並列在這裡。" /> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Email</th>
                  <th scope="col" className="px-3 py-2 font-semibold">產生時間</th>
                  <th scope="col" className="px-3 py-2 font-semibold">有效期限</th>
                  <th scope="col" className="px-3 py-2 font-semibold">狀態</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.jti} className="border-t border-border" data-invitation-status={invitation.status}>
                    <td className="break-all px-3 py-2 text-slate-900">{invitation.maskedEmail ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{formatInvitationTime(invitation.createdAt)}</td>
                    <td className="px-3 py-2 text-slate-700">{invitation.expiresAt ? formatInvitationTime(invitation.expiresAt) : "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{STATUS_LABELS[invitation.status]}</td>
                    <td className="px-3 py-2">
                      {invitation.status === "pending" ? (
                        <form action={revokeMerchantInvitationAction}>
                          <CsrfField />
                          <input type="hidden" name="jti" value={invitation.jti} />
                          <FormSubmitButton
                            className="min-h-11 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                            pendingChildren="撤銷中…"
                            pendingMessage="正在撤銷邀請，請勿重複送出。"
                            aria-label={`撤銷 ${invitation.maskedEmail ?? ""} 的邀請`}
                          >
                            撤銷
                          </FormSubmitButton>
                        </form>
                      ) : null}
                    </td>
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
