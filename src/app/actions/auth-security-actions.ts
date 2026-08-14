"use server";

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
import { getCanonicalAppUrl } from "@/lib/app-url";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { isAllowedSmokeTestRecipient } from "@/lib/email";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodeAsync,
  MFA_RECOVERY_COOKIE,
  MFA_SETUP_COOKIE,
  parsePendingMfaSetup,
  serializePendingMfaSetup,
  serializeRecoveryCodes,
  verifyRecoveryCodeAsync,
  verifyTotpCode,
} from "@/lib/mfa";
import { hashPasswordAsync, verifyPasswordAsync } from "@/lib/password";
import { schedulePasswordResetLink, sendPasswordResetLink } from "@/lib/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_SOURCE_LIMIT = 20;
const LOGIN_SOURCE_EMAIL_LIMIT = 5;

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function safeInternalPath(value: string, fallback = "/admin/billing/dashboard") {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}

function forwardedRequestHeaders(headerStore: Awaited<ReturnType<typeof headers>>) {
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  return rateLimitHeaders;
}

function longLivedCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 15,
  };
}

function recoveryCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  };
}

export async function loginAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const email = normalizedEmail(text(formData, "email"));
  const password = text(formData, "password");
  const headerStore = await headers();
  const rateLimitRequest = new Request(getCanonicalAppUrl(), {
    headers: forwardedRequestHeaders(headerStore),
  });

  const sourceRateLimited = await checkRateLimit(
    rateLimitRequest,
    "login-source",
    LOGIN_SOURCE_LIMIT,
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

  const auth = await authenticateUser(email, password);
  if (!auth) {
    await writeAuditLog({ actorLabel: "anonymous", action: "login_failed", targetType: "Auth", targetId: email, after: { email } });
    redirect("/login?error=1");
  }
  if (!auth.isPlatformAdmin && !auth.vendor) {
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
    vendorId: auth.vendor?.id ?? null,
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
  });
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, token, sessionCookieOptions(expiresAt));
  cookieStore.delete(LEGACY_VENDOR_COOKIE);
  await writeAuditLog({
    vendorId: auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.isPlatformAdmin ? "platform_admin" : auth.member?.role ?? "user",
    action: "login_success",
    targetType: "User",
    targetId: auth.user.id,
    after: { email: auth.user.email, platformRole: auth.user.platformRole, vendorId: auth.vendor?.id ?? null },
  });
  if (auth.isPlatformAdmin) {
    if (!auth.user.mfaFactor) redirect("/mfa/setup");
    redirect("/mfa/verify?next=%2Fadmin%2Fbilling%2Fdashboard");
  }
  redirect("/dashboard");
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
  if (password.length < 12) redirect("/settings/security?error=short");
  if (password !== confirmPassword) redirect("/settings/security?error=password_mismatch");
  if (await verifyPasswordAsync(password, auth.user.passwordHash)) redirect("/settings/security?error=password_reuse");

  const db = getDb();
  const revokedAt = new Date();
  await db.$transaction([
    db.user.update({ where: { id: auth.user.id }, data: { passwordHash: await hashPasswordAsync(password) } }),
    db.userSession.updateMany({ where: { userId: auth.user.id, revokedAt: null }, data: { revokedAt } }),
  ]);
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
  if (password.length < 12) redirect(`/password-reset/confirm?token=${encodeURIComponent(token)}&error=short`);
  if (password !== confirmPassword) redirect(`/password-reset/confirm?token=${encodeURIComponent(token)}&error=mismatch`);

  const { consumePasswordResetToken } = await import("@/lib/password-reset");
  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) redirect(`/password-reset/confirm?token=${encodeURIComponent(token)}&error=expired`);
  redirect("/login?reset=1");
}

export async function startMfaEnrollmentAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const destination = auth.isPlatformAdmin ? "/mfa/setup" : "/settings/security";
  if (auth.user.mfaFactor) redirect(`${destination}?updated=mfa_exists`);
  const cookieStore = await cookies();
  const secret = generateTotpSecret();
  cookieStore.set(MFA_SETUP_COOKIE, serializePendingMfaSetup(secret, auth.user.id), longLivedCookieOptions());
  cookieStore.delete(MFA_RECOVERY_COOKIE);
  redirect(`${destination}?updated=mfa_started`);
}

export async function confirmMfaEnrollmentAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const destination = auth.isPlatformAdmin ? "/mfa/setup" : "/settings/security";
  const code = text(formData, "code");
  const cookieStore = await cookies();
  const pending = parsePendingMfaSetup(cookieStore.get(MFA_SETUP_COOKIE)?.value);
  if (!pending || pending.userId !== auth.user.id || !verifyTotpCode(pending.secret, code)) redirect(`${destination}?error=mfa_code`);

  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = await Promise.all(recoveryCodes.map(hashRecoveryCodeAsync));
  const secretEncrypted = encryptMfaSecret(pending.secret);
  await getDb().$transaction([
    getDb().userMfaFactor.upsert({
      where: { userId: auth.user.id },
      create: { userId: auth.user.id, factorType: "totp", label: "CelebrateDeal Authenticator", secretEncrypted },
      update: { factorType: "totp", label: "CelebrateDeal Authenticator", secretEncrypted, enabledAt: new Date(), lastUsedAt: new Date() },
    }),
    getDb().userRecoveryCode.deleteMany({ where: { userId: auth.user.id } }),
    getDb().userRecoveryCode.createMany({ data: recoveryCodes.map((codeValue, index) => ({ userId: auth.user.id, codeHash: recoveryCodeHashes[index]! })) }),
  ]);
  await markCurrentSessionMfaVerified();
  cookieStore.delete(MFA_SETUP_COOKIE);
  cookieStore.set(MFA_RECOVERY_COOKIE, serializeRecoveryCodes(recoveryCodes), recoveryCookieOptions());
  await writeAuditLog({
    vendorId: auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: "mfa_enabled",
    targetType: "UserMfaFactor",
    targetId: auth.user.id,
    after: auditSnapshot({ factorType: "totp" }),
  });
  redirect(`${destination}?updated=mfa_enabled`);
}

export async function verifyMfaAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const next = safeInternalPath(text(formData, "next", "/admin/billing/dashboard"));
  const code = text(formData, "code");
  if (!auth.user.mfaFactor) redirect("/mfa/setup");

  const headerStore = await headers();
  const rateLimited = await checkRateLimit(
    new Request(getCanonicalAppUrl(), { headers: forwardedRequestHeaders(headerStore) }),
    `mfa-verification:${auth.user.id}`,
    5,
    60_000,
  );
  if (rateLimited) redirect(`/mfa/verify?error=${rateLimited.status === 429 ? "rate_limited" : "temporarily_unavailable"}&next=${encodeURIComponent(next)}`);

  const secret = decryptMfaSecret(auth.user.mfaFactor.secretEncrypted);
  const recoveryCodes = await getDb().userRecoveryCode.findMany({ where: { userId: auth.user.id, usedAt: null } });
  const recoveryCodeMatches = await Promise.all(recoveryCodes.map((recoveryCode) => verifyRecoveryCodeAsync(code, recoveryCode.codeHash)));
  const matchedRecoveryCode = recoveryCodes.find((_, index) => recoveryCodeMatches[index]);
  if (!verifyTotpCode(secret, code) && !matchedRecoveryCode) {
    await writeAuditLog({ vendorId: auth.vendor?.id ?? null, actorId: auth.user.id, actorLabel: auth.member?.role ?? auth.user.platformRole, action: "mfa_verify_failed", targetType: "UserMfaFactor", targetId: auth.user.id });
    redirect(`/mfa/verify?error=invalid&next=${encodeURIComponent(next)}`);
  }
  if (matchedRecoveryCode) {
    const claim = await getDb().userRecoveryCode.updateMany({ where: { id: matchedRecoveryCode.id, userId: auth.user.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claim.count !== 1) {
      await writeAuditLog({ vendorId: auth.vendor?.id ?? null, actorId: auth.user.id, actorLabel: auth.member?.role ?? auth.user.platformRole, action: "mfa_verify_failed", targetType: "UserMfaFactor", targetId: auth.user.id });
      redirect(`/mfa/verify?error=invalid&next=${encodeURIComponent(next)}`);
    }
  } else {
    await getDb().userMfaFactor.update({ where: { userId: auth.user.id }, data: { lastUsedAt: new Date() } });
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

export async function dismissRecoveryCodesAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const cookieStore = await cookies();
  cookieStore.delete(MFA_RECOVERY_COOKIE);
  redirect(auth.isPlatformAdmin ? "/mfa/verify" : "/settings/security");
}

export async function regenerateRecoveryCodesAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const destination = auth.isPlatformAdmin ? "/mfa/setup" : "/settings/security";
  if (!auth.user.mfaFactor) redirect(`${destination}?error=mfa_required`);
  const headerStore = await headers();
  const rateLimited = await checkRateLimit(
    new Request(getCanonicalAppUrl(), { headers: forwardedRequestHeaders(headerStore) }),
    `mfa-recovery-regeneration:${auth.user.id}`,
    3,
    15 * 60 * 1000,
  );
  if (rateLimited) redirect(`${destination}?error=${rateLimited.status === 429 ? "recovery_rate_limited" : "recovery_unavailable"}`);
  const code = text(formData, "code");
  const secret = decryptMfaSecret(auth.user.mfaFactor.secretEncrypted);
  if (!verifyTotpCode(secret, code)) {
    await writeAuditLog({ vendorId: auth.vendor?.id ?? null, actorId: auth.user.id, actorLabel: auth.member?.role ?? auth.user.platformRole, action: "mfa_recovery_codes_regeneration_failed", targetType: "UserRecoveryCode", targetId: auth.user.id });
    redirect(`${destination}?error=mfa_code`);
  }
  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = await Promise.all(recoveryCodes.map(hashRecoveryCodeAsync));
  await getDb().$transaction([
    getDb().userRecoveryCode.deleteMany({ where: { userId: auth.user.id } }),
    getDb().userRecoveryCode.createMany({ data: recoveryCodes.map((codeValue, index) => ({ userId: auth.user.id, codeHash: recoveryCodeHashes[index]! })) }),
    getDb().userMfaFactor.update({ where: { userId: auth.user.id }, data: { lastUsedAt: new Date() } }),
  ]);
  const cookieStore = await cookies();
  cookieStore.set(MFA_RECOVERY_COOKIE, serializeRecoveryCodes(recoveryCodes), recoveryCookieOptions());
  await writeAuditLog({
    vendorId: auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: "mfa_recovery_codes_regenerated",
    targetType: "UserRecoveryCode",
    targetId: auth.user.id,
    after: auditSnapshot({ codeCount: recoveryCodes.length }),
  });
  redirect(`${destination}?updated=recovery_regenerated`);
}

export async function sendPasswordResetSmokeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const destination = auth.isPlatformAdmin ? "/mfa/setup" : "/settings/security";
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
