"use server";
import { safeInternalPathOr } from "@/lib/safe-internal-path";
import { withMfaReturnPath } from "@/lib/mfa-return-path";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  AUTH_COOKIE,
  LEGACY_VENDOR_COOKIE,
  authenticateUser,
  createUserSession,
  markCurrentSessionMfaVerified,
  requireAuth,
  revokeCurrentSession,
  sessionCookieOptions,
} from "@/lib/auth";
import { accountSecurityPath, signedInHomePath } from "@/lib/vendor-roles";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getLoginSourceLimit } from "@/lib/auth-rate-limits";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { isAllowedSmokeTestRecipient } from "@/lib/email";
import { isPasswordResetSmokeEnabled } from "@/lib/password-reset-smoke-policy";
import {
  decryptMfaSecret,
  verifyRecoveryCodeAsync,
  verifyTotpCode,
} from "@/lib/mfa";
import { reencryptLegacyMfaSecret } from "@/lib/mfa-secret-rotation";
import { captureOperationalError } from "@/lib/monitoring";
import { hashPasswordAsync, verifyPasswordAsync } from "@/lib/password";
import { passwordPolicyErrorCode, validateNewPassword } from "@/lib/password-policy";
import { schedulePasswordResetLink, sendPasswordResetLink } from "@/lib/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";
import { accountLockRemainingSeconds, checkAccountRateLimit, consumeAccountRateLimit, lockAccount } from "@/lib/account-rate-limit";
import { hasPendingVendorMemberInvitation } from "@/lib/vendor-member-invitation";
import { completeMfaEnrollment, dismissMfaRecoveryCodes, startMfaEnrollment } from "@/lib/mfa-enrollment";
import { regenerateMfaRecoveryCodes } from "@/lib/mfa-recovery-regeneration";

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_SOURCE_EMAIL_LIMIT = 5;

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function safeInternalPath(value: string, fallback = "/admin/billing/dashboard") {
  return safeInternalPathOr(value, fallback);
}

function forwardedRequestHeaders(headerStore: Awaited<ReturnType<typeof headers>>) {
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  return rateLimitHeaders;
}

export async function loginAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const email = normalizedEmail(text(formData, "email"));
  const password = text(formData, "password");
  const headerStore = await headers();
  const rateLimitRequest = new Request(getCanonicalAppUrl(), {
    headers: forwardedRequestHeaders(headerStore),
  });

  const loginSourceLimit = getLoginSourceLimit(process.env);
  const sourceRateLimited = await checkRateLimit(
    rateLimitRequest,
    "login-source",
    loginSourceLimit,
    LOGIN_RATE_LIMIT_WINDOW_MS,
  );
  if (sourceRateLimited) {
    redirect(`/login?error=${sourceRateLimited.status === 429 ? "rate_limited" : "temporarily_unavailable"}`);
  }

  const sourceEmailRateLimited = await checkRateLimit(
    rateLimitRequest,
    `login-source-email:${email}`,
    LOGIN_SOURCE_EMAIL_LIMIT,
    LOGIN_RATE_LIMIT_WINDOW_MS,
  );
  if (sourceEmailRateLimited) {
    redirect(`/login?error=${sourceEmailRateLimited.status === 429 ? "rate_limited" : "temporarily_unavailable"}`);
  }
  // Account layer (#462 m4): bounds password guessing against one address
  // across any number of source IPs, independent of RATE_LIMIT_PROVIDER. Keyed
  // by the submitted address, so the answer does not reveal whether it exists.
  const accountRateLimited = email ? await checkAccountRateLimit("login_account", email) : null;
  if (accountRateLimited) {
    redirect(`/login?error=${accountRateLimited.status === 429 ? "rate_limited" : "temporarily_unavailable"}`);
  }

  const auth = await authenticateUser(email, password);
  if (!auth) {
    await writeAuditLog({ actorLabel: "anonymous", action: "login_failed", targetType: "Auth", targetId: email, after: { email } });
    redirect("/login?error=1");
  }
  // #462 M1: an account without an active membership (for example a member
  // who was deactivated and invited again) may sign in only to accept a
  // pending invitation addressed to it; everything else still says no_vendor.
  // A partner-only account signs in to the partner portal (see loginFacts).
  const login = loginFacts(auth);
  const invitationLogin = !auth.isPlatformAdmin && !auth.vendor && await hasPendingVendorMemberInvitation(getDb(), auth.user.email);
  if (!auth.isPlatformAdmin && !auth.vendor && !invitationLogin && !login.partnerLogin) {
    await writeAuditLog({
      actorId: auth.user.id,
      actorLabel: "user_without_vendor",
      action: "login_without_active_vendor",
      targetType: "User",
      targetId: auth.user.id,
      after: { email: auth.user.email },
    });
    redirect("/login?error=no_vendor");
  }

  const { token, expiresAt } = await createUserSession({
    userId: auth.user.id,
    vendorId: login.sessionVendorId,
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
  });
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, token, sessionCookieOptions(expiresAt));
  cookieStore.delete(LEGACY_VENDOR_COOKIE);
  await writeAuditLog({
    vendorId: login.sessionVendorId,
    actorId: auth.user.id,
    actorLabel: login.actorLabel,
    action: "login_success",
    targetType: "User",
    targetId: auth.user.id,
    after: { email: auth.user.email, platformRole: auth.user.platformRole, vendorId: auth.vendor?.id ?? null },
  });
  const destination = loginDestination(auth, { invitationLogin, partnerLogin: login.partnerLogin }, formData.get("next"));
  // Vendor roles may enroll voluntarily; the platform finance back office
  // sends a platform admin without a factor to setup. An enabled factor
  // protects every new session before authenticated content is available.
  if (auth.user.mfaFactor) redirect(`/mfa/verify?next=${encodeURIComponent(destination)}`);
  redirect(destination);
}

type AuthenticatedLogin = NonNullable<Awaited<ReturnType<typeof authenticateUser>>>;

/**
 * A partner-only account never gets a merchant back-office vendor context
 * (see chooseVendor); it signs in to the partner portal. Its session records
 * the partner vendor so deactivating that membership revokes the session.
 */
function loginFacts(auth: AuthenticatedLogin) {
  const partnerLogin = !auth.isPlatformAdmin && !auth.vendor && auth.partnerPortalOnly;
  return {
    partnerLogin,
    sessionVendorId: auth.vendor?.id ?? (partnerLogin ? auth.partnerVendorId : null),
    actorLabel: auth.isPlatformAdmin ? "platform_admin" : auth.member?.role ?? (partnerLogin ? "partner" : "user"),
  };
}

/** A pending invitation wins only when asked for, or when the account has no other home. */
function loginDestination(auth: AuthenticatedLogin, kind: { invitationLogin: boolean; partnerLogin: boolean }, next: FormDataEntryValue | null) {
  if (kind.invitationLogin && (!kind.partnerLogin || isInvitationReturnPath(next))) return invitationReturnPath(next);
  return signedInHomePath(auth);
}

function isInvitationReturnPath(value: FormDataEntryValue | null) {
  const next = safeInternalPath(typeof value === "string" ? value : "", "");
  return next === "/invitations/accept" || next.startsWith("/invitations/accept?");
}

/** Only the invitation acceptance page is a valid post-login return target here. */
function invitationReturnPath(value: FormDataEntryValue | null) {
  const next = safeInternalPath(typeof value === "string" ? value : "", "/invitations/accept");
  return next === "/invitations/accept" || next.startsWith("/invitations/accept?") ? next : "/invitations/accept";
}

export async function logoutAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  await revokeCurrentSession();
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
  cookieStore.delete(LEGACY_VENDOR_COOKIE);
  redirect("/login");
}

export async function updatePasswordAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const currentPassword = text(formData, "currentPassword");
  const password = text(formData, "password");
  const confirmPassword = text(formData, "confirmPassword");
  if (!await verifyPasswordAsync(currentPassword, auth.user.passwordHash)) redirect("/settings/security?error=current_password");
  const policy = validateNewPassword(password, { email: auth.user.email, platformRole: auth.user.platformRole });
  if (!policy.ok) redirect(`/settings/security?error=${passwordPolicyErrorCode(policy)}`);
  if (password !== confirmPassword) redirect("/settings/security?error=password_mismatch");
  if (await verifyPasswordAsync(password, auth.user.passwordHash)) redirect("/settings/security?error=password_reuse");

  const db = getDb();
  const revokedAt = new Date();
  const passwordHash = await hashPasswordAsync(password);
  const changed = await db.$transaction(async (tx) => {
    // Compare-and-swap on the hash the current password was checked against:
    // a login email change revert (or another change) that ran meanwhile
    // replaced it, and that write must win.
    const updated = await tx.user.updateMany({ where: { id: auth.user.id, passwordHash: auth.user.passwordHash }, data: { passwordHash } });
    if (updated.count !== 1) return false;
    await tx.userSession.updateMany({ where: { userId: auth.user.id, revokedAt: null }, data: { revokedAt } });
    // A pending login email change ends with the old password.
    await tx.userEmailChangeRequest.updateMany({ where: { userId: auth.user.id, consumedAt: null, revokedAt: null }, data: { revokedAt } });
    return true;
  });
  if (!changed) redirect("/settings/security?error=current_password");
  await writeAuditLog({
    vendorId: auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: "update_password",
    targetType: "User",
    targetId: auth.user.id,
    after: { email: auth.user.email },
  });
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
  cookieStore.delete(LEGACY_VENDOR_COOKIE);
  redirect("/login?password_changed=1");
}

export async function requestPasswordResetAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const rateLimited = await checkRateLimit(
    new Request(appUrl, { headers: forwardedRequestHeaders(headerStore) }),
    "password-reset-request",
    5,
    60_000,
  );
  if (rateLimited) {
    redirect(`/password-reset/request?error=${rateLimited.status === 429 ? "rate_limited" : "temporarily_unavailable"}`);
  }
  const email = normalizedEmail(text(formData, "email"));
  if (!email) redirect("/password-reset/request?error=invalid");
  schedulePasswordResetLink({
    email,
    appUrl,
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
  });
  redirect("/password-reset/request?updated=sent");
}

export async function confirmPasswordResetAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const token = text(formData, "token");
  const password = text(formData, "password");
  const confirmPassword = text(formData, "confirmPassword");
  const { consumePasswordResetToken, findPasswordResetTokenAccount } = await import("@/lib/password-reset");
  // An unusable token yields no account (8-character rule); consumePasswordResetToken still refuses it below.
  const policy = validateNewPassword(password, await findPasswordResetTokenAccount(token) ?? {});
  if (!policy.ok) redirect(`/password-reset/confirm?token=${encodeURIComponent(token)}&error=${passwordPolicyErrorCode(policy)}`);
  if (password !== confirmPassword) redirect(`/password-reset/confirm?token=${encodeURIComponent(token)}&error=mismatch`);

  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) redirect(`/password-reset/confirm?token=${encodeURIComponent(token)}&error=expired`);
  redirect("/login?reset=1");
}

export async function startMfaEnrollmentAction(formData: FormData) {
  const result = await startMfaEnrollment(formData);
  redirect(withMfaReturnPath(`${result.destination}?updated=${result.updated}`, formData.get("next")));
}

export async function confirmMfaEnrollmentAction(formData: FormData) {
  const result = await completeMfaEnrollment(formData);
  redirect(withMfaReturnPath(`${result.destination}?${result.ok ? "updated=mfa_enabled" : `error=${result.error}`}`, formData.get("next")));
}

export async function verifyMfaAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth({ allowUnverifiedMfa: true });
  const next = safeInternalPath(text(formData, "next", "/admin/billing/dashboard"));
  const code = text(formData, "code");
  if (!auth.user.mfaFactor) redirect(withMfaReturnPath("/mfa/setup", next));

  const headerStore = await headers();
  const rateLimited = await checkRateLimit(
    new Request(getCanonicalAppUrl(), { headers: forwardedRequestHeaders(headerStore) }),
    `mfa-verification:${auth.user.id}`,
    5,
    60_000,
  ) ?? await checkAccountRateLimit("mfa_verification", auth.user.id);
  // The first check is the IP layer (skipped under cloudflare_waf); the second
  // caps attempts per account in PostgreSQL regardless of provider (F-028).
  if (rateLimited) redirect(`/mfa/verify?error=${rateLimited.status === 429 ? "rate_limited" : "temporarily_unavailable"}&next=${encodeURIComponent(next)}`);
  const lock = await mfaVerificationLockState(auth.user.id);
  if (lock) redirect(`/mfa/verify?error=${lock}&next=${encodeURIComponent(next)}`);

  const secret = decryptMfaSecret(auth.user.mfaFactor.secretEncrypted);
  const recoveryCodes = await getDb().userRecoveryCode.findMany({ where: { userId: auth.user.id, usedAt: null } });
  const recoveryCodeMatches = await Promise.all(recoveryCodes.map((recoveryCode) => verifyRecoveryCodeAsync(code, recoveryCode.codeHash)));
  const matchedRecoveryCode = recoveryCodes.find((_, index) => recoveryCodeMatches[index]);
  if (!verifyTotpCode(secret, code) && !matchedRecoveryCode) {
    await writeAuditLog({ vendorId: auth.vendor?.id ?? null, actorId: auth.user.id, actorLabel: auth.member?.role ?? auth.user.platformRole, action: "mfa_verify_failed", targetType: "UserMfaFactor", targetId: auth.user.id });
    redirect(`/mfa/verify?error=${await recordMfaVerificationFailure(auth.user.id, auth.vendor?.id ?? null)}&next=${encodeURIComponent(next)}`);
  }
  if (matchedRecoveryCode) {
    const claim = await getDb().userRecoveryCode.updateMany({ where: { id: matchedRecoveryCode.id, userId: auth.user.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claim.count !== 1) {
      await writeAuditLog({ vendorId: auth.vendor?.id ?? null, actorId: auth.user.id, actorLabel: auth.member?.role ?? auth.user.platformRole, action: "mfa_verify_failed", targetType: "UserMfaFactor", targetId: auth.user.id });
      redirect(`/mfa/verify?error=invalid&next=${encodeURIComponent(next)}`);
    }
  } else {
    await getDb().userMfaFactor.update({ where: { userId: auth.user.id }, data: { lastUsedAt: new Date() } });
    // Key rotation (B04-03 tier 4): a secret that just verified but is still
    // in the legacy format is stored again under the current key. A failure
    // never blocks sign-in; scripts/reencrypt-mfa-secrets.ts catches the rest.
    try {
      await reencryptLegacyMfaSecret(getDb(), { userId: auth.user.id, secretEncrypted: auth.user.mfaFactor.secretEncrypted });
    } catch (error) {
      captureOperationalError(error, { source: "mfa", operation: "lazy-reencrypt" });
    }
  }
  await markCurrentSessionMfaVerified();
  await writeAuditLog({
    vendorId: auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: matchedRecoveryCode ? "mfa_verify_recovery_code" : "mfa_verify_totp",
    targetType: "UserMfaFactor",
    targetId: auth.user.id,
  });
  redirect(next);
}

/** "locked" while an MFA lock is active, "temporarily_unavailable" if it cannot be read (fail closed). */
async function mfaVerificationLockState(userId: string) {
  try {
    return (await accountLockRemainingSeconds("mfa_verification_lock", userId)) > 0 ? "locked" : null;
  } catch {
    return "temporarily_unavailable";
  }
}

/**
 * #462 m3: counts failed verifications per account per day. Past the daily
 * limit every further failure locks verification for an hour, so a stolen
 * password plus distributed guessing gets at most ~70 TOTP attempts a day.
 */
async function recordMfaVerificationFailure(userId: string, vendorId: string | null) {
  try {
    const failures = await consumeAccountRateLimit("mfa_verification_failures", userId);
    if (failures.allowed) return "invalid";
    await lockAccount("mfa_verification_lock", userId);
    await writeAuditLog({ vendorId, actorId: userId, actorLabel: "system", action: "mfa_verification_locked", targetType: "UserMfaFactor", targetId: userId, after: auditSnapshot({ failures: failures.count }) });
    return "locked";
  } catch {
    return "temporarily_unavailable";
  }
}

export async function dismissRecoveryCodesAction(formData: FormData) {
  const result = await dismissMfaRecoveryCodes(formData);
  redirect(result.destination);
}

export async function regenerateRecoveryCodesAction(formData: FormData) {
  const result = await regenerateMfaRecoveryCodes(formData);
  redirect(withMfaReturnPath(`${result.destination}?${result.ok ? "updated=recovery_regenerated" : `error=${result.error}`}`, formData.get("next")));
}

export async function sendPasswordResetSmokeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const destination = accountSecurityPath(auth);
  // Gate the action itself before token creation or any mail-provider work.
  if (!isPasswordResetSmokeEnabled()) redirect(`${destination}?error=password_reset_smoke_unavailable`);
  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  if (!isAllowedSmokeTestRecipient(auth.user.email)) redirect(`${destination}?error=password_reset_smoke_recipient`);
  const rateLimited = await checkRateLimit(
    new Request(appUrl, { headers: forwardedRequestHeaders(headerStore) }),
    `password-reset-smoke:${auth.user.id}`,
    3,
    15 * 60 * 1000,
  );
  if (rateLimited) redirect(`${destination}?error=${rateLimited.status === 429 ? "password_reset_smoke_rate_limited" : "password_reset_smoke_unavailable"}`);
  let sent = false;
  try {
    await sendPasswordResetLink({ email: auth.user.email, appUrl, ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: headerStore.get("user-agent") });
    await writeAuditLog({ vendorId: auth.vendor?.id ?? null, actorId: auth.user.id, actorLabel: auth.member?.role ?? auth.user.platformRole, action: "password_reset_smoke_email_sent", targetType: "User", targetId: auth.user.id, after: auditSnapshot({ email: auth.user.email }) });
    sent = true;
  } catch {
    await writeAuditLog({ vendorId: auth.vendor?.id ?? null, actorId: auth.user.id, actorLabel: auth.member?.role ?? auth.user.platformRole, action: "password_reset_smoke_email_failed", targetType: "User", targetId: auth.user.id, after: auditSnapshot({ email: auth.user.email }) });
  }
  redirect(sent ? `${destination}?updated=password_reset_smoke` : `${destination}?error=password_reset_smoke`);
}

export async function revokeOtherSessionsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  await getDb().userSession.updateMany({
    where: { userId: auth.user.id, id: { not: auth.session.id }, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
  await writeAuditLog({ vendorId: auth.vendor?.id ?? null, actorId: auth.user.id, actorLabel: auth.member?.role ?? auth.user.platformRole, action: "revoke_other_sessions", targetType: "User", targetId: auth.user.id });
  revalidatePath("/settings/security");
  redirect("/settings/security?updated=sessions_revoked");
}

export async function revokeAllSessionsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  await getDb().userSession.updateMany({
    where: { userId: auth.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
  await writeAuditLog({ vendorId: auth.vendor?.id ?? null, actorId: auth.user.id, actorLabel: auth.member?.role ?? auth.user.platformRole, action: "revoke_all_sessions", targetType: "User", targetId: auth.user.id });
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
  cookieStore.delete(LEGACY_VENDOR_COOKIE);
  redirect("/login?revoked=1");
}
