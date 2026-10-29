"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACCOUNT_SECURITY_HOLDS_PATH, releaseAccountSecurityHold } from "@/lib/account-security-hold";
import { requestAuditMeta } from "@/lib/audit";
import { requireFinanceAdmin } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { requireRecentMfa } from "@/lib/recent-mfa";

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/u;

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
