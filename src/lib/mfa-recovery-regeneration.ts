import { cookies, headers } from "next/headers";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { requireAuth } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCodeAsync,
  MFA_RECOVERY_COOKIE,
  serializeRecoveryCodes,
  verifyTotpCode,
} from "@/lib/mfa";
import { checkRateLimit } from "@/lib/rate-limit";

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function forwardedRequestHeaders(headerStore: Awaited<ReturnType<typeof headers>>) {
  const forwarded = new Headers();
  for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "user-agent"]) {
    const value = headerStore.get(name);
    if (value) forwarded.set(name, value);
  }
  return forwarded;
}

export type MfaRecoveryRegenerationResult =
  | { ok: true; destination: string }
  | {
    ok: false;
    destination: string;
    error: "mfa_required" | "recovery_rate_limited" | "recovery_unavailable" | "mfa_code";
  };

/**
 * Performs the complete recovery-code replacement independently from a
 * navigation transport. Server Actions and native same-origin POST routes
 * therefore share every security and persistence decision.
 */
export async function regenerateMfaRecoveryCodes(
  formData: FormData,
): Promise<MfaRecoveryRegenerationResult> {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth();
  const destination = auth.isPlatformAdmin ? "/mfa/setup" : "/settings/security";
  if (!auth.user.mfaFactor) return { ok: false, destination, error: "mfa_required" };

  const headerStore = await headers();
  const rateLimited = await checkRateLimit(
    new Request(getCanonicalAppUrl(), { headers: forwardedRequestHeaders(headerStore) }),
    `mfa-recovery-regeneration:${auth.user.id}`,
    3,
    15 * 60 * 1000,
  );
  if (rateLimited) {
    return {
      ok: false,
      destination,
      error: rateLimited.status === 429 ? "recovery_rate_limited" : "recovery_unavailable",
    };
  }

  const code = formText(formData, "code");
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
    return { ok: false, destination, error: "mfa_code" };
  }

  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = await Promise.all(recoveryCodes.map(hashRecoveryCodeAsync));
  await getDb().$transaction([
    getDb().userRecoveryCode.deleteMany({ where: { userId: auth.user.id } }),
    getDb().userRecoveryCode.createMany({
      data: recoveryCodes.map((codeValue, index) => ({ userId: auth.user.id, codeHash: recoveryCodeHashes[index]! })),
    }),
    getDb().userMfaFactor.update({ where: { userId: auth.user.id }, data: { lastUsedAt: new Date() } }),
  ]);

  const cookieStore = await cookies();
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
    action: "mfa_recovery_codes_regenerated",
    targetType: "UserRecoveryCode",
    targetId: auth.user.id,
    after: auditSnapshot({ codeCount: recoveryCodes.length }),
  });
  return { ok: true, destination };
}
