import type { PrismaClient } from "@prisma/client";
import { mfaSecretNeedsReencryption, reencryptMfaSecret } from "@/lib/mfa";

export type MfaSecretRotationStore = {
  userMfaFactor: Pick<PrismaClient["userMfaFactor"], "updateMany">;
};

export type MfaSecretRotationResult = "current" | "reencrypted" | "changed";

/**
 * Tier 4 key rotation (B04-03): stores a legacy-format MFA secret under the
 * current key. The write is a compare-and-swap on the exact old ciphertext, so
 * a concurrent re-enrolment or a parallel re-encryption is never overwritten;
 * "changed" means the row no longer held that ciphertext.
 */
export async function reencryptLegacyMfaSecret(
  db: MfaSecretRotationStore,
  factor: { userId: string; secretEncrypted: string },
): Promise<MfaSecretRotationResult> {
  if (!mfaSecretNeedsReencryption(factor.secretEncrypted)) return "current";
  const secretEncrypted = reencryptMfaSecret(factor.secretEncrypted);
  const updated = await db.userMfaFactor.updateMany({
    where: { userId: factor.userId, secretEncrypted: factor.secretEncrypted },
    data: { secretEncrypted },
  });
  return updated.count === 1 ? "reencrypted" : "changed";
}
