"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkAccountRateLimit } from "@/lib/account-rate-limit";
import { scheduleAccountEmailChangeRequest } from "@/lib/account-email-change";
import { normalizeLoginEmail } from "@/lib/account-email-change-token";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { writeAuditLog } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { verifyPasswordAsync } from "@/lib/password";
import { PASSWORD_INPUT_LIMIT } from "@/lib/password-policy";
import { checkRateLimit } from "@/lib/rate-limit";
import { recentMfaRedirectPath, recentMfaStatus } from "@/lib/recent-mfa";

const SECURITY_PATH = "/settings/security";
const SOURCE_LIMIT = 10;
const SOURCE_WINDOW_MS = 15 * 60 * 1000;

function failure(code: string): never {
  redirect(`${SECURITY_PATH}?error=${code}`);
}

/**
 * Starts a login email change for the signed-in user (變更登入 Email).
 *
 * Nothing in the form names a user: the account, its current address and
 * password hash come from the session. Order: CSRF, session, recent MFA when
 * the account has a factor (the step-up used for other high-risk account
 * operations; accounts without a factor are not forced to enrol), IP limit,
 * per-account limit (counted before the password check, so a stolen session
 * cannot guess the password through this form), input, current password.
 *
 * Every accepted request answers with the same "已寄出驗證信" message. Whether
 * the address is free, the per-recipient limit and both mails are decided
 * after the response (`scheduleAccountEmailChangeRequest`), so neither the
 * message nor its timing says whether another account uses the address.
 */
export async function requestAccountEmailChangeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth({ nextPath: SECURITY_PATH });
  if (auth.user.mfaFactor) {
    const status = recentMfaStatus(auth);
    if (status !== "verified") redirect(recentMfaRedirectPath(status, SECURITY_PATH));
  }

  const incoming = await headers();
  const forwarded = new Headers();
  for (const name of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  const sourceLimited = await checkRateLimit(new Request(getCanonicalAppUrl(), { headers: forwarded }), "account-email-change-source", SOURCE_LIMIT, SOURCE_WINDOW_MS);
  if (sourceLimited) failure(sourceLimited.status === 429 ? "email_change_rate_limited" : "email_change_unavailable");
  const accountLimited = await checkAccountRateLimit("account_email_change_request", auth.user.id);
  if (accountLimited) failure(accountLimited.status === 429 ? "email_change_rate_limited" : "email_change_unavailable");

  const newEmail = normalizeLoginEmail(formData.get("newEmail"));
  if (!newEmail) failure("email_change_invalid");
  if (newEmail === auth.user.email) failure("email_change_same");

  const rawPassword = formData.get("currentPassword");
  // Trimmed like every other password form (login trims submitted passwords).
  const currentPassword = typeof rawPassword === "string" && rawPassword.length <= PASSWORD_INPUT_LIMIT ? rawPassword.trim() : "";
  const actorLabel = auth.member?.role ?? auth.user.platformRole;
  if (!currentPassword || !await verifyPasswordAsync(currentPassword, auth.user.passwordHash)) {
    await writeAuditLog({
      vendorId: auth.vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel,
      action: "account_email_change_password_failed",
      targetType: "User",
      targetId: auth.user.id,
    }).catch(() => undefined);
    failure("email_change_password");
  }

  scheduleAccountEmailChangeRequest({
    userId: auth.user.id,
    currentEmail: auth.user.email,
    newEmail,
    vendorId: auth.vendor?.id ?? null,
    actorLabel,
  });
  redirect(`${SECURITY_PATH}?updated=email_change_sent`);
}
