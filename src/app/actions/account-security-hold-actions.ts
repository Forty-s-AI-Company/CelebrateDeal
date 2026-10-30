"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ACCOUNT_SECURITY_HOLDS_PATH,
  findAccountIdByLoginEmail,
  normalizeMfaRemovalReason,
  releaseAccountSecurityHold,
  removeAccountMfaBySupport,
} from "@/lib/account-security-hold";
import { requestAuditMeta } from "@/lib/audit";
import { requireFinanceAdmin } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { requireRecentMfa } from "@/lib/recent-mfa";

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const MFA_SECTION = "#mfa-removal";

/**
 * Platform support releases an account from security hold after verifying
 * the owner out of band (docs/launch/account-security-hold-runbook.md).
 * Platform admin with a recent MFA step-up. The form names the account;
 * `releaseAccountSecurityHold` changes it only while it is on hold.
 */
export async function releaseAccountSecurityHoldAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireFinanceAdmin();
  requireRecentMfa(auth, { nextPath: ACCOUNT_SECURITY_HOLDS_PATH });
  const userId = formData.get("userId");
  if (typeof userId !== "string" || !USER_ID.test(userId)) redirect(`${ACCOUNT_SECURITY_HOLDS_PATH}?error=not_held`);
  const meta = await requestAuditMeta();
  const result = await releaseAccountSecurityHold({
    userId,
    actorId: auth.user.id,
    removeMfaFactor: formData.get("removeMfaFactor") === "on",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });
  revalidatePath(ACCOUNT_SECURITY_HOLDS_PATH);
  redirect(result.status === "released" ? `${ACCOUNT_SECURITY_HOLDS_PATH}?released=1` : `${ACCOUNT_SECURITY_HOLDS_PATH}?error=not_held`);
}

function mfaRemovalPath(params: Record<string, string>) {
  return `${ACCOUNT_SECURITY_HOLDS_PATH}?${new URLSearchParams(params).toString()}${MFA_SECTION}`;
}

/**
 * Step 1 of the support MFA removal tool: find the account by its login
 * email. The address travels only in this POST body; the page URL carries
 * the account id, and the page shows the masked address.
 */
export async function lookupAccountForMfaRemovalAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireFinanceAdmin();
  requireRecentMfa(auth, { nextPath: ACCOUNT_SECURITY_HOLDS_PATH });
  const userId = await findAccountIdByLoginEmail(formData.get("email"));
  redirect(userId ? mfaRemovalPath({ mfaUser: userId }) : mfaRemovalPath({ mfaError: "not_found" }));
}

/**
 * Step 2: remove every MFA factor and recovery code of an active account and
 * end its sessions. Platform admin with a recent MFA step-up, never on the
 * admin's own account, with the masked address retyped and a reason that the
 * audit entry keeps. `removeAccountMfaBySupport` re-checks all of it under
 * the user's row lock.
 */
export async function removeAccountMfaAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireFinanceAdmin();
  requireRecentMfa(auth, { nextPath: ACCOUNT_SECURITY_HOLDS_PATH });
  const userId = formData.get("userId");
  if (typeof userId !== "string" || !USER_ID.test(userId)) redirect(mfaRemovalPath({ mfaError: "not_found" }));
  if (userId === auth.user.id) redirect(mfaRemovalPath({ mfaUser: userId, mfaError: "self" }));
  const reason = normalizeMfaRemovalReason(formData.get("reason"));
  if (!reason) redirect(mfaRemovalPath({ mfaUser: userId, mfaError: "invalid_reason" }));
  const confirmation = formData.get("confirmation");
  if (typeof confirmation !== "string" || !confirmation.trim()) redirect(mfaRemovalPath({ mfaUser: userId, mfaError: "confirmation_mismatch" }));

  const meta = await requestAuditMeta();
  const result = await removeAccountMfaBySupport({
    userId,
    actorId: auth.user.id,
    confirmation,
    reason,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });
  revalidatePath(ACCOUNT_SECURITY_HOLDS_PATH);
  redirect(result.status === "removed" ? mfaRemovalPath({ mfaRemoved: "1" }) : mfaRemovalPath({ mfaUser: userId, mfaError: result.status }));
}
