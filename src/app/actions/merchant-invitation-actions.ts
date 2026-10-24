"use server";

import { z } from "zod";
import { requireFinanceAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  createMerchantRegistrationInvite,
  merchantRegistrationInviteUrl,
  normalizeMerchantRegistrationEmail,
} from "@/lib/merchant-registration-invite";
import { MERCHANT_INVITATION_AUDIT_ACTION, MERCHANT_INVITATION_NOTE_MAX_LENGTH, type MerchantInvitationActionState } from "@/lib/merchant-invitation-admin";

const InvitationInput = z.object({
  email: z.string().transform(normalizeMerchantRegistrationEmail).pipe(z.string().max(320).email()),
  note: z.string().trim().max(MERCHANT_INVITATION_NOTE_MAX_LENGTH),
});

/**
 * Platform-admin only: signs an invitation link for one merchant email. The
 * link is returned to the admin's page and never emailed; the owner sends it
 * by hand. The audit entry records who invited which email, never the token.
 */
export async function createMerchantInvitationAction(
  _previous: MerchantInvitationActionState,
  formData: FormData,
): Promise<MerchantInvitationActionState> {
  await assertServerActionSecurity(formData);
  const { user } = await requireFinanceAdmin();
  const parsed = InvitationInput.safeParse({ email: String(formData.get("email") ?? ""), note: String(formData.get("note") ?? "") });
  if (!parsed.success) {
    return { status: "error", message: `請輸入有效的 Email；備註最多 ${MERCHANT_INVITATION_NOTE_MAX_LENGTH} 字。` };
  }
  const { email, note } = parsed.data;

  // Platform-scoped lookup: only the platform admin sees this answer.
  const existing = await getDb().user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { status: "error", message: "這個 Email 已經有帳號，請對方直接登入，不需要邀請連結。" };

  let invite: ReturnType<typeof createMerchantRegistrationInvite>;
  let link: string;
  try {
    invite = createMerchantRegistrationInvite({ email });
    link = merchantRegistrationInviteUrl(invite.token);
  } catch {
    return { status: "error", message: "伺服器的簽章密鑰或公開網址尚未設定，暫時無法產生邀請連結。" };
  }

  // The link is shown only after the audit entry is stored.
  try {
    await writeAuditLog({
      vendorId: null,
      actorId: user.id,
      actorLabel: "platform_admin",
      action: MERCHANT_INVITATION_AUDIT_ACTION,
      targetType: "MerchantRegistrationInvite",
      targetId: invite.jti,
      after: { email: invite.email, expiresAt: invite.expiresAt.toISOString(), ...(note ? { note } : {}) },
    });
  } catch {
    return { status: "error", message: "無法寫入稽核紀錄，未產生邀請連結，請稍後再試。" };
  }

  return { status: "created", email: invite.email, link, expiresAt: invite.expiresAt.toISOString() };
}
