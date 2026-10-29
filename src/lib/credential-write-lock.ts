import type { Prisma } from "@prisma/client";

/**
 * Serializes signed-in credential writes (MFA enrolment, recovery-code
 * regeneration) with the login email change revert, which takes the same
 * `User` row lock, removes later factors and recovery codes, and ends every
 * session. Without the lock a write that passed `requireAuth` before the
 * revert could land after it and leave the requester's factor in place.
 */

/** Same reasoning as password reset: wait for the row lock instead of failing fast on a small pool. */
export const CREDENTIAL_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

type Tx = Pick<Prisma.TransactionClient, "$queryRaw" | "userSession">;

/**
 * Locks the user's row `FOR UPDATE` and re-checks, under that lock, that the
 * account is active and the acting session (bound to this user) is neither
 * revoked nor expired. False means the caller must write nothing.
 */
export async function lockUserForCredentialWrite(tx: Tx, userId: string, sessionId: string, now = new Date()) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${userId} AND "status" = 'active' FOR UPDATE`;
  if (rows.length !== 1) return false;
  const session = await tx.userSession.findFirst({
    where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  });
  return Boolean(session);
}
