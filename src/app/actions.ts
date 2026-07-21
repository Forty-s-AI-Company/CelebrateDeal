"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import {
  AUTH_COOKIE,
  LEGACY_VENDOR_COOKIE,
  authenticateUser,
  createUserSession,
  markCurrentSessionMfaVerified,
  requireAuth,
  requireFinanceAdmin,
  requireVendorManager,
  requireVendorOwner,
  revokeCurrentSession,
  sessionCookieOptions,
} from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { calculateSettlement, invoiceNumber, payoutBatchNumber } from "@/lib/billing";
import { assertServerActionSecurity } from "@/lib/csrf";
import { retryWebhookEvent } from "@/lib/webhook-retry";
import { getDb } from "@/lib/db";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  MFA_RECOVERY_COOKIE,
  MFA_SETUP_COOKIE,
  parsePendingMfaSetup,
  serializePendingMfaSetup,
  serializeRecoveryCodes,
  verifyRecoveryCode,
  verifyTotpCode,
} from "@/lib/mfa";
import { hashPassword, verifyPassword } from "@/lib/password";
import { sendPasswordResetLink } from "@/lib/password-reset";
import { isAllowedSmokeTestRecipient } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { toSlug } from "@/lib/format";
import { INTERACTION_TIME_FORMAT_ERROR, parseInteractionTriggerSeconds } from "@/lib/interaction-timeline";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";
import { BlacklistIdentifierType, normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function safeExternalUrl(value: string | null, label: string) {
  if (!value) return null;

  const safeUrl = parseSafeExternalHttpUrl(value);
  if (!safeUrl) throw new Error(`${label}必須是有效的 HTTP 或 HTTPS 完整網址。`);
  return safeUrl;
}

function optionalExternalUrl(formData: FormData, key: string, label: string) {
  return safeExternalUrl(optionalText(formData, key), label);
}

function requiredExternalUrl(formData: FormData, key: string, label: string) {
  const safeUrl = parseSafeExternalHttpUrl(text(formData, key));
  if (!safeUrl) throw new Error(`${label}必須是有效的 HTTP 或 HTTPS 完整網址。`);
  return safeUrl;
}

function intValue(formData: FormData, key: string, fallback = 0) {
  const parsed = Number.parseInt(text(formData, key, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moneyToCents(formData: FormData, key: string, fallback = 0) {
  const value = text(formData, key);
  if (!value) return fallback;
  const parsed = Number.parseFloat(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : fallback;
}

class RefundValidationError extends Error {}

function isRefundTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "P2025" || error.code === "P2034");
}

function isRefundSerializationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_SOURCE_LIMIT = 20;
const LOGIN_SOURCE_EMAIL_LIMIT = 5;
const REFUND_TRANSACTION_MAX_ATTEMPTS = 3;
const MEMBER_ROLES = new Set(["owner", "admin", "accountant"]);

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function safeInternalPath(value: string, fallback = "/admin/billing/dashboard") {
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export async function loginAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const email = normalizedEmail(text(formData, "email"));
  const password = text(formData, "password");
  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  const rateLimitRequest = new Request(appUrl, { headers: rateLimitHeaders });

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
    await writeAuditLog({
      actorLabel: "anonymous",
      action: "login_failed",
      targetType: "Auth",
      targetId: email,
      after: { email },
    });
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
    if (!auth.user.mfaFactor) {
      redirect("/mfa/setup");
    }
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

export async function saveBrandSettingsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  await getDb().vendor.update({
    where: { id: vendor.id },
    data: {
      name: text(formData, "name"),
      slug: toSlug(text(formData, "slug")),
      logoUrl: optionalExternalUrl(formData, "logoUrl", "品牌 Logo 網址"),
      primaryColor: text(formData, "primaryColor", "#2563eb"),
      ctaColor: text(formData, "ctaColor", "#f97316"),
      timezone: text(formData, "timezone", "Asia/Taipei"),
      supportEmail: optionalText(formData, "supportEmail"),
    },
  });
  revalidatePath("/settings/brand");
}

export async function saveTrackingSettingsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  await getDb().trackingSetting.upsert({
    where: { vendorId: vendor.id },
    create: {
      vendorId: vendor.id,
      facebookPixelId: optionalText(formData, "facebookPixelId"),
      tiktokPixelId: optionalText(formData, "tiktokPixelId"),
      googleTagManagerId: optionalText(formData, "googleTagManagerId"),
      enablePageView: formData.get("enablePageView") === "on",
      enableLeadEvent: formData.get("enableLeadEvent") === "on",
      enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
    },
    update: {
      facebookPixelId: optionalText(formData, "facebookPixelId"),
      tiktokPixelId: optionalText(formData, "tiktokPixelId"),
      googleTagManagerId: optionalText(formData, "googleTagManagerId"),
      enablePageView: formData.get("enablePageView") === "on",
      enableLeadEvent: formData.get("enableLeadEvent") === "on",
      enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
    },
  });
  revalidatePath("/settings/tracking");
}

export async function updatePasswordAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const currentPassword = text(formData, "currentPassword");
  const password = text(formData, "password");
  const confirmPassword = text(formData, "confirmPassword");

  if (!verifyPassword(currentPassword, auth.user.passwordHash)) {
    redirect("/settings/security?error=current_password");
  }
  if (password.length < 12) {
    redirect("/settings/security?error=short");
  }
  if (password !== confirmPassword) {
    redirect("/settings/security?error=password_mismatch");
  }
  if (verifyPassword(password, auth.user.passwordHash)) {
    redirect("/settings/security?error=password_reuse");
  }

  const db = getDb();
  const revokedAt = new Date();
  await db.$transaction([
    db.user.update({
      where: { id: auth.user.id },
      data: { passwordHash: hashPassword(password) },
    }),
    db.userSession.updateMany({
      where: { userId: auth.user.id, revokedAt: null },
      data: { revokedAt },
    }),
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
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  const rateLimited = await checkRateLimit(
    new Request(appUrl, { headers: rateLimitHeaders }),
    "password-reset-request",
    5,
    60_000,
  );
  if (rateLimited) {
    redirect(`/password-reset/request?error=${rateLimited.status === 429 ? "rate_limited" : "temporarily_unavailable"}`);
  }

  const email = normalizedEmail(text(formData, "email"));
  if (!email) {
    redirect("/password-reset/request?error=invalid");
  }

  let previewUrl: string | null = null;
  try {
    const result = await sendPasswordResetLink({
      email,
      appUrl,
      ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerStore.get("user-agent"),
    });

    if (process.env.NODE_ENV !== "production" && result?.resetUrl) {
      previewUrl = result.resetUrl;
    }
  } catch {
    await writeAuditLog({
      actorLabel: "password_reset_request_failed",
      action: "password_reset_email_failed",
      targetType: "PasswordResetToken",
      after: auditSnapshot({ email }),
    });
  }

  if (previewUrl) {
    redirect(`/password-reset/request?updated=sent&preview=${encodeURIComponent(previewUrl)}`);
  }
  redirect("/password-reset/request?updated=sent");
}

export async function confirmPasswordResetAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const token = text(formData, "token");
  const password = text(formData, "password");
  const confirmPassword = text(formData, "confirmPassword");

  if (password.length < 12) {
    redirect(`/password-reset/confirm?token=${encodeURIComponent(token)}&error=short`);
  }

  if (password !== confirmPassword) {
    redirect(`/password-reset/confirm?token=${encodeURIComponent(token)}&error=mismatch`);
  }

  const { consumePasswordResetToken } = await import("@/lib/password-reset");
  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) {
    redirect(`/password-reset/confirm?token=${encodeURIComponent(token)}&error=expired`);
  }

  redirect("/login?reset=1");
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

export async function startMfaEnrollmentAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const destination = auth.isPlatformAdmin ? "/mfa/setup" : "/settings/security";
  if (auth.user.mfaFactor) {
    redirect(`${destination}?updated=mfa_exists`);
  }

  const cookieStore = await cookies();
  const secret = generateTotpSecret();
  cookieStore.set(MFA_SETUP_COOKIE, serializePendingMfaSetup(secret), longLivedCookieOptions());
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

  if (!pending || !verifyTotpCode(pending.secret, code)) {
    redirect(`${destination}?error=mfa_code`);
  }

  const recoveryCodes = generateRecoveryCodes();
  const secretEncrypted = encryptMfaSecret(pending.secret);

  await getDb().$transaction([
    getDb().userMfaFactor.upsert({
      where: { userId: auth.user.id },
      create: {
        userId: auth.user.id,
        factorType: "totp",
        label: "CelebrateDeal Authenticator",
        secretEncrypted,
      },
      update: {
        factorType: "totp",
        label: "CelebrateDeal Authenticator",
        secretEncrypted,
        enabledAt: new Date(),
        lastUsedAt: new Date(),
      },
    }),
    getDb().userRecoveryCode.deleteMany({ where: { userId: auth.user.id } }),
    getDb().userRecoveryCode.createMany({
      data: recoveryCodes.map((codeValue) => ({
        userId: auth.user.id,
        codeHash: hashRecoveryCode(codeValue),
      })),
    }),
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

  if (!auth.user.mfaFactor) {
    redirect("/mfa/setup");
  }

  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  const rateLimited = await checkRateLimit(
    new Request(appUrl, { headers: rateLimitHeaders }),
    `mfa-verification:${auth.user.id}`,
    5,
    60_000,
  );
  if (rateLimited) {
    redirect(`/mfa/verify?error=${rateLimited.status === 429 ? "rate_limited" : "temporarily_unavailable"}&next=${encodeURIComponent(next)}`);
  }

  const secret = decryptMfaSecret(auth.user.mfaFactor.secretEncrypted);
  const recoveryCodes = await getDb().userRecoveryCode.findMany({
    where: {
      userId: auth.user.id,
      usedAt: null,
    },
  });

  const matchedRecoveryCode = recoveryCodes.find((recoveryCode) => verifyRecoveryCode(code, recoveryCode.codeHash));
  if (!verifyTotpCode(secret, code) && !matchedRecoveryCode) {
    await writeAuditLog({
      vendorId: auth.vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "mfa_verify_failed",
      targetType: "UserMfaFactor",
      targetId: auth.user.id,
    });
    redirect(`/mfa/verify?error=invalid&next=${encodeURIComponent(next)}`);
  }

  if (matchedRecoveryCode) {
    await getDb().userRecoveryCode.update({
      where: { id: matchedRecoveryCode.id },
      data: { usedAt: new Date() },
    });
  } else {
    await getDb().userMfaFactor.update({
      where: { userId: auth.user.id },
      data: { lastUsedAt: new Date() },
    });
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

  if (!auth.user.mfaFactor) {
    redirect(`${destination}?error=mfa_required`);
  }

  const headerStore = await headers();
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  const rateLimited = await checkRateLimit(
    new Request(getCanonicalAppUrl(), { headers: rateLimitHeaders }),
    `mfa-recovery-regeneration:${auth.user.id}`,
    3,
    15 * 60 * 1000,
  );
  if (rateLimited) {
    redirect(`${destination}?error=${rateLimited.status === 429 ? "recovery_rate_limited" : "recovery_unavailable"}`);
  }

  const code = text(formData, "code");
  const secret = decryptMfaSecret(auth.user.mfaFactor.secretEncrypted);
  if (!verifyTotpCode(secret, code)) {
    await writeAuditLog({
      vendorId: auth.vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "mfa_recovery_codes_regeneration_failed",
      targetType: "UserRecoveryCode",
      targetId: auth.user.id,
    });
    redirect(`${destination}?error=mfa_code`);
  }

  const recoveryCodes = generateRecoveryCodes();
  await getDb().$transaction([
    getDb().userRecoveryCode.deleteMany({ where: { userId: auth.user.id } }),
    getDb().userRecoveryCode.createMany({
      data: recoveryCodes.map((codeValue) => ({
        userId: auth.user.id,
        codeHash: hashRecoveryCode(codeValue),
      })),
    }),
    getDb().userMfaFactor.update({
      where: { userId: auth.user.id },
      data: { lastUsedAt: new Date() },
    }),
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
  let sent = false;

  if (!isAllowedSmokeTestRecipient(auth.user.email)) {
    redirect(`${destination}?error=password_reset_smoke_recipient`);
  }

  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  const rateLimited = await checkRateLimit(
    new Request(appUrl, { headers: rateLimitHeaders }),
    `password-reset-smoke:${auth.user.id}`,
    3,
    15 * 60 * 1000,
  );
  if (rateLimited) {
    redirect(`${destination}?error=${rateLimited.status === 429 ? "password_reset_smoke_rate_limited" : "password_reset_smoke_unavailable"}`);
  }

  try {
    await sendPasswordResetLink({
      email: auth.user.email,
      appUrl,
      ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerStore.get("user-agent"),
    });
    await writeAuditLog({
      vendorId: auth.vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "password_reset_smoke_email_sent",
      targetType: "User",
      targetId: auth.user.id,
      after: auditSnapshot({ email: auth.user.email }),
    });
    sent = true;
  } catch {
    await writeAuditLog({
      vendorId: auth.vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "password_reset_smoke_email_failed",
      targetType: "User",
      targetId: auth.user.id,
      after: auditSnapshot({ email: auth.user.email }),
    });
  }

  redirect(sent ? `${destination}?updated=password_reset_smoke` : `${destination}?error=password_reset_smoke`);
}

export async function createVendorMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const email = normalizedEmail(text(formData, "email"));
  const name = text(formData, "name");
  const role = text(formData, "role", "accountant");

  if (!email || !name || !MEMBER_ROLES.has(role)) {
    redirect("/settings/security?error=member_invalid");
  }

  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  const rateLimited = await checkRateLimit(
    new Request(appUrl, { headers: rateLimitHeaders }),
    "vendor-member-invitation",
    5,
    60_000,
  );
  if (rateLimited) {
    redirect(`/settings/security?error=${rateLimited.status === 429 ? "member_invitation_rate_limited" : "member_invitation_unavailable"}`);
  }

  const db = getDb();
  const existingUser = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      platformRole: true,
      status: true,
    },
  });
  if (existingUser?.platformRole && existingUser.platformRole !== "none") {
    redirect("/settings/security?error=platform_user");
  }

  const existingMember = existingUser
    ? await db.vendorMember.findUnique({
        where: { vendorId_userId: { vendorId: auth.vendor.id, userId: existingUser.id } },
        include: {
          user: {
            select: {
              email: true,
            },
          },
        },
      })
    : null;

  if (existingMember?.userId === auth.user.id && role !== "owner") {
    redirect("/settings/security?error=self_role");
  }

  const savedMember = await db.$transaction(async (tx) => {
    const user = existingUser ?? await tx.user.create({
      data: {
        email,
        name,
        // New members set their real password through the one-time reset link below.
        passwordHash: hashPassword(randomBytes(32).toString("base64url")),
        status: "active",
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        name: user.name || name,
        status: "active",
      },
    });

    return tx.vendorMember.upsert({
      where: { vendorId_userId: { vendorId: auth.vendor.id, userId: user.id } },
      create: {
        vendorId: auth.vendor.id,
        userId: user.id,
        role,
        status: "active",
      },
      update: {
        role,
        status: "active",
        deactivatedAt: null,
      },
      include: {
        user: {
          select: {
            email: true,
          },
        },
      },
    });
  });

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: existingMember?.status === "inactive"
      ? "reactivate_vendor_member"
      : existingMember
        ? "invite_vendor_member"
        : "create_vendor_member",
    targetType: "VendorMember",
    targetId: savedMember.id,
    before: auditSnapshot(existingMember ? {
      id: existingMember.id,
      email: existingMember.user.email,
      role: existingMember.role,
      status: existingMember.status,
    } : null),
    after: auditSnapshot({
      id: savedMember.id,
      email: savedMember.user.email,
      role: savedMember.role,
      status: savedMember.status,
    }),
  });

  let invitationSent = false;
  try {
    invitationSent = Boolean(await sendPasswordResetLink({
      email: savedMember.user.email,
      appUrl,
      ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerStore.get("user-agent"),
    }));
  } catch {}

  if (!invitationSent) {
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "vendor_member_invitation_email_failed",
      targetType: "VendorMember",
      targetId: savedMember.id,
      after: auditSnapshot({
        email: savedMember.user.email,
        role: savedMember.role,
        status: savedMember.status,
      }),
    });
    // The membership transaction has already committed, so refresh the list even
    // when the invitation provider is unavailable.
    revalidatePath("/settings/security");
    redirect("/settings/security?error=member_invitation");
  }

  revalidatePath("/settings/security");
  redirect("/settings/security?updated=member");
}

export async function resendVendorMemberInvitationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const id = text(formData, "id");
  const db = getDb();
  const member = await db.vendorMember.findFirst({
    where: {
      id,
      vendorId: auth.vendor.id,
      status: "active",
    },
    include: { user: true },
  });

  if (member?.status !== "active" || member.userId === auth.user.id || member.user.platformRole !== "none") {
    redirect("/settings/security?error=member_invitation_resend_invalid");
  }

  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  const rateLimited = await checkRateLimit(
    new Request(appUrl, { headers: rateLimitHeaders }),
    "vendor-member-invitation",
    5,
    60_000,
  );
  if (rateLimited) {
    redirect(`/settings/security?error=${rateLimited.status === 429 ? "member_invitation_rate_limited" : "member_invitation_unavailable"}`);
  }

  let invitationSent = false;
  try {
    invitationSent = Boolean(await sendPasswordResetLink({
      email: member.user.email,
      appUrl,
      ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerStore.get("user-agent"),
    }));
  } catch {}

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: invitationSent ? "vendor_member_invitation_resent" : "vendor_member_invitation_resend_email_failed",
    targetType: "VendorMember",
    targetId: member.id,
    after: auditSnapshot({
      email: member.user.email,
      role: member.role,
      status: member.status,
    }),
  });

  if (invitationSent) {
    revalidatePath("/settings/security");
    redirect("/settings/security?updated=member_invitation_resent");
  }

  redirect("/settings/security?error=member_invitation_resend_failed");
}

export async function deactivateVendorMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const id = text(formData, "id");
  const confirmation = normalizedEmail(text(formData, "confirmation"));
  const db = getDb();
  const member = await db.vendorMember.findFirst({
    where: { id, vendorId: auth.vendor.id },
    include: { user: true },
  });

  if (!member || member.status !== "active" || member.user.platformRole !== "none") {
    redirect("/settings/security?error=member_not_found");
  }

  if (member.userId === auth.user.id) {
    redirect("/settings/security?error=self_deactivate");
  }

  if (member.role === "owner") {
    const activeOwnerCount = await db.vendorMember.count({
      where: {
        vendorId: auth.vendor.id,
        role: "owner",
        status: "active",
        id: { not: member.id },
      },
    });
    if (activeOwnerCount === 0) {
      redirect("/settings/security?error=last_owner");
    }
  }

  if (confirmation !== normalizedEmail(member.user.email)) {
    redirect("/settings/security?error=member_confirmation");
  }

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.vendorMember.update({
      where: { id: member.id },
      data: {
        status: "inactive",
        deactivatedAt: new Date(),
      },
    });
    await tx.userSession.updateMany({
      where: {
        userId: member.userId,
        vendorId: auth.vendor.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return saved;
  });

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "deactivate_vendor_member",
    targetType: "VendorMember",
    targetId: member.id,
    before: auditSnapshot(member),
    after: auditSnapshot(updated),
  });

  revalidatePath("/settings/security");
  redirect("/settings/security?updated=member_deactivated");
}

export async function revokeOtherSessionsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  await getDb().userSession.updateMany({
    where: {
      userId: auth.user.id,
      id: { not: auth.session.id },
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { revokedAt: new Date() },
  });
  await writeAuditLog({
    vendorId: auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: "revoke_other_sessions",
    targetType: "User",
    targetId: auth.user.id,
  });
  revalidatePath("/settings/security");
  redirect("/settings/security?updated=sessions_revoked");
}

export async function revokeAllSessionsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  await getDb().userSession.updateMany({
    where: {
      userId: auth.user.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { revokedAt: new Date() },
  });
  await writeAuditLog({
    vendorId: auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: "revoke_all_sessions",
    targetType: "User",
    targetId: auth.user.id,
  });
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
  cookieStore.delete(LEGACY_VENDOR_COOKIE);
  redirect("/login?revoked=1");
}

export async function upsertVideoAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const data = {
    title: text(formData, "title"),
    description: optionalText(formData, "description"),
    sourceType: text(formData, "sourceType", "url"),
    videoUrl: requiredExternalUrl(formData, "videoUrl", "影片網址"),
    thumbnailUrl: optionalExternalUrl(formData, "thumbnailUrl", "影片縮圖網址"),
    durationSec: intValue(formData, "durationSec"),
    status: text(formData, "status", "ready"),
    cloudflareStreamUid: optionalText(formData, "cloudflareStreamUid"),
    cloudflareLiveInputUid: optionalText(formData, "cloudflareLiveInputUid"),
    cloudflarePlaybackId: optionalText(formData, "cloudflarePlaybackId"),
    cloudflareReadyToStream: formData.get("cloudflareReadyToStream") === "on",
    liveInputStatus: optionalText(formData, "liveInputStatus"),
    estimatedMinutes: intValue(formData, "estimatedMinutes"),
  };

  if (id) {
    await getDb().video.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().video.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/videos");
}

export async function upsertProductAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const data = {
    name: text(formData, "name"),
    slug: toSlug(text(formData, "slug")),
    description: optionalText(formData, "description"),
    priceCents: intValue(formData, "priceCents"),
    compareAtCents: optionalText(formData, "compareAtCents") ? intValue(formData, "compareAtCents") : null,
    currency: text(formData, "currency", "TWD"),
    imageUrl: optionalExternalUrl(formData, "imageUrl", "商品圖片網址"),
    checkoutUrl: optionalExternalUrl(formData, "checkoutUrl", "商品結帳網址"),
    inventory: intValue(formData, "inventory"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().product.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().product.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/products");
}

export async function upsertFormAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  let rawFields: unknown;
  try {
    rawFields = JSON.parse(text(formData, "fields", "[]"));
  } catch {
    redirect(id ? `/forms/${encodeURIComponent(id)}/edit?error=invalid_fields` : "/forms/new?error=invalid_fields");
  }
  const fields = parseRegistrationFormFields(rawFields);
  if (!fields.success) {
    redirect(id ? `/forms/${encodeURIComponent(id)}/edit?error=invalid_fields` : "/forms/new?error=invalid_fields");
  }

  const data = {
    name: text(formData, "name"),
    slug: toSlug(text(formData, "slug")),
    headline: text(formData, "headline"),
    description: optionalText(formData, "description"),
    submitLabel: text(formData, "submitLabel", "送出報名"),
    fields: fields.data as Prisma.InputJsonValue,
    successMessage: text(formData, "successMessage", "已收到你的資料，開播前會再提醒你。"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().registrationForm.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().registrationForm.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/forms");
}

export async function upsertTemplateAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const data = {
    name: text(formData, "name"),
    channel: text(formData, "channel", "email"),
    trigger: text(formData, "trigger", "registration_confirmed"),
    subject: optionalText(formData, "subject"),
    body: text(formData, "body"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().messageTemplate.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().messageTemplate.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/messages/templates");
}

export async function upsertLiveAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const rawProductIds = formData.getAll("productIds").filter((value): value is string => typeof value === "string");
  const productIds = [...new Set(rawProductIds.map((productId) => productId.trim()).filter(Boolean))];
  const videoId = optionalText(formData, "videoId");
  const formId = optionalText(formData, "formId");
  const messageTemplateId = optionalText(formData, "messageTemplateId");
  const interactionScriptId = optionalText(formData, "interactionScriptId");
  const invalidReferencePath = id
    ? `/lives/${encodeURIComponent(id)}/edit?error=invalid_reference`
    : "/lives/new?error=invalid_reference";
  const referenceIds = [id, videoId, formId, messageTemplateId, interactionScriptId, ...productIds].filter(
    (value): value is string => value !== null,
  );
  if (productIds.length > 100 || rawProductIds.length !== productIds.length || referenceIds.some((value) => value.length > 128)) {
    redirect(invalidReferencePath);
  }
  const scheduledAtValue = text(formData, "scheduledAt");
  const db = getDb();
  const [products, video, registrationForm, messageTemplate, interactionScript] = await Promise.all([
    productIds.length > 0
      ? db.product.findMany({ where: { vendorId: vendor.id, id: { in: productIds } }, select: { id: true } })
      : Promise.resolve([]),
    videoId ? db.video.findFirst({ where: { id: videoId, vendorId: vendor.id }, select: { id: true } }) : Promise.resolve(null),
    formId ? db.registrationForm.findFirst({ where: { id: formId, vendorId: vendor.id }, select: { id: true } }) : Promise.resolve(null),
    messageTemplateId ? db.messageTemplate.findFirst({ where: { id: messageTemplateId, vendorId: vendor.id }, select: { id: true } }) : Promise.resolve(null),
    interactionScriptId ? db.interactionScript.findFirst({ where: { id: interactionScriptId, vendorId: vendor.id }, select: { id: true } }) : Promise.resolve(null),
  ]);
  const hasInvalidReference = products.length !== productIds.length
    || (videoId !== null && !video)
    || (formId !== null && !registrationForm)
    || (messageTemplateId !== null && !messageTemplate)
    || (interactionScriptId !== null && !interactionScript);
  if (hasInvalidReference) {
    redirect(invalidReferencePath);
  }
  const data = {
    title: text(formData, "title"),
    slug: toSlug(text(formData, "slug")),
    description: optionalText(formData, "description"),
    scheduledAt: scheduledAtValue ? new Date(scheduledAtValue) : new Date(),
    status: text(formData, "status", "scheduled"),
    videoId,
    formId,
    messageTemplateId,
    interactionScriptId,
    heroImageUrl: optionalExternalUrl(formData, "heroImageUrl", "直播主視覺網址"),
    accentCopy: optionalText(formData, "accentCopy"),
    replayEnabled: formData.get("replayEnabled") !== "off",
    streamMode: text(formData, "streamMode", "vod"),
    cloudflareLiveInputUid: optionalText(formData, "cloudflareLiveInputUid"),
    quotaPolicy: {
      maxConcurrentViewers: intValue(formData, "maxConcurrentViewers", 500),
      stopWhenCreditsBelow: intValue(formData, "stopWhenCreditsBelow", 300),
    } as Prisma.InputJsonValue,
  };

  if (id) {
    await db.$transaction([
      db.live.update({ where: { id, vendorId: vendor.id }, data }),
      db.liveProduct.deleteMany({ where: { liveId: id } }),
      ...productIds.map((productId, index) =>
        db.liveProduct.create({
          data: { liveId: id, productId, sortOrder: index + 1, isPinned: index === 0 },
        }),
      ),
    ]);
    redirect(`/lives/${id}/edit`);
  }

  const live = await db.live.create({
    data: {
      ...data,
      vendorId: vendor.id,
      products: {
        create: productIds.map((productId, index) => ({
          productId,
          sortOrder: index + 1,
          isPinned: index === 0,
        })),
      },
    },
  });

  redirect(`/lives/${live.id}/preview`);
}

export async function upsertInteractionRoleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const data = {
    name: text(formData, "name"),
    avatarUrl: optionalExternalUrl(formData, "avatarUrl", "角色頭像網址"),
    label: text(formData, "label", "官方角色"),
    roleType: text(formData, "roleType", "official"),
    tone: optionalText(formData, "tone"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().interactionRole.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().interactionRole.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/interaction-roles");
}

export async function deleteInteractionRoleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = text(formData, "id");
  await getDb().interactionRole.delete({
    where: { id, vendorId: vendor.id },
  });
  redirect("/interaction-roles/new");
}

function roleAvatar(seed: string) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&radius=18`;
}

const systemRoleLibrary = [
  { name: "開場 AI 主持人", label: "AI 主持人", roleType: "ai_host", tone: "熱情但不吵，負責歡迎、提醒流程與整理重點", avatarUrl: roleAvatar("host-blue") },
  { name: "官方商品顧問", label: "官方角色", roleType: "official", tone: "清楚說明商品差異、價格與適合族群", avatarUrl: roleAvatar("advisor-cyan") },
  { name: "優惠提醒助手", label: "系統助手", roleType: "system_assistant", tone: "在關鍵節點提醒限時優惠與表單，不過度催促", avatarUrl: roleAvatar("reminder-rose") },
  { name: "客服 Q&A 助手", label: "客服助手", roleType: "support", tone: "簡短回答常見問題，引導私訊或表單", avatarUrl: roleAvatar("qa-indigo") },
  { name: "保養知識顧問", label: "官方角色", roleType: "official", tone: "用生活化方式補充使用情境與注意事項", avatarUrl: roleAvatar("care-teal") },
  { name: "成交節奏助手", label: "系統助手", roleType: "system_assistant", tone: "在商品浮出時整理賣點與 CTA", avatarUrl: roleAvatar("sales-amber") },
  { name: "直播小編", label: "官方角色", roleType: "official", tone: "像品牌小編一樣親切補充直播資訊", avatarUrl: roleAvatar("editor-purple") },
  { name: "提醒通知助手", label: "系統助手", roleType: "system_assistant", tone: "提醒報名、優惠到期、庫存與下一段重點", avatarUrl: roleAvatar("assistant-lime") },
  { name: "售後關懷助手", label: "客服助手", roleType: "support", tone: "說明出貨、保固、退換貨與客服入口", avatarUrl: roleAvatar("support-green") },
  { name: "限時活動主持", label: "AI 主持人", roleType: "ai_host", tone: "在促銷段落帶節奏，強調活動時間與組合價值", avatarUrl: roleAvatar("promo-red") },
];

export async function importSystemRolesAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const db = getDb();
  const existing = await db.interactionRole.findMany({
    where: {
      vendorId: vendor.id,
      name: { in: systemRoleLibrary.map((role) => role.name) },
    },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((role) => role.name));

  await db.interactionRole.createMany({
    data: systemRoleLibrary
      .filter((role) => !existingNames.has(role.name))
      .map((role) => ({ ...role, vendorId: vendor.id, isActive: true })),
  });

  revalidatePath("/interaction-roles");
  redirect("/interaction-roles");
}

export async function upsertInteractionScriptAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const db = getDb();
  const roleIds = formData.getAll("roleId").map(String);
  const eventTypes = formData.getAll("eventType").map(String);
  const parsedTriggerSecs = formData.getAll("triggerSec").map((value) => parseInteractionTriggerSeconds(String(value)));
  const titles = formData.getAll("eventTitle").map(String);
  const messages = formData.getAll("message").map(String);
  const productIds = formData.getAll("productId").map(String);
  const ctaLabels = formData.getAll("ctaLabel").map(String);
  const ctaUrls = formData.getAll("ctaUrl").map(String);

  if (parsedTriggerSecs.length !== eventTypes.length || parsedTriggerSecs.some((triggerSec) => triggerSec === null)) {
    throw new Error(INTERACTION_TIME_FORMAT_ERROR);
  }
  const triggerSecs = parsedTriggerSecs.map((triggerSec) => {
    if (triggerSec === null) throw new Error(INTERACTION_TIME_FORMAT_ERROR);
    return triggerSec;
  });

  const events = eventTypes
    .map((eventType, index) => ({
      eventType,
      triggerSec: triggerSecs[index],
      title: titles[index]?.trim() || `${eventType} ${index + 1}`,
      message: messages[index]?.trim() || null,
      productId: productIds[index]?.trim() || null,
      ctaLabel: ctaLabels[index]?.trim() || null,
      ctaUrl: safeExternalUrl(ctaUrls[index]?.trim() || null, `第 ${index + 1} 個 CTA 網址`),
      roleId: roleIds[index]?.trim() || null,
    }))
    .filter((event) => event.eventType && event.title);

  const data = {
    name: text(formData, "name"),
    description: optionalText(formData, "description"),
    status: text(formData, "status", "draft"),
  };

  if (id) {
    await db.$transaction([
      db.interactionScript.update({ where: { id, vendorId: vendor.id }, data }),
      db.interactionEvent.deleteMany({ where: { scriptId: id } }),
      ...events.map((event) => db.interactionEvent.create({ data: { ...event, scriptId: id } })),
    ]);
  } else {
    await db.interactionScript.create({
      data: {
        ...data,
        vendorId: vendor.id,
        events: { create: events },
      },
    });
  }

  redirect("/interaction-scripts");
}

export async function unbindInteractionScriptFromLiveAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const scriptId = text(formData, "id");
  const liveId = text(formData, "liveId");

  if (!scriptId || !liveId) {
    throw new Error("直播不存在或未綁定此互動腳本。");
  }

  const updateResult = await getDb().live.updateMany({
    where: {
      id: liveId,
      vendorId: vendor.id,
      interactionScriptId: scriptId,
      interactionScript: { is: { id: scriptId, vendorId: vendor.id } },
    },
    data: { interactionScriptId: null },
  });

  if (updateResult.count !== 1) {
    throw new Error("直播不存在或未綁定此互動腳本。");
  }

  revalidatePath("/interaction-scripts");
  revalidatePath(`/interaction-scripts/${scriptId}/edit`);
  revalidatePath("/lives");
  revalidatePath(`/lives/${liveId}/edit`);
}

export async function duplicateInteractionScriptAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = text(formData, "id");
  const script = await getDb().interactionScript.findFirst({
    where: { id, vendorId: vendor.id },
    include: { events: { orderBy: { triggerSec: "asc" } } },
  });
  if (!script) {
    redirect("/interaction-scripts");
  }

  await getDb().interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: `${script.name} 複本`,
      description: script.description,
      status: "draft",
      events: {
        create: script.events.map((event) => ({
          eventType: event.eventType,
          triggerSec: event.triggerSec,
          title: event.title,
          message: event.message,
          productId: event.productId,
          ctaLabel: event.ctaLabel,
          ctaUrl: event.ctaUrl,
          roleId: event.roleId,
          metadata: event.metadata as Prisma.InputJsonValue,
        })),
      },
    },
  });

  revalidatePath("/interaction-scripts");
  redirect("/interaction-scripts");
}

export async function deleteInteractionScriptAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = text(formData, "id");
  await getDb().interactionScript.delete({
    where: { id, vendorId: vendor.id },
  });
  revalidatePath("/interaction-scripts");
  redirect("/interaction-scripts");
}

export async function upsertBlacklistAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const identifierType = BlacklistIdentifierType.safeParse(text(formData, "identifierType", "email"));
  const identifier = identifierType.success
    ? normalizeBlacklistIdentifier(identifierType.data, text(formData, "identifier"))
    : null;
  if (!identifierType.success || !identifier) {
    redirect("/blacklists?error=invalid_identifier");
  }
  await getDb().blacklist.create({
    data: {
      vendorId: vendor.id,
      identifier,
      identifierType: identifierType.data,
      reason: text(formData, "reason"),
      notes: optionalText(formData, "notes"),
    },
  });
  revalidatePath("/blacklists");
}

export async function unblockBlacklistAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = text(formData, "id");
  await getDb().blacklist.update({
    where: { id, vendorId: vendor.id },
    data: {
      isActive: false,
      unblockedAt: new Date(),
    },
  });
  revalidatePath("/blacklists");
}

export async function upsertAffiliateAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const data = {
    name: text(formData, "name"),
    code: text(formData, "code").toUpperCase(),
    source: optionalText(formData, "source"),
    contactEmail: optionalText(formData, "contactEmail"),
    commissionRateBps: intValue(formData, "commissionRateBps"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().affiliate.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().affiliate.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/affiliates");
}

export async function generateSettlementAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const vendorId = text(formData, "vendorId");
  const monthKey = text(formData, "monthKey");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    redirect("/admin/billing/settlements?error=missing");
  }

  const db = getDb();
  const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) {
    redirect("/admin/billing/settlements?error=missing");
  }

  const existing = await db.settlement.findUnique({ where: { vendorId_monthKey: { vendorId, monthKey } } });
  if (existing?.lockedAt) {
    redirect("/admin/billing/settlements?error=locked");
  }

  const calculation = await calculateSettlement(vendorId, monthKey);
  const adjustmentAmountCents = existing?.adjustmentAmountCents ?? 0;
  const adjustmentReason = existing?.adjustmentReason ?? null;
  const finalPayoutAmountCents = calculation.payoutableAmountCents + adjustmentAmountCents;

  const settlement = await db.$transaction(async (tx) => {
    const savedSettlement = await tx.settlement.upsert({
      where: { vendorId_monthKey: { vendorId, monthKey } },
      create: {
        vendorId,
        monthKey,
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        paymentGatewayFeeCents: calculation.paymentGatewayFeeCents,
        grossRevenueCents: calculation.grossRevenueCents,
        payoutableAmountCents: calculation.payoutableAmountCents,
        adjustmentAmountCents,
        adjustmentReason,
        finalPayoutAmountCents,
        status: "draft",
      },
      update: {
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        paymentGatewayFeeCents: calculation.paymentGatewayFeeCents,
        grossRevenueCents: calculation.grossRevenueCents,
        payoutableAmountCents: calculation.payoutableAmountCents,
        finalPayoutAmountCents,
        status: "draft",
      },
    });

    const subtotalCents =
      calculation.monthlyFeeCents +
      calculation.overflowFeeCents +
      calculation.paymentServiceFeeCents +
      calculation.transactionServiceFeeCents +
      calculation.affiliateManagementFeeCents;

    await tx.invoice.upsert({
      where: { invoiceNumber: invoiceNumber(vendor.slug, monthKey) },
      create: {
        vendorId,
        monthKey,
        invoiceNumber: invoiceNumber(vendor.slug, monthKey),
        invoiceType: "monthly",
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        subtotalCents,
        totalCents: subtotalCents,
        status: "issued",
      },
      update: {
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        subtotalCents,
        totalCents: subtotalCents,
        status: "issued",
      },
    });

    return savedSettlement;
  });

  await writeAuditLog({
    vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "generate_settlement",
    targetType: "Settlement",
    targetId: settlement.id,
    before: auditSnapshot(existing),
    after: auditSnapshot({ settlement, calculation }),
  });

  revalidatePath("/admin/billing/settlements");
  revalidatePath("/billing/settlements");
  revalidatePath("/billing/invoices");
  redirect("/admin/billing/settlements");
}

export async function updateSettlementAdjustmentAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const adjustmentAmountCents = moneyToCents(formData, "adjustmentAmount");
  const adjustmentReason = optionalText(formData, "adjustmentReason");
  const settlement = await getDb().settlement.findUnique({ where: { id } });
  if (!settlement || settlement.lockedAt) {
    redirect("/admin/billing/settlements?error=locked");
  }

  const updated = await getDb().settlement.update({
    where: { id },
    data: {
      adjustmentAmountCents,
      adjustmentReason,
      reviewedBy: member.id,
      finalPayoutAmountCents: settlement.payoutableAmountCents + adjustmentAmountCents,
    },
  });

  await writeAuditLog({
    vendorId: settlement.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "update_settlement_adjustment",
    targetType: "Settlement",
    targetId: settlement.id,
    before: auditSnapshot(settlement),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/settlements");
}

export async function lockSettlementAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const settlement = await getDb().settlement.findUnique({ where: { id } });
  if (!settlement || settlement.lockedAt) {
    redirect("/admin/billing/settlements");
  }

  const db = getDb();
  const updated = await db.$transaction(async (tx) => {
    const locked = await tx.settlement.update({
      where: { id },
      data: {
        status: "locked",
        lockedAt: new Date(),
        lockedBy: member.id,
        reviewedBy: member.id,
      },
    });
    await tx.affiliateCommission.updateMany({
      where: { vendorId: settlement.vendorId, monthKey: settlement.monthKey, status: { in: ["pending", "approved"] } },
      data: { status: "locked", settledAt: new Date() },
    });
    return locked;
  });

  await writeAuditLog({
    vendorId: settlement.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "lock_settlement",
    targetType: "Settlement",
    targetId: settlement.id,
    before: auditSnapshot(settlement),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/settlements");
  revalidatePath("/billing/settlements");
  redirect("/admin/billing/settlements");
}

export async function createPayoutBatchAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const settlementIds = formData.getAll("settlementIds").filter((value): value is string => typeof value === "string" && value.length > 0);
  if (settlementIds.length === 0) {
    redirect("/admin/billing/payouts?error=empty");
  }

  const db = getDb();
  const settlements = await db.settlement.findMany({
    where: {
      id: { in: settlementIds },
      lockedAt: { not: null },
      payoutBatchId: null,
      finalPayoutAmountCents: { gt: 0 },
    },
    include: { vendor: { include: { paymentAccounts: true } } },
  });

  if (settlements.length === 0) {
    redirect("/admin/billing/payouts?error=no_locked");
  }

  const now = new Date();
  const batchNumber = payoutBatchNumber(now);
  const totalAmountCents = settlements.reduce((sum, settlement) => sum + settlement.finalPayoutAmountCents, 0);

  const batch = await db.$transaction(async (tx) => {
    const batch = await tx.payoutBatch.create({
      data: {
        batchNumber,
        batchDate: now,
        totalAmountCents,
        totalCount: settlements.length,
        status: "draft",
        exportedFilePath: `/admin/billing/payouts/${batchNumber}/csv`,
      },
    });

    for (const settlement of settlements) {
      const account = settlement.vendor.paymentAccounts.find((item) => item.mode === "platform" && item.bankAccountNumber) ?? settlement.vendor.paymentAccounts[0];
      await tx.payoutItem.create({
        data: {
          payoutBatchId: batch.id,
          vendorId: settlement.vendorId,
          settlementId: settlement.id,
          bankAccountName: account?.bankAccountName ?? settlement.vendor.name,
          bankCode: account?.bankCode ?? "000",
          bankAccountNumber: account?.bankAccountNumber ?? "未設定",
          payoutAmountCents: settlement.finalPayoutAmountCents,
          status: "pending",
        },
      });
      await tx.settlement.update({
        where: { id: settlement.id },
        data: {
          payoutBatchId: batch.id,
          batchNumber,
          status: "ready_for_payout",
          payoutDate: now,
        },
      });
    }

    return batch;
  });

  await writeAuditLog({
    vendorId: settlements[0]?.vendorId ?? null,
    actorId: member.id,
    actorLabel: member.role,
    action: "create_payout_batch",
    targetType: "PayoutBatch",
    targetId: batch.id,
    before: auditSnapshot({ settlementIds }),
    after: auditSnapshot({ batch, settlements: settlements.map((settlement) => settlement.id) }),
  });

  revalidatePath("/admin/billing/payouts");
  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/payouts");
}

export async function updatePayoutItemStatusAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const status = text(formData, "status", "pending");
  const failReason = optionalText(formData, "failReason");
  const item = await getDb().payoutItem.findUnique({ where: { id }, include: { payoutBatch: true } });
  if (!item) {
    redirect("/admin/billing/payouts");
  }

  const data: Prisma.PayoutItemUpdateInput = {
    status,
    failReason: status === "failed" ? failReason : null,
  };

  if (status === "paid") {
    data.paidAt = new Date();
  }

  if (status === "retrying") {
    data.retriedAt = new Date();
    data.retryCount = { increment: 1 };
  }

  const updated = await getDb().$transaction(async (tx) => {
    const savedItem = await tx.payoutItem.update({ where: { id }, data });
    const items = await tx.payoutItem.findMany({ where: { payoutBatchId: item.payoutBatchId } });
    const paidItems = items.filter((batchItem) => batchItem.status === "paid" || batchItem.id === id && status === "paid");
    const failedItems = items.filter((batchItem) => batchItem.status === "failed" || batchItem.id === id && status === "failed");
    const batchStatus = paidItems.length === items.length ? "completed" : failedItems.length > 0 ? "failed" : item.payoutBatch.status;

    await tx.payoutBatch.update({
      where: { id: item.payoutBatchId },
      data: {
        status: batchStatus,
        executedAt: batchStatus === "completed" ? new Date() : item.payoutBatch.executedAt,
      },
    });

    if (item.settlementId && status === "paid") {
      await tx.settlement.update({
        where: { id: item.settlementId },
        data: { status: "paid", paidAt: new Date() },
      });
    }

    return savedItem;
  });

  await writeAuditLog({
    vendorId: item.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: `mark_payout_${status}`,
    targetType: "PayoutItem",
    targetId: item.id,
    before: auditSnapshot(item),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/payouts");
  revalidatePath("/billing/payouts");
  redirect("/admin/billing/payouts");
}

export async function markPayoutBatchExportedAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const before = await getDb().payoutBatch.findUnique({ where: { id } });
  const updated = await getDb().payoutBatch.update({
    where: { id },
    data: {
      status: "exported",
      exportedAt: new Date(),
    },
  });
  await writeAuditLog({
    actorId: member.id,
    actorLabel: member.role,
    action: "export_payout_batch",
    targetType: "PayoutBatch",
    targetId: id,
    before: auditSnapshot(before),
    after: auditSnapshot(updated),
  });
  revalidatePath("/admin/billing/payouts");
  redirect("/admin/billing/payouts");
}

export async function refundPaymentTransactionAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const refundAmountCents = moneyToCents(formData, "refundAmount");
  const gatewayFeeRefundCents = moneyToCents(formData, "gatewayFeeRefund");
  const platformFeeRefundCents = moneyToCents(formData, "platformFeeRefund");
  const reason = optionalText(formData, "reason");
  const monthKey = text(formData, "monthKey", new Date().toISOString().slice(0, 7));
  if (
    refundAmountCents <= 0 ||
    gatewayFeeRefundCents < 0 ||
    platformFeeRefundCents < 0 ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)
  ) {
    redirect("/admin/billing/dashboard?error=refund");
  }
  const db = getDb();

  const { transaction, updated } = await (async () => {
    for (let attempt = 1; attempt <= REFUND_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(async (tx) => {
          const transaction = await tx.paymentTransaction.findUnique({ where: { id } });
          if (!transaction) throw new RefundValidationError();

          const remainingRefundAmountCents = transaction.grossAmountCents - transaction.refundedAmountCents;
          if (refundAmountCents > remainingRefundAmountCents) throw new RefundValidationError();

          const processedFeeRefunds = await tx.refundRecord.aggregate({
            where: { paymentTransactionId: transaction.id, status: "processed" },
            _sum: {
              gatewayFeeRefundCents: true,
              platformFeeRefundCents: true,
            },
          });
          const refundedGatewayFeeCents = processedFeeRefunds._sum.gatewayFeeRefundCents ?? 0;
          const refundedPlatformFeeCents = processedFeeRefunds._sum.platformFeeRefundCents ?? 0;
          if (
            refundedGatewayFeeCents + gatewayFeeRefundCents > transaction.gatewayFeeCents ||
            refundedPlatformFeeCents + platformFeeRefundCents > transaction.platformFeeCents
          ) {
            throw new RefundValidationError();
          }

          const refundedAmountCents = transaction.refundedAmountCents + refundAmountCents;
          const status = refundedAmountCents >= transaction.grossAmountCents ? "refunded" : "partially_refunded";
          await tx.refundRecord.create({
            data: {
              vendorId: transaction.vendorId,
              paymentTransactionId: transaction.id,
              monthKey,
              refundAmountCents,
              gatewayFeeRefundCents,
              platformFeeRefundCents,
              reason,
            },
          });
          const updated = await tx.paymentTransaction.update({
            where: { id },
            data: {
              status,
              refundedAmountCents,
              refundReason: reason,
              refundedAt: new Date(),
            },
          });

          return { transaction, updated };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (isRefundSerializationConflict(error) && attempt < REFUND_TRANSACTION_MAX_ATTEMPTS) {
          continue;
        }

        if (error instanceof RefundValidationError || isRefundTransactionConflict(error)) {
          redirect("/admin/billing/dashboard?error=refund");
        }
        throw error;
      }
    }

    throw new Error("Refund transaction retry loop exited unexpectedly");
  })();

  await writeAuditLog({
    vendorId: transaction.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "refund_payment_transaction",
    targetType: "PaymentTransaction",
    targetId: transaction.id,
    before: auditSnapshot(transaction),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/dashboard");
}

export async function voidAffiliateCommissionAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const reason = optionalText(formData, "reason");
  const commission = await getDb().affiliateCommission.findUnique({ where: { id } });
  if (!commission || commission.status === "paid") {
    redirect("/admin/billing/dashboard?error=commission");
  }

  const updated = await getDb().affiliateCommission.update({
    where: { id },
    data: {
      status: "void",
      commissionAmountCents: 0,
      settledAt: new Date(),
      sourceType: reason ? `${commission.sourceType}: ${reason}` : commission.sourceType,
    },
  });

  await writeAuditLog({
    vendorId: commission.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "void_affiliate_commission",
    targetType: "AffiliateCommission",
    targetId: commission.id,
    before: auditSnapshot(commission),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/affiliates/commissions");
  redirect("/admin/billing/dashboard");
}

export async function retryWebhookEventAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const event = await getDb().webhookEvent.findUnique({ where: { id } });
  if (!event) {
    redirect("/admin/billing/dashboard?error=webhook");
  }
  if (event.retryCount >= event.maxRetries) {
    redirect("/admin/billing/dashboard?error=max_retries");
  }
  await retryWebhookEvent(id, member.role);

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/admin/billing/webhooks");
  revalidatePath(`/admin/billing/webhooks/${id}`);
  redirect("/admin/billing/dashboard");
}
