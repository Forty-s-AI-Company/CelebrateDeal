"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  AUTH_COOKIE,
  LEGACY_VENDOR_COOKIE,
  authenticateUser,
  createUserSession,
  markCurrentSessionMfaVerified,
  requireAuth,
  requireFinanceAdmin,
  requirePlatformAdmin,
  requireVendor,
  requireVendorOwner,
  revokeCurrentSession,
  sessionCookieOptions,
} from "@/lib/auth";
import { auditSnapshot, requestAuditMeta, writeAuditLog } from "@/lib/audit";
import { payoutBatchNumber } from "@/lib/billing";
import { assertServerActionSecurity } from "@/lib/csrf";
import { retryWebhookEvent } from "@/lib/webhook-retry";
import { processManualRefund } from "@/lib/payment-webhooks";
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
  isRecoveryCodeFormat,
} from "@/lib/mfa";
import { hashPassword } from "@/lib/password";
import { sendPasswordResetLink } from "@/lib/password-reset";
import { toSlug } from "@/lib/format";
import { normalizeOptionalCommerceUrl, safeCommerceUrlOrNull } from "@/lib/safe-commerce-url";
import { assertVendorOwnsRelations } from "@/lib/vendor-relations";
import {
  acceptVendorInvitation,
  createVendorInvitation,
  getInvitationDetails,
  hashInvitationToken,
  INVITATION_ROLES,
  revokeVendorInvitation,
  sendVendorInvitationEmail,
} from "@/lib/invitation";
import { canInviteWorkspaceOwner, deactivateWorkspaceMember, switchCurrentWorkspace } from "@/lib/workspace";
import { canTransitionPayoutItem } from "@/lib/financial-data";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import {
  ExternalStorefrontError,
  productCheckoutSettings,
  reviewExternalOrderEvidence,
  submitExternalOrderEvidence,
  upsertAffiliateProductLink,
} from "@/lib/external-storefront";
import {
  assertVendorEntitlement,
  type EntitlementOperation,
  VendorEntitlementError,
} from "@/lib/entitlements";
import {
  canManageCommerceProducts,
  canManageCourses,
  canManageLiveRooms,
  canManageMessageDelivery,
  canManageVideos,
} from "@/lib/vendor-capabilities";
import { queueNotificationRetry } from "@/lib/notifications";
import {
  generateSettlementRecord,
  lockSettlementRecord,
  SettlementOperationError,
  updateSettlementAdjustmentRecord,
} from "@/lib/settlement-operations";
import {
  AffiliatePayoutError,
  approveAffiliateCommission,
  createAffiliatePayout,
  createManualCommissionAdjustment,
  reverseAffiliateCommission,
  transitionAffiliatePayout,
} from "@/lib/affiliate-payouts";
import {
  CourseDomainError,
  upsertCourse,
  upsertCourseLesson,
  upsertCourseSession,
} from "@/lib/courses";
import { getLivePublicationIssue } from "@/lib/live-publication";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
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

function secondsValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed.includes(":")) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parts = trimmed.split(":").map((part) => Number.parseInt(part, 10) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;

const invitationSchema = z.object({
  email: z.email(),
  role: z.enum(INVITATION_ROLES),
});

const onboardingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(80),
  email: z.email(),
  timezone: z.string().trim().min(1).max(80),
  supportEmail: z.union([z.literal(""), z.email()]),
});

const opaqueIdSchema = z.string().trim().min(1).max(128);
const invitationAcceptSchema = z.object({
  token: z.string().trim().min(32).max(256),
  name: z.string().trim().max(120),
  password: z.string().max(256),
  confirmPassword: z.string().max(256),
});

const productCheckoutSchema = z.object({
  checkoutMode: z.enum(["platform", "external"]),
  checkoutUrl: z.string().trim().max(2048).nullable(),
});

const affiliateProductLinkSchema = z.object({
  affiliateId: opaqueIdSchema,
  productId: opaqueIdSchema,
  url: z.string().trim().min(1).max(2048),
  isActive: z.boolean(),
});

const externalOrderEvidenceSchema = z.object({
  affiliateId: opaqueIdSchema,
  productId: opaqueIdSchema,
  externalOrderReference: z.string().trim().min(1).max(160),
  amountCents: z.number().int().positive(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
});

const externalOrderReviewSchema = z.object({
  evidenceId: opaqueIdSchema,
  decision: z.enum(["confirmed", "rejected"]),
  reviewNote: z.string().trim().max(500).nullable(),
});

const courseSchema = z.object({
  id: opaqueIdSchema.nullable(),
  title: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(2).max(80),
  description: z.string().trim().max(5000).nullable(),
  coverImageUrl: z.string().trim().max(2048).nullable(),
  registrationFormId: opaqueIdSchema.nullable(),
  defaultProductId: opaqueIdSchema.nullable(),
  status: z.enum(["draft", "published", "archived"]),
});

const courseLessonSchema = z.object({
  id: opaqueIdSchema.nullable(),
  courseId: opaqueIdSchema,
  videoId: opaqueIdSchema.nullable(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(3000).nullable(),
  sortOrder: z.number().int().nonnegative(),
  status: z.enum(["draft", "published"]),
  isPreview: z.boolean(),
});

const courseSessionSchema = z.object({
  id: opaqueIdSchema.nullable(),
  courseId: opaqueIdSchema,
  liveId: opaqueIdSchema.nullable(),
  title: z.string().trim().min(1).max(160),
  startsAt: z.date(),
  endsAt: z.date().nullable(),
  status: z.enum(["scheduled", "live", "ended", "canceled"]),
  capacity: z.number().int().positive().nullable(),
}).refine((value) => !value.endsAt || value.endsAt >= value.startsAt, { message: "Invalid session range" });

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function safeInternalPath(value: string, fallback = "/admin/billing/dashboard") {
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

async function enforceVendorWriteAccess(
  vendorId: string,
  operation: EntitlementOperation,
  requestedUnits = 0,
) {
  try {
    return await assertVendorEntitlement(vendorId, operation, { requestedUnits });
  } catch (error) {
    if (!(error instanceof VendorEntitlementError)) throw error;
    const auth = await requireAuth();
    await writeAuditLog({
      vendorId,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "entitlement_denied",
      targetType: "VendorSubscription",
      targetId: vendorId,
      after: { operation: error.operation, reason: error.reason },
    });
    redirect(`/billing/plans?error=${error.reason}`);
  }
}

async function requireCourseManager(targetId?: string | null) {
  const auth = await requireAuth();
  if (!auth.vendor || !auth.member || !canManageCourses(auth.member.role)) {
    await writeAuditLog({
      vendorId: auth.vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "course_mutation_rejected",
      targetType: "Course",
      targetId: targetId ?? null,
      after: auditSnapshot({ reason: "course_manager_required" }),
    });
    redirect("/courses?error=course_manager_required");
  }
  await enforceVendorWriteAccess(auth.vendor.id, "vendor_write");
  return { ...auth, vendor: auth.vendor, member: auth.member };
}

async function countRecentLoginFailures(email: string) {
  return getDb().auditLog.count({
    where: {
      action: "login_failed",
      targetType: "Auth",
      targetId: email,
      createdAt: { gte: new Date(Date.now() - LOGIN_FAILURE_WINDOW_MS) },
    },
  });
}

export async function loginAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const email = normalizedEmail(text(formData, "email"));
  const password = text(formData, "password");

  if (await countRecentLoginFailures(email) >= LOGIN_FAILURE_LIMIT) {
    await writeAuditLog({
      actorLabel: "anonymous",
      action: "login_rate_limited",
      targetType: "Auth",
      targetId: email,
      after: { email },
    });
    redirect("/login?error=rate_limited");
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

  const headerStore = await headers();
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

  if (auth.vendor?.onboardingStatus !== "completed" && auth.member?.role === "owner") {
    redirect("/onboarding");
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
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
  await getDb().vendor.update({
    where: { id: vendor.id },
    data: {
      name: text(formData, "name"),
      slug: toSlug(text(formData, "slug")),
      logoUrl: optionalText(formData, "logoUrl"),
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
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
  const attributionPolicy = z.enum(["first_touch", "last_touch"]).catch("last_touch").parse(text(formData, "attributionPolicy", "last_touch"));
  const attributionWindowDays = z.coerce.number().int().min(1).max(90).catch(30).parse(formData.get("attributionWindowDays"));
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
      attributionPolicy,
      attributionWindowDays,
    },
    update: {
      facebookPixelId: optionalText(formData, "facebookPixelId"),
      tiktokPixelId: optionalText(formData, "tiktokPixelId"),
      googleTagManagerId: optionalText(formData, "googleTagManagerId"),
      enablePageView: formData.get("enablePageView") === "on",
      enableLeadEvent: formData.get("enableLeadEvent") === "on",
      enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
      attributionPolicy,
      attributionWindowDays,
    },
  });
  revalidatePath("/settings/tracking");
}

export async function updatePasswordAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const password = text(formData, "password");
  if (password.length < 12) {
    redirect("/settings/security?error=short");
  }
  await getDb().user.update({
    where: { id: auth.user.id },
    data: { passwordHash: hashPassword(password) },
  });
  await writeAuditLog({
    vendorId: auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: "update_password",
    targetType: "User",
    targetId: auth.user.id,
    after: { email: auth.user.email },
  });
  redirect("/settings/security?updated=1");
}

export async function requestPasswordResetAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const email = normalizedEmail(text(formData, "email"));
  if (!email) {
    redirect("/password-reset/request?error=invalid");
  }

  const headerStore = await headers();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023";
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

  const requestHeaders = await headers();
  const rateLimitRequest = new Request(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023", {
      headers: {
        "cf-connecting-ip": requestHeaders.get("cf-connecting-ip") ?? "",
        "x-forwarded-for": requestHeaders.get("x-forwarded-for") ?? "",
      },
    });
  const rateLimitKey = `mfa-verify:${auth.user.id}`;
  const limited = await checkRateLimit(
    rateLimitRequest,
    rateLimitKey,
    5,
    15 * 60 * 1000,
    { scope: "global" },
  );
  if (limited) {
    await writeAuditLog({
      vendorId: auth.vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "mfa_verify_rate_limited",
      targetType: "UserMfaFactor",
      targetId: auth.user.id,
    });
    redirect(`/mfa/verify?error=rate_limited&next=${encodeURIComponent(next)}`);
  }

  if (!auth.user.mfaFactor) {
    redirect("/mfa/setup");
  }

  const secret = decryptMfaSecret(auth.user.mfaFactor.secretEncrypted);
  const validTotp = verifyTotpCode(secret, code);
  const recoveryCodes = !validTotp && isRecoveryCodeFormat(code)
    ? await getDb().userRecoveryCode.findMany({ where: { userId: auth.user.id, usedAt: null } })
    : [];
  const matchedRecoveryCode = recoveryCodes.find((recoveryCode) => verifyRecoveryCode(code, recoveryCode.codeHash));
  if (!validTotp && !matchedRecoveryCode) {
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
  await resetRateLimit(rateLimitRequest, rateLimitKey, { scope: "global" });
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

  const recoveryCodes = generateRecoveryCodes();
  await getDb().$transaction([
    getDb().userRecoveryCode.deleteMany({ where: { userId: auth.user.id } }),
    getDb().userRecoveryCode.createMany({
      data: recoveryCodes.map((codeValue) => ({
        userId: auth.user.id,
        codeHash: hashRecoveryCode(codeValue),
      })),
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023";
  const destination = auth.isPlatformAdmin ? "/mfa/setup" : "/settings/security";
  let sent = false;

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

export async function inviteVendorMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const parsed = invitationSchema.safeParse({
    email: normalizedEmail(text(formData, "email")),
    role: text(formData, "role", "accountant"),
  });
  if (!parsed.success) {
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "vendor_invitation_validation_rejected",
      targetType: "VendorInvitation",
    });
    redirect("/settings/team?error=invite_unavailable");
  }

  if (parsed.data.role === "owner" && !canInviteWorkspaceOwner({
    hasMfaFactor: Boolean(auth.user.mfaFactor),
    mfaVerifiedAt: auth.session.mfaVerifiedAt,
  })) {
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "vendor_owner_invitation_step_up_required",
      targetType: "VendorInvitation",
    });
    redirect("/settings/team?error=owner_step_up_required");
  }

  const created = await createVendorInvitation({
    vendorId: auth.vendor.id,
    email: parsed.data.email,
    role: parsed.data.role,
    invitedByUserId: auth.user.id,
  });

  if (!created.ok) {
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "vendor_invitation_rejected",
      targetType: "VendorInvitation",
      after: auditSnapshot({ email: parsed.data.email, role: parsed.data.role, reason: "unavailable" }),
    });
    redirect("/settings/team?error=invite_unavailable");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023";
  const invitationUrl = new URL(`/invite/${encodeURIComponent(created.token)}`, appUrl).toString();
  let delivery: "email" | "preview" = "email";
  try {
    await sendVendorInvitationEmail({
      to: parsed.data.email,
      vendorName: auth.vendor.name,
      invitationUrl,
      expiresAt: created.expiresAt,
    });
  } catch {
    if (process.env.NODE_ENV === "production") {
      await revokeVendorInvitation({ invitationId: created.invitation.id, vendorId: auth.vendor.id });
      await writeAuditLog({
        vendorId: auth.vendor.id,
        actorId: auth.user.id,
        actorLabel: auth.member.role,
        action: "vendor_invitation_delivery_failed",
        targetType: "VendorInvitation",
        targetId: created.invitation.id,
        after: auditSnapshot({ email: parsed.data.email }),
      });
      redirect("/settings/team?error=invite_delivery");
    }
    delivery = "preview";
  }

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "vendor_invitation_created",
    targetType: "VendorInvitation",
    targetId: created.invitation.id,
    after: auditSnapshot({
      email: parsed.data.email,
      role: parsed.data.role,
      expiresAt: created.expiresAt.toISOString(),
      delivery,
    }),
  });

  revalidatePath("/settings/team");
  const preview = delivery === "preview" ? `&preview=${encodeURIComponent(invitationUrl)}` : "";
  redirect(`/settings/team?updated=invitation_sent${preview}`);
}

export async function revokeVendorInvitationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const invitationId = opaqueIdSchema.safeParse(text(formData, "invitationId"));
  const revoked = invitationId.success
    ? await revokeVendorInvitation({ invitationId: invitationId.data, vendorId: auth.vendor.id })
    : false;

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: revoked ? "vendor_invitation_revoked" : "vendor_invitation_revoke_rejected",
    targetType: "VendorInvitation",
    targetId: invitationId.success ? invitationId.data : null,
  });

  revalidatePath("/settings/team");
  redirect(revoked ? "/settings/team?updated=invitation_revoked" : "/settings/team?error=invite_unavailable");
}

export async function acceptVendorInvitationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const parsed = invitationAcceptSchema.safeParse({
    token: text(formData, "token"),
    name: text(formData, "name"),
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) {
    await writeAuditLog({
      actorLabel: "invitation_accept",
      action: "vendor_invitation_accept_rejected",
      targetType: "VendorInvitation",
      after: auditSnapshot({ reason: "invalid_input" }),
    });
    redirect("/invite/invalid?error=invalid");
  }

  const requestHeaders = await headers();
  const rateLimitRequest = new Request(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023", {
    headers: {
      "cf-connecting-ip": requestHeaders.get("cf-connecting-ip") ?? "",
      "x-forwarded-for": requestHeaders.get("x-forwarded-for") ?? "",
    },
  });
  const limited = await checkRateLimit(
    rateLimitRequest,
    `invitation-accept:${hashInvitationToken(parsed.data.token).slice(0, 24)}`,
    5,
    15 * 60 * 1000,
    { scope: "global" },
  );
  if (limited) {
    await writeAuditLog({
      actorLabel: "invitation_accept",
      action: "vendor_invitation_accept_rate_limited",
      targetType: "VendorInvitation",
      targetId: hashInvitationToken(parsed.data.token).slice(0, 16),
    });
    redirect(`/invite/${encodeURIComponent(parsed.data.token)}?error=rate_limited`);
  }

  const invitationDetails = await getInvitationDetails(parsed.data.token);
  if (!invitationDetails) {
    redirect(`/invite/${encodeURIComponent(parsed.data.token)}?error=invalid`);
  }
  if (invitationDetails.requiresRegistration && parsed.data.password !== parsed.data.confirmPassword) {
    await writeAuditLog({
      actorLabel: "invitation_accept",
      action: "vendor_invitation_accept_rejected",
      targetType: "VendorInvitation",
      targetId: hashInvitationToken(parsed.data.token).slice(0, 16),
      after: auditSnapshot({ reason: "profile_invalid" }),
    });
    redirect(`/invite/${encodeURIComponent(parsed.data.token)}?error=profile_invalid`);
  }

  const accepted = await acceptVendorInvitation({
    token: parsed.data.token,
    name: parsed.data.name,
    password: parsed.data.password,
  });
  if (!accepted.ok) {
    await writeAuditLog({
      actorLabel: "invitation_accept",
      action: "vendor_invitation_accept_rejected",
      targetType: "VendorInvitation",
      targetId: hashInvitationToken(parsed.data.token).slice(0, 16),
      after: auditSnapshot({ reason: accepted.reason }),
    });
    const error = accepted.reason === "profile_invalid" ? "profile_invalid" : "invalid";
    redirect(`/invite/${encodeURIComponent(parsed.data.token)}?error=${error}`);
  }

  const { token: sessionToken, expiresAt } = await createUserSession({
    userId: accepted.userId,
    vendorId: accepted.vendorId,
    ipAddress: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: requestHeaders.get("user-agent"),
  });
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, sessionToken, sessionCookieOptions(expiresAt));
  cookieStore.delete(LEGACY_VENDOR_COOKIE);

  await writeAuditLog({
    vendorId: accepted.vendorId,
    actorId: accepted.userId,
    actorLabel: accepted.role,
    action: "vendor_invitation_accepted",
    targetType: "VendorInvitation",
    targetId: accepted.invitationId,
    after: auditSnapshot({ membershipId: accepted.membershipId, role: accepted.role }),
  });

  redirect(accepted.onboardingStatus !== "completed" && accepted.role === "owner" ? "/onboarding" : "/dashboard");
}

export async function switchWorkspaceAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const vendorId = opaqueIdSchema.safeParse(text(formData, "vendorId"));
  const switched = vendorId.success
    ? await switchCurrentWorkspace({
        sessionId: auth.session.id,
        userId: auth.user.id,
        vendorId: vendorId.data,
      })
    : false;

  await writeAuditLog({
    vendorId: switched && vendorId.success ? vendorId.data : auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: switched ? "workspace_switched" : "workspace_switch_rejected",
    targetType: "UserSession",
    targetId: auth.session.id,
    before: auditSnapshot({ vendorId: auth.vendor?.id ?? null }),
    after: auditSnapshot({ vendorId: switched && vendorId.success ? vendorId.data : null }),
  });

  redirect(switched ? "/dashboard" : "/settings/team?error=workspace_unavailable");
}

export async function completeOnboardingAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const parsed = onboardingSchema.safeParse({
    name: text(formData, "name"),
    slug: toSlug(text(formData, "slug")),
    email: normalizedEmail(text(formData, "email")),
    timezone: text(formData, "timezone", "Asia/Taipei"),
    supportEmail: normalizedEmail(text(formData, "supportEmail")),
  });
  if (!parsed.success) {
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "vendor_onboarding_validation_rejected",
      targetType: "Vendor",
      targetId: auth.vendor.id,
    });
    redirect("/onboarding?error=invalid");
  }

  try {
    const updated = await getDb().vendor.update({
      where: { id: auth.vendor.id },
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        email: parsed.data.email,
        timezone: parsed.data.timezone,
        supportEmail: parsed.data.supportEmail || null,
        onboardingStatus: "completed",
        onboardingCompletedAt: new Date(),
      },
    });

    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "vendor_onboarding_completed",
      targetType: "Vendor",
      targetId: auth.vendor.id,
      before: auditSnapshot({
        name: auth.vendor.name,
        slug: auth.vendor.slug,
        email: auth.vendor.email,
        onboardingStatus: auth.vendor.onboardingStatus,
      }),
      after: auditSnapshot({
        name: updated.name,
        slug: updated.slug,
        email: updated.email,
        onboardingStatus: updated.onboardingStatus,
      }),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await writeAuditLog({
        vendorId: auth.vendor.id,
        actorId: auth.user.id,
        actorLabel: auth.member.role,
        action: "vendor_onboarding_update_rejected",
        targetType: "Vendor",
        targetId: auth.vendor.id,
        after: auditSnapshot({ reason: "unavailable" }),
      });
      redirect("/onboarding?error=unavailable");
    }
    throw error;
  }

  redirect("/dashboard?onboarding=completed");
}

export async function deactivateVendorMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const id = text(formData, "id");
  const result = await deactivateWorkspaceMember({ vendorId: auth.vendor.id, actorUserId: auth.user.id, targetMemberId: id });
  if (!result.ok) {
    const error = result.reason === "self_deactivate" || result.reason === "last_owner" ? result.reason : "member_not_found";
    redirect(`/settings/team?error=${error}`);
  }

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "deactivate_vendor_member",
    targetType: "VendorMember",
    targetId: result.member.id,
    before: auditSnapshot(result.before),
    after: auditSnapshot(result.member),
  });

  revalidatePath("/settings/team");
  redirect("/settings/team?updated=member_deactivated");
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
  const auth = await requireAuth();
  const vendor = auth.vendor;
  const id = optionalText(formData, "id");
  if (!vendor || !auth.member || !canManageVideos(auth.member.role)) {
    await writeAuditLog({
      vendorId: vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "video_mutation_rejected",
      targetType: "Video",
      targetId: id,
      after: { reason: "video_manager_required" },
    });
    redirect("/videos?error=video_manager_required");
  }
  await enforceVendorWriteAccess(
    vendor.id,
    id ? "video_update" : "video_create",
    Math.max(1, intValue(formData, "estimatedMinutes")),
  );
  const existing = id ? await getDb().video.findFirst({ where: { id, vendorId: vendor.id } }) : null;
  if (id && !existing) redirect("/videos?error=not_found");
  const title = text(formData, "title");
  const description = optionalText(formData, "description");
  const thumbnailInput = optionalText(formData, "thumbnailUrl");
  const thumbnailUrl = thumbnailInput ? safeCommerceUrlOrNull(thumbnailInput) : null;
  if (thumbnailInput && !thumbnailUrl) {
    redirect(id ? `/videos/${id}/edit?error=unsafe_media_url` : "/videos/new?error=unsafe_media_url");
  }

  let video;
  if (existing && existing.sourceType !== "url") {
    video = await getDb().video.update({
      where: { id: existing.id, vendorId: vendor.id },
      data: { title, description, thumbnailUrl },
    });
  } else {
    const videoUrl = safeCommerceUrlOrNull(text(formData, "videoUrl"));
    if (!videoUrl) {
      redirect(id ? `/videos/${id}/edit?error=unsafe_media_url` : "/videos/new?error=unsafe_media_url");
    }
    const data = {
      title,
      description,
      sourceType: "url",
      videoUrl,
      thumbnailUrl,
      durationSec: Math.max(0, intValue(formData, "durationSec")),
      status: "ready",
      estimatedMinutes: Math.max(0, intValue(formData, "estimatedMinutes")),
    };
    video = existing
      ? await getDb().video.update({ where: { id: existing.id, vendorId: vendor.id }, data })
      : await getDb().video.create({ data: { ...data, vendorId: vendor.id } });
  }

  await writeAuditLog({
    vendorId: vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: existing ? "video_updated" : "video_created",
    targetType: "Video",
    targetId: video.id,
    after: { sourceType: video.sourceType, status: video.status },
  });

  redirect("/videos");
}

export async function upsertProductAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const vendor = auth.vendor;
  const productId = optionalText(formData, "id");
  if (!vendor || !auth.member || !canManageCommerceProducts(auth.member.role)) {
    await writeAuditLog({
      vendorId: vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "product_checkout_update_rejected",
      targetType: "Product",
      targetId: productId,
      after: auditSnapshot({ reason: "commerce_manager_required" }),
    });
    redirect("/products?error=commerce_manager_required");
  }
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
  const id = productId;
  const checkoutInput = productCheckoutSchema.safeParse({
    checkoutMode: text(formData, "checkoutMode", "platform"),
    checkoutUrl: optionalText(formData, "checkoutUrl"),
  });
  if (!checkoutInput.success) {
    redirect("/products?error=invalid_checkout");
  }

  let checkoutSettings: ReturnType<typeof productCheckoutSettings>;
  try {
    checkoutSettings = productCheckoutSettings(checkoutInput.data.checkoutMode, checkoutInput.data.checkoutUrl);
  } catch (error) {
    if (!(error instanceof ExternalStorefrontError)) throw error;
    redirect("/products?error=invalid_checkout");
  }

  const data = {
    name: text(formData, "name"),
    slug: toSlug(text(formData, "slug")),
    description: optionalText(formData, "description"),
    priceCents: intValue(formData, "priceCents"),
    compareAtCents: optionalText(formData, "compareAtCents") ? intValue(formData, "compareAtCents") : null,
    currency: text(formData, "currency", "TWD"),
    imageUrl: optionalText(formData, "imageUrl"),
    ...checkoutSettings,
    inventory: intValue(formData, "inventory"),
    isActive: formData.get("isActive") === "on",
  };

  const before = id
    ? await getDb().product.findFirst({ where: { id, vendorId: vendor.id }, select: { checkoutMode: true, checkoutUrl: true } })
    : null;
  const product = id
    ? await getDb().product.update({ where: { id, vendorId: vendor.id }, data })
    : await getDb().product.create({ data: { ...data, vendorId: vendor.id } });
  await writeAuditLog({
    vendorId: vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: id ? "product_updated" : "product_created",
    targetType: "Product",
    targetId: product.id,
    before: before ? auditSnapshot(before) : null,
    after: auditSnapshot({ checkoutMode: product.checkoutMode, checkoutUrl: product.checkoutUrl }),
  });

  redirect("/products");
}

export async function upsertFormAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  await enforceVendorWriteAccess(vendor.id, id ? "form_update" : "form_create");
  let fields: Prisma.InputJsonValue = [];
  try {
    fields = JSON.parse(text(formData, "fields", "[]")) as Prisma.InputJsonValue;
  } catch {
    fields = [];
  }

  const data = {
    name: text(formData, "name"),
    slug: toSlug(text(formData, "slug")),
    headline: text(formData, "headline"),
    description: optionalText(formData, "description"),
    submitLabel: text(formData, "submitLabel", "送出報名"),
    fields,
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
  const auth = await requireAuth();
  const vendor = auth.vendor;
  const templateId = optionalText(formData, "id");
  if (!vendor || !auth.member || !canManageMessageDelivery(auth.member.role)) {
    await writeAuditLog({
      vendorId: vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "message_template_update_rejected",
      targetType: "MessageTemplate",
      targetId: templateId,
      after: auditSnapshot({ reason: "message_manager_required" }),
    });
    redirect("/messages/templates?error=message_manager_required");
  }
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
  const id = templateId;
  const data = {
    name: text(formData, "name"),
    channel: text(formData, "channel", "email"),
    trigger: text(formData, "trigger", "registration_confirmed"),
    subject: optionalText(formData, "subject"),
    body: text(formData, "body"),
    isActive: formData.get("isActive") === "on",
  };

  const template = id
    ? await getDb().messageTemplate.update({ where: { id, vendorId: vendor.id }, data })
    : await getDb().messageTemplate.create({ data: { ...data, vendorId: vendor.id } });
  await writeAuditLog({
    vendorId: vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: id ? "message_template_updated" : "message_template_created",
    targetType: "MessageTemplate",
    targetId: template.id,
    after: auditSnapshot({ channel: template.channel, trigger: template.trigger, isActive: template.isActive }),
  });

  redirect("/messages/templates");
}

export async function upsertLiveAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const vendor = auth.vendor;
  if (!vendor || !auth.member || !canManageLiveRooms(auth.member.role)) {
    await writeAuditLog({
      vendorId: vendor?.id ?? null,
      actorId: auth.user.id,
      actorLabel: auth.member?.role ?? auth.user.platformRole,
      action: "live_mutation_rejected",
      targetType: "Live",
      targetId: optionalText(formData, "id"),
      after: { reason: "live_manager_required" },
    });
    redirect("/lives?error=live_manager_required");
  }
  const id = optionalText(formData, "id");
  const productIds = formData.getAll("productIds").filter((value): value is string => typeof value === "string");
  const scheduledAtValue = text(formData, "scheduledAt");
  const data = {
    title: text(formData, "title"),
    slug: toSlug(text(formData, "slug")),
    description: optionalText(formData, "description"),
    scheduledAt: scheduledAtValue ? new Date(scheduledAtValue) : new Date(),
    status: text(formData, "status", "scheduled"),
    videoId: optionalText(formData, "videoId"),
    formId: optionalText(formData, "formId"),
    messageTemplateId: optionalText(formData, "messageTemplateId"),
    interactionScriptId: optionalText(formData, "interactionScriptId"),
    heroImageUrl: optionalText(formData, "heroImageUrl"),
    accentCopy: optionalText(formData, "accentCopy"),
    replayEnabled: formData.get("replayEnabled") !== "off",
    streamMode: text(formData, "streamMode", "vod"),
    cloudflareLiveInputUid: optionalText(formData, "cloudflareLiveInputUid"),
    quotaPolicy: {
      maxConcurrentViewers: intValue(formData, "maxConcurrentViewers", 500),
      stopWhenCreditsBelow: intValue(formData, "stopWhenCreditsBelow", 300),
    } as Prisma.InputJsonValue,
  };

  await enforceVendorWriteAccess(vendor.id, id ? "live_update" : "live_create");
  if (["scheduled", "live", "ended"].includes(data.status)) {
    await enforceVendorWriteAccess(vendor.id, "live_publish", 1);
  }

  const db = getDb();
  await assertVendorOwnsRelations(vendor.id, {
    videoIds: [data.videoId],
    formIds: [data.formId],
    messageTemplateIds: [data.messageTemplateId],
    interactionScriptIds: [data.interactionScriptId],
    productIds,
  });
  const selectedVideo = data.videoId
    ? await db.video.findFirst({ where: { id: data.videoId, vendorId: vendor.id }, select: { status: true } })
    : null;
  const publicationIssue = getLivePublicationIssue({
    status: data.status,
    streamMode: data.streamMode,
    videoId: data.videoId,
    videoStatus: selectedVideo?.status ?? null,
    cloudflareLiveInputUid: data.cloudflareLiveInputUid,
  });
  if (publicationIssue) {
    await writeAuditLog({
      vendorId: vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "live_publication_rejected",
      targetType: "Live",
      targetId: id,
      after: { reason: publicationIssue, streamMode: data.streamMode, status: data.status },
    });
    redirect(id
      ? `/lives/${id}/edit?error=${publicationIssue}`
      : `/lives/new?error=${publicationIssue}`);
  }
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
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
  const id = optionalText(formData, "id");
  const data = {
    name: text(formData, "name"),
    avatarUrl: optionalText(formData, "avatarUrl"),
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
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
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
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
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
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
  const id = optionalText(formData, "id");
  const db = getDb();
  const roleIds = formData.getAll("roleId").map(String);
  const eventTypes = formData.getAll("eventType").map(String);
  const triggerSecs = formData.getAll("triggerSec").map((value) => secondsValue(String(value)));
  const titles = formData.getAll("eventTitle").map(String);
  const messages = formData.getAll("message").map(String);
  const productIds = formData.getAll("productId").map(String);
  const ctaLabels = formData.getAll("ctaLabel").map(String);
  const ctaUrls = formData.getAll("ctaUrl").map(String);

  const events = eventTypes
    .map((eventType, index) => ({
      eventType,
      triggerSec: triggerSecs[index] ?? 0,
      title: titles[index]?.trim() || `${eventType} ${index + 1}`,
      message: messages[index]?.trim() || null,
      productId: productIds[index]?.trim() || null,
      ctaLabel: ctaLabels[index]?.trim() || null,
      ctaUrl: normalizeOptionalCommerceUrl(ctaUrls[index]?.trim() || null),
      roleId: roleIds[index]?.trim() || null,
    }))
    .filter((event) => event.eventType && event.title);

  await assertVendorOwnsRelations(vendor.id, {
    productIds: events.map((event) => event.productId),
    interactionRoleIds: events.map((event) => event.roleId),
  });

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

export async function duplicateInteractionScriptAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
  const id = text(formData, "id");
  const script = await getDb().interactionScript.findFirst({
    where: { id, vendorId: vendor.id },
    include: { events: { orderBy: { triggerSec: "asc" } } },
  });
  if (!script) {
    redirect("/interaction-scripts");
  }

  await assertVendorOwnsRelations(vendor.id, {
    productIds: script.events.map((event) => event.productId),
    interactionRoleIds: script.events.map((event) => event.roleId),
  });

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
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
  const id = text(formData, "id");
  await getDb().interactionScript.delete({
    where: { id, vendorId: vendor.id },
  });
  revalidatePath("/interaction-scripts");
  redirect("/interaction-scripts");
}

export async function upsertBlacklistAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
  await getDb().blacklist.create({
    data: {
      vendorId: vendor.id,
      identifier: text(formData, "identifier"),
      identifierType: text(formData, "identifierType", "email"),
      reason: text(formData, "reason"),
      notes: optionalText(formData, "notes"),
    },
  });
  revalidatePath("/blacklists");
}

export async function unblockBlacklistAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendor();
  await enforceVendorWriteAccess(vendor.id, "vendor_write");
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
  const vendor = await requireVendor();
  const id = optionalText(formData, "id");
  await enforceVendorWriteAccess(vendor.id, id ? "affiliate_update" : "affiliate_create");
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

export async function upsertAffiliateProductLinkAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  await enforceVendorWriteAccess(auth.vendor.id, "vendor_write");
  const parsed = affiliateProductLinkSchema.safeParse({
    affiliateId: text(formData, "affiliateId"),
    productId: text(formData, "productId"),
    url: text(formData, "url"),
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) {
    redirect("/affiliates/links?error=invalid_link");
  }

  try {
    await upsertAffiliateProductLink({
      vendorId: auth.vendor.id,
      actorUserId: auth.user.id,
      auditMeta: await requestAuditMeta(),
      ...parsed.data,
    });
  } catch (error) {
    if (!(error instanceof ExternalStorefrontError)) throw error;
    redirect(`/affiliates/links?error=${encodeURIComponent(error.code)}`);
  }

  revalidatePath("/affiliates/links");
  redirect("/affiliates/links?updated=link");
}

export async function submitExternalOrderEvidenceAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  await enforceVendorWriteAccess(auth.vendor.id, "vendor_write");
  const parsed = externalOrderEvidenceSchema.safeParse({
    affiliateId: text(formData, "affiliateId"),
    productId: text(formData, "productId"),
    externalOrderReference: text(formData, "externalOrderReference"),
    amountCents: intValue(formData, "amountCents"),
    currency: text(formData, "currency", "TWD"),
  });
  if (!parsed.success) {
    redirect("/affiliates/external-orders?error=invalid_evidence");
  }

  try {
    await submitExternalOrderEvidence({
      vendorId: auth.vendor.id,
      submittedByUserId: auth.user.id,
      auditMeta: await requestAuditMeta(),
      ...parsed.data,
    });
  } catch (error) {
    if (!(error instanceof ExternalStorefrontError)) throw error;
    redirect(`/affiliates/external-orders?error=${encodeURIComponent(error.code)}`);
  }

  revalidatePath("/affiliates/external-orders");
  redirect("/affiliates/external-orders?updated=evidence");
}

export async function retryNotificationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  await enforceVendorWriteAccess(auth.vendor.id, "vendor_write");
  const outboxId = opaqueIdSchema.safeParse(text(formData, "outboxId"));
  const queued = outboxId.success
    ? await queueNotificationRetry({ vendorId: auth.vendor.id, outboxId: outboxId.data })
    : null;
  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: queued ? "notification_retry_queued" : "notification_retry_rejected",
    targetType: "NotificationOutbox",
    targetId: outboxId.success ? outboxId.data : null,
  });
  revalidatePath("/messages/deliveries");
  redirect(queued ? "/messages/deliveries?updated=retry" : "/messages/deliveries?error=retry_unavailable");
}

export async function upsertCourseAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireCourseManager(optionalText(formData, "id"));
  const parsed = courseSchema.safeParse({
    id: optionalText(formData, "id"),
    title: text(formData, "title"),
    slug: toSlug(text(formData, "slug")),
    description: optionalText(formData, "description"),
    coverImageUrl: optionalText(formData, "coverImageUrl"),
    registrationFormId: optionalText(formData, "registrationFormId"),
    defaultProductId: optionalText(formData, "defaultProductId"),
    status: text(formData, "status", "draft"),
  });
  if (!parsed.success) redirect("/courses?error=invalid_course");
  try {
    const course = await upsertCourse({ vendorId: auth.vendor.id, ...parsed.data });
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: parsed.data.id ? "course_updated" : "course_created",
      targetType: "Course",
      targetId: course.id,
      after: auditSnapshot({ status: course.status, slug: course.slug, registrationFormId: course.registrationFormId, defaultProductId: course.defaultProductId }),
    });
    revalidatePath("/courses");
    revalidatePath(`/course/${course.slug}`);
    redirect(`/courses/${course.id}/edit?updated=course`);
  } catch (error) {
    if (!(error instanceof CourseDomainError) && !(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "course_mutation_rejected",
      targetType: "Course",
      targetId: parsed.data.id,
      after: auditSnapshot({ reason: error instanceof CourseDomainError ? error.code : "conflict" }),
    });
    const destination = parsed.data.id ? `/courses/${parsed.data.id}/edit` : "/courses";
    redirect(`${destination}?error=${error instanceof CourseDomainError ? error.code : "conflict"}`);
  }
}

export async function upsertCourseLessonAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireCourseManager(text(formData, "courseId"));
  const parsed = courseLessonSchema.safeParse({
    id: optionalText(formData, "id"),
    courseId: text(formData, "courseId"),
    videoId: optionalText(formData, "videoId"),
    title: text(formData, "title"),
    description: optionalText(formData, "description"),
    sortOrder: intValue(formData, "sortOrder"),
    status: text(formData, "status", "draft"),
    isPreview: formData.get("isPreview") === "on",
  });
  if (!parsed.success) redirect(`/courses/${encodeURIComponent(text(formData, "courseId"))}/edit?error=invalid_lesson`);
  try {
    const lesson = await upsertCourseLesson({ vendorId: auth.vendor.id, ...parsed.data });
    await writeAuditLog({ vendorId: auth.vendor.id, actorId: auth.user.id, actorLabel: auth.member.role, action: parsed.data.id ? "course_lesson_updated" : "course_lesson_created", targetType: "CourseLesson", targetId: lesson.id, after: auditSnapshot({ courseId: lesson.courseId, videoId: lesson.videoId, status: lesson.status }) });
    revalidatePath(`/courses/${lesson.courseId}/edit`);
    redirect(`/courses/${lesson.courseId}/edit?updated=lesson`);
  } catch (error) {
    if (!(error instanceof CourseDomainError) && !(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    redirect(`/courses/${parsed.data.courseId}/edit?error=${error instanceof CourseDomainError ? error.code : "conflict"}`);
  }
}

export async function upsertCourseSessionAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireCourseManager(text(formData, "courseId"));
  const startsAt = new Date(text(formData, "startsAt"));
  const endsAtValue = optionalText(formData, "endsAt");
  const endsAt = endsAtValue ? new Date(endsAtValue) : null;
  const parsed = courseSessionSchema.safeParse({
    id: optionalText(formData, "id"),
    courseId: text(formData, "courseId"),
    liveId: optionalText(formData, "liveId"),
    title: text(formData, "title"),
    startsAt,
    endsAt,
    status: text(formData, "status", "scheduled"),
    capacity: optionalText(formData, "capacity") ? intValue(formData, "capacity") : null,
  });
  if (!parsed.success) redirect(`/courses/${encodeURIComponent(text(formData, "courseId"))}/edit?error=invalid_session`);
  try {
    const session = await upsertCourseSession({ vendorId: auth.vendor.id, ...parsed.data });
    await writeAuditLog({ vendorId: auth.vendor.id, actorId: auth.user.id, actorLabel: auth.member.role, action: parsed.data.id ? "course_session_updated" : "course_session_created", targetType: "CourseSession", targetId: session.id, after: auditSnapshot({ courseId: session.courseId, liveId: session.liveId, status: session.status, startsAt: session.startsAt.toISOString() }) });
    revalidatePath(`/courses/${session.courseId}/edit`);
    redirect(`/courses/${session.courseId}/edit?updated=session`);
  } catch (error) {
    if (!(error instanceof CourseDomainError) && !(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    redirect(`/courses/${parsed.data.courseId}/edit?error=${error instanceof CourseDomainError ? error.code : "conflict"}`);
  }
}

export async function reviewExternalOrderEvidenceAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requirePlatformAdmin();
  const parsed = externalOrderReviewSchema.safeParse({
    evidenceId: text(formData, "evidenceId"),
    decision: text(formData, "decision"),
    reviewNote: optionalText(formData, "reviewNote"),
  });
  if (!parsed.success) {
    redirect("/admin/billing/external-orders?error=invalid_review");
  }

  try {
    await reviewExternalOrderEvidence({
      reviewedByUserId: auth.user.id,
      auditMeta: await requestAuditMeta(),
      ...parsed.data,
    });
  } catch (error) {
    if (!(error instanceof ExternalStorefrontError)) throw error;
    redirect(`/admin/billing/external-orders?error=${encodeURIComponent(error.code)}`);
  }

  revalidatePath("/admin/billing/external-orders");
  revalidatePath("/affiliates/external-orders");
  revalidatePath("/affiliates/commissions");
  redirect(`/admin/billing/external-orders?updated=${parsed.data.decision}`);
}

export async function generateSettlementAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const vendorId = text(formData, "vendorId");
  const monthKey = text(formData, "monthKey");
  if (!vendorId || !monthKey) {
    redirect("/admin/billing/settlements?error=missing");
  }
  let result;
  try {
    result = await generateSettlementRecord(vendorId, monthKey);
  } catch (error) {
    if (!(error instanceof SettlementOperationError)) throw error;
    redirect(`/admin/billing/settlements?error=${error.code}`);
  }

  await writeAuditLog({
    vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "generate_settlement",
    targetType: "Settlement",
    targetId: result.settlement.id,
    before: auditSnapshot(result.before),
    after: auditSnapshot({ settlement: result.settlement, calculation: result.calculation }),
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
  let result;
  try {
    result = await updateSettlementAdjustmentRecord({ id, adjustmentAmountCents, adjustmentReason, reviewedBy: member.id });
  } catch (error) {
    if (!(error instanceof SettlementOperationError)) throw error;
    redirect(`/admin/billing/settlements?error=${error.code}`);
  }

  await writeAuditLog({
    vendorId: result.settlement.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "update_settlement_adjustment",
    targetType: "Settlement",
    targetId: result.settlement.id,
    before: auditSnapshot(result.before),
    after: auditSnapshot(result.settlement),
  });

  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/settlements");
}

export async function lockSettlementAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  let result;
  try {
    result = await lockSettlementRecord(id, member.id);
  } catch (error) {
    if (!(error instanceof SettlementOperationError)) throw error;
    redirect(`/admin/billing/settlements?error=${error.code}`);
  }

  await writeAuditLog({
    vendorId: result.settlement.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "lock_settlement",
    targetType: "Settlement",
    targetId: result.settlement.id,
    before: auditSnapshot(result.before),
    after: auditSnapshot(result.settlement),
  });

  revalidatePath("/admin/billing/settlements");
  revalidatePath("/billing/settlements");
  redirect("/admin/billing/settlements");
}

export async function createPayoutBatchAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const settlementIds = [...new Set(formData.getAll("settlementIds").filter((value): value is string => typeof value === "string" && value.length > 0))];
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

  if (settlements.length !== settlementIds.length) {
    redirect("/admin/billing/payouts?error=no_locked");
  }

  const payoutAccounts = new Map(settlements.map((settlement) => {
    const account = settlement.vendor.paymentAccounts.find((item) =>
      item.mode === "platform" && item.status === "active" && item.bankAccountName && item.bankCode && item.bankAccountNumber,
    );
    return [settlement.id, account] as const;
  }));
  if ([...payoutAccounts.values()].some((account) => !account)) {
    redirect("/admin/billing/payouts?error=bank_account_required");
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
      const account = payoutAccounts.get(settlement.id)!;
      await tx.payoutItem.create({
        data: {
          payoutBatchId: batch.id,
          vendorId: settlement.vendorId,
          settlementId: settlement.id,
          bankAccountName: account.bankAccountName!,
          bankCode: account.bankCode!,
          bankAccountNumber: account.bankAccountNumber!,
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
  if (!canTransitionPayoutItem(item.status, status)) {
    redirect("/admin/billing/payouts?error=invalid_status");
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
  const db = getDb();
  const transaction = await db.paymentTransaction.findUnique({ where: { id } });
  if (!transaction) {
    redirect("/admin/billing/dashboard?error=refund");
  }
  let refundResult;
  try {
    refundResult = await processManualRefund({
      transactionId: transaction.id,
      refundAmountCents,
      gatewayFeeRefundCents,
      platformFeeRefundCents,
      reason,
      monthKey,
    });
  } catch {
    redirect("/admin/billing/dashboard?error=refund");
  }
  const updated = refundResult.transaction;

  await writeAuditLog({
    vendorId: transaction.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "refund_payment_transaction",
    targetType: "PaymentTransaction",
    targetId: transaction.id,
    before: auditSnapshot(transaction),
    after: auditSnapshot({ transaction: updated, refundCommission: refundResult.refundCommission, eventId: refundResult.eventId }),
  });

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/dashboard");
}

export async function approveAffiliateCommissionAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const before = await getDb().affiliateCommission.findUnique({ where: { id } });
  if (!before) redirect("/admin/billing/affiliate-payouts?error=commission_missing");
  try {
    const updated = await approveAffiliateCommission(id);
    await writeAuditLog({
      vendorId: updated.vendorId,
      actorId: member.id,
      actorLabel: member.role,
      action: "approve_affiliate_commission",
      targetType: "AffiliateCommission",
      targetId: id,
      before: auditSnapshot(before),
      after: auditSnapshot(updated),
    });
  } catch (error) {
    if (!(error instanceof AffiliatePayoutError)) throw error;
    redirect(`/admin/billing/affiliate-payouts?error=${error.code}`);
  }
  revalidatePath("/admin/billing/affiliate-payouts");
  redirect("/admin/billing/affiliate-payouts");
}

export async function createAffiliatePayoutAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const input = {
    vendorId: text(formData, "vendorId"),
    affiliateId: text(formData, "affiliateId"),
    monthKey: text(formData, "monthKey"),
  };
  try {
    const payout = await createAffiliatePayout(input);
    await writeAuditLog({
      vendorId: payout.vendorId,
      actorId: member.id,
      actorLabel: member.role,
      action: "create_affiliate_payout",
      targetType: "AffiliatePayout",
      targetId: payout.id,
      before: auditSnapshot(input),
      after: auditSnapshot(payout),
    });
  } catch (error) {
    if (!(error instanceof AffiliatePayoutError)) throw error;
    redirect(`/admin/billing/affiliate-payouts?error=${error.code}`);
  }
  revalidatePath("/admin/billing/affiliate-payouts");
  revalidatePath("/affiliates/commissions");
  redirect("/admin/billing/affiliate-payouts");
}

export async function transitionAffiliatePayoutAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const nextStatus = z.enum(["approved", "paid", "reversed"]).parse(text(formData, "status"));
  const before = await getDb().affiliatePayout.findUnique({ where: { id } });
  if (!before) redirect("/admin/billing/affiliate-payouts?error=not_found");
  try {
    const updated = await transitionAffiliatePayout(id, nextStatus);
    await writeAuditLog({
      vendorId: updated.vendorId,
      actorId: member.id,
      actorLabel: member.role,
      action: `mark_affiliate_payout_${nextStatus}`,
      targetType: "AffiliatePayout",
      targetId: id,
      before: auditSnapshot(before),
      after: auditSnapshot(updated),
    });
  } catch (error) {
    if (!(error instanceof AffiliatePayoutError)) throw error;
    redirect(`/admin/billing/affiliate-payouts?error=${error.code}`);
  }
  revalidatePath("/admin/billing/affiliate-payouts");
  revalidatePath("/affiliates/commissions");
  redirect("/admin/billing/affiliate-payouts");
}

export async function createManualCommissionAdjustmentAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const input = {
    affiliateId: text(formData, "affiliateId"),
    monthKey: text(formData, "monthKey"),
    amountCents: moneyToCents(formData, "amount"),
    reason: text(formData, "reason").slice(0, 120),
  };
  try {
    const adjustment = await createManualCommissionAdjustment(input);
    await writeAuditLog({
      vendorId: adjustment.vendorId,
      actorId: member.id,
      actorLabel: member.role,
      action: "create_affiliate_commission_adjustment",
      targetType: "AffiliateCommission",
      targetId: adjustment.id,
      before: auditSnapshot({ affiliateId: input.affiliateId, monthKey: input.monthKey }),
      after: auditSnapshot({ adjustment, reason: input.reason }),
    });
  } catch (error) {
    if (!(error instanceof AffiliatePayoutError)) throw error;
    redirect(`/admin/billing/affiliate-payouts?error=${error.code}`);
  }
  revalidatePath("/admin/billing/affiliate-payouts");
  revalidatePath("/affiliates/commissions");
  redirect("/admin/billing/affiliate-payouts");
}

export async function voidAffiliateCommissionAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const reason = optionalText(formData, "reason");
  let result;
  try {
    result = await reverseAffiliateCommission(id);
  } catch (error) {
    if (!(error instanceof AffiliatePayoutError)) throw error;
    redirect(`/admin/billing/dashboard?error=${error.code}`);
  }

  await writeAuditLog({
    vendorId: result.commission.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "void_affiliate_commission",
    targetType: "AffiliateCommission",
    targetId: result.commission.id,
    before: auditSnapshot(result.before),
    after: auditSnapshot({ commission: result.commission, reason }),
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
