import { cookies } from "next/headers";
import { requireAuth, markCurrentSessionMfaVerified } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodeAsync,
  MFA_RECOVERY_COOKIE,
  MFA_SETUP_COOKIE,
  parsePendingMfaSetup,
  serializePendingMfaSetup,
  serializeRecoveryCodes,
  verifyTotpCode,
} from "@/lib/mfa";

function longLivedCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 15,
  };
}

export type MfaEnrollmentStartResult = {
  destination: string;
  updated: "mfa_started" | "mfa_exists";
};

/**
 * Starts MFA enrollment without choosing the caller's navigation transport.
 * Server Actions and native POST routes share the same CSRF, session and
 * cookie state transition so a browser retry cannot change the security rules.
 */
export async function startMfaEnrollment(formData: FormData): Promise<MfaEnrollmentStartResult> {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const destination = auth.isPlatformAdmin ? "/mfa/setup" : "/settings/security";
  if (auth.user.mfaFactor) return { destination, updated: "mfa_exists" };

  const cookieStore = await cookies();
  const secret = generateTotpSecret();
  cookieStore.set(MFA_SETUP_COOKIE, serializePendingMfaSetup(secret, auth.user.id), longLivedCookieOptions());
  cookieStore.delete(MFA_RECOVERY_COOKIE);
  return { destination, updated: "mfa_started" };
}

export type MfaEnrollmentResult =
  | { ok: true; destination: string }
  | { ok: false; destination: string; error: "mfa_code" };

/**
 * Verifies and commits MFA enrollment without deciding how the caller
 * transports the final navigation. Server Actions and the native POST route
 * share this transaction so security and persistence rules stay identical.
 */
export async function completeMfaEnrollment(formData: FormData): Promise<MfaEnrollmentResult> {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const destination = auth.isPlatformAdmin ? "/mfa/setup" : "/settings/security";
  const code = typeof formData.get("code") === "string" ? String(formData.get("code")).trim() : "";
  const cookieStore = await cookies();
  const pending = parsePendingMfaSetup(cookieStore.get(MFA_SETUP_COOKIE)?.value);
  if (!pending || pending.userId !== auth.user.id || !verifyTotpCode(pending.secret, code)) {
    return { ok: false, destination, error: "mfa_code" };
  }

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
  cookieStore.set(MFA_RECOVERY_COOKIE, serializeRecoveryCodes(recoveryCodes), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
  await writeAuditLog({
    vendorId: auth.vendor?.id ?? null,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: "mfa_enabled",
    targetType: "UserMfaFactor",
    targetId: auth.user.id,
    after: auditSnapshot({ factorType: "totp" }),
  });
  return { ok: true, destination };
}

/**
 * Clears the one-time plaintext recovery-code cookie without coupling the
 * security transition to React hydration or a specific navigation transport.
 */
export async function dismissMfaRecoveryCodes(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const cookieStore = await cookies();
  cookieStore.delete(MFA_RECOVERY_COOKIE);
  return { destination: auth.isPlatformAdmin ? "/mfa/verify" : "/settings/security" };
}
