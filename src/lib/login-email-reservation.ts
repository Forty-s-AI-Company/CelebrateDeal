import type { Prisma } from "@prisma/client";

/**
 * Login addresses that are spoken for even though no `User.email` holds them.
 *
 * After a completed login email change, the previous address stays reserved
 * for its owner while the revert link ("不是我操作，還原 Email") is usable, so
 * nobody can register, accept an invitation as a new account, or change their
 * own login to that address and thereby block the restore. Every path that
 * puts an address into `User.email` treats a reserved address exactly like an
 * address another account already uses, so the answer reveals nothing new.
 *
 * Writers take a transaction-scoped advisory lock per address
 * (`lockLoginEmails`) before checking, so a check and the competing write
 * (a confirmation freeing the address, a revert taking it back) cannot
 * interleave. Locks are taken in sorted order to avoid deadlocks.
 */

type Tx = Pick<Prisma.TransactionClient, "$executeRaw" | "userEmailChangeRequest">;

const LOCK_NAMESPACE = "celebratedeal:login-email:v1:";

/** Serializes writers of these addresses until the surrounding transaction ends. */
export async function lockLoginEmails(tx: Tx, emails: readonly string[]) {
  for (const email of [...new Set(emails)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_NAMESPACE + email}, 0))`;
  }
}

/** Whether `email` is reserved for a user other than `exceptUserId`. */
export async function loginEmailReservedForAnother(tx: Tx, email: string, exceptUserId: string | null, now = new Date()) {
  const reservation = await tx.userEmailChangeRequest.findFirst({
    where: {
      previousEmail: email,
      consumedAt: { not: null },
      revertedAt: null,
      revertRevokedAt: null,
      revertExpiresAt: { gt: now },
      ...(exceptUserId ? { userId: { not: exceptUserId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(reservation);
}

/** Thrown inside a creating transaction when the address is reserved; callers map it like a unique violation. */
export class LoginEmailReservedError extends Error {
  constructor() {
    super("Login email is reserved.");
    this.name = "LoginEmailReservedError";
  }
}

/**
 * For paths that create a new account with `email` (registration, accepting
 * an invitation as a new user): locks the address and throws
 * `LoginEmailReservedError` when it is reserved. The unique index on
 * `User.email` still covers addresses an account already holds.
 */
export async function assertLoginEmailAvailableForNewAccount(tx: Tx, email: string, now = new Date()) {
  await lockLoginEmails(tx, [email]);
  if (await loginEmailReservedForAnother(tx, email, null, now)) throw new LoginEmailReservedError();
}
