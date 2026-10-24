"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireFinanceAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  MERCHANT_INVITATION_AUDIT_ACTION,
  MERCHANT_INVITATION_REVOKED_AUDIT_ACTION,
  MERCHANT_INVITATIONS_PATH,
  type MerchantInvitationActionState,
} from "@/lib/merchant-invitation-admin";
import {
  createMerchantRegistrationInvite,
  merchantRegistrationInviteUrl,
  normalizeMerchantRegistrationEmail,
} from "@/lib/merchant-registration-invite";
import {
  findMerchantRegistrationInvite,
  isMerchantRegistrationInviteRevoked,
  maskedMerchantInviteEmail,
  MERCHANT_INVITE_AUDIT_TARGET_TYPE,
  merchantInviteEmailHash,
} from "@/lib/merchant-registration-invite-records";
import { requireRecentMfa } from "@/lib/recent-mfa";

const InvitationEmail = z.string().transform(normalizeMerchantRegistrationEmail).pipe(z.string().max(320).email());
const JTI = /^[A-Za-z0-9_-]{16,64}$/u;

/**
 * Platform-admin only, with a recent MFA step-up: signs an invitation link for
 * one merchant email. The link is returned to the admin's page and never
 * emailed; the owner sends it by hand. The audit entry records who invited
 * whom as a masked address plus a keyed hash, never the token.
 */
export async function createMerchantInvitationAction(
  _previous: MerchantInvitationActionState,
  formData: FormData,
): Promise<MerchantInvitationActionState> {
  await assertServerActionSecurity(formData);
  const auth = await requireFinanceAdmin();
  // Each invitation creates a workspace owner (F-027 step-up, like member invitations).
  requireRecentMfa(auth, { nextPath: MERCHANT_INVITATIONS_PATH });
  const parsed = InvitationEmail.safeParse(String(formData.get("email") ?? ""));
  if (!parsed.success) return { status: "error", message: "請輸入有效的 Email。" };
  const email = parsed.data;

  // Platform-scoped lookup: only the platform admin sees this answer.
  const existing = await getDb().user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { status: "error", message: "這個 Email 已經有帳號，請對方直接登入，不需要邀請連結。" };

  let invite: ReturnType<typeof createMerchantRegistrationInvite>;
  let link: string;
  let emailHash: string;
  try {
    invite = createMerchantRegistrationInvite({ email });
    link = merchantRegistrationInviteUrl(invite.token);
    emailHash = merchantInviteEmailHash(invite.email);
  } catch {
    return { status: "error", message: "伺服器的簽章密鑰或公開網址尚未設定，暫時無法產生邀請連結。" };
  }

  // The link is shown only after the audit entry is stored.
  try {
    await writeAuditLog({
      vendorId: null,
      actorId: auth.user.id,
      actorLabel: "platform_admin",
      action: MERCHANT_INVITATION_AUDIT_ACTION,
      targetType: MERCHANT_INVITE_AUDIT_TARGET_TYPE,
      targetId: invite.jti,
      after: { maskedEmail: maskedMerchantInviteEmail(invite.email), emailHash, expiresAt: invite.expiresAt.toISOString() },
    });
  } catch {
    return { status: "error", message: "無法寫入稽核紀錄，未產生邀請連結，請稍後再試。" };
  }
  revalidatePath(MERCHANT_INVITATIONS_PATH);
  return { status: "created", email: invite.email, link, expiresAt: invite.expiresAt.toISOString() };
}

/**
 * Platform-admin only, with a recent MFA step-up: an appended revocation entry
 * makes /register reject the invitation's token. An account already created
 * with it is not touched.
 */
export async function revokeMerchantInvitationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireFinanceAdmin();
  requireRecentMfa(auth, { nextPath: MERCHANT_INVITATIONS_PATH });
  const jti = String(formData.get("jti") ?? "");
  if (!JTI.test(jti)) redirect(`${MERCHANT_INVITATIONS_PATH}?error=revoke_not_found`);
  const db = getDb();
  const issued = await findMerchantRegistrationInvite(jti, db);
  if (!issued) redirect(`${MERCHANT_INVITATIONS_PATH}?error=revoke_not_found`);
  if (await isMerchantRegistrationInviteRevoked(jti, db)) redirect(`${MERCHANT_INVITATIONS_PATH}?revoked=1`);
  const maskedEmail = issued.after && typeof issued.after === "object" && !Array.isArray(issued.after)
    ? (issued.after as Record<string, unknown>).maskedEmail
    : null;
  await writeAuditLog({
    vendorId: null,
    actorId: auth.user.id,
    actorLabel: "platform_admin",
    action: MERCHANT_INVITATION_REVOKED_AUDIT_ACTION,
    targetType: MERCHANT_INVITE_AUDIT_TARGET_TYPE,
    targetId: jti,
    after: { maskedEmail: typeof maskedEmail === "string" ? maskedEmail : null },
  });
  revalidatePath(MERCHANT_INVITATIONS_PATH);
  redirect(`${MERCHANT_INVITATIONS_PATH}?revoked=1`);
}
