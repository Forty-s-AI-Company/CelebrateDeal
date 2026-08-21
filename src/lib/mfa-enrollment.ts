import { cookies } from "next/headers";
import { requireAuth, markCurrentSessionMfaVerified } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCodeAsync,
  MFA_RECOVERY_COOKIE,
  MFA_SETUP_COOKIE,
  parsePendingMfaSetup,
  serializeRecoveryCodes,
  verifyTotpCode,
} from "@/lib/mfa";

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
