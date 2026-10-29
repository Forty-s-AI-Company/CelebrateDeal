import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { consumeAccountRateLimit } from "@/lib/account-rate-limit";
import {
  accountEmailChangeTokenHash,
  accountEmailChangeUrl,
  accountEmailRevertUrl,
  ACCOUNT_EMAIL_CHANGE_TTL_MINUTES,
  ACCOUNT_EMAIL_REVERT_TTL_DAYS,
  ACCOUNT_EMAIL_REVERT_TTL_MS,
  createAccountEmailChangeToken,
  createAccountEmailRevertToken,
  normalizeLoginEmail,
  readAccountEmailChangeToken,
  readAccountEmailRevertToken,
  verifyAccountEmailChangeToken,
  verifyAccountEmailRevertToken,
} from "@/lib/account-email-change-token";
import { auditSnapshot, requestAuditMeta, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import {
  sendAccountEmailChangeNoticeEmail,
  sendAccountEmailChangeVerificationEmail,
  TransactionalEmailError,
} from "@/lib/email";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";
import { lockLoginEmails, loginEmailReservedForAnother } from "@/lib/login-email-reservation";
import { unusablePasswordHash } from "@/lib/password";

/**
 * Login email change (account settings → 安全性 → 變更登入 Email).
 *
 * 1. Request (signed in, current password, recent MFA for accounts with a
 *    factor or a platform role; see `requestAccountEmailChangeAction`). The
 *    action answers the same "已寄出驗證信" whatever happens next and hands the
 *    rest to `scheduleAccountEmailChangeRequest`, which runs after the
 *    response.
 * 2. `processAccountEmailChangeRequest`: per-(account, address) and
 *    per-address limits, then under a row lock on the user, revoke every open
 *    request of that user and store a new one holding SHA-256 hashes of two
 *    links: the change link, e-mailed to the NEW address only when no other
 *    account uses or reserves it, and the revert link, e-mailed to the
 *    CURRENT address in a masked security notice.
 * 3. `confirmAccountEmailChange`: under the user's row lock and advisory
 *    locks on both addresses, re-checks the request, the account and
 *    uniqueness, then sets `email` and `emailVerifiedAt`, consumes the
 *    request, opens the seven-day revert window (which reserves the previous
 *    address for this user), revokes every session and every unused
 *    password-reset token, and audits, in one transaction.
 * 4. `revertAccountEmailChange` ("不是我操作，還原 Email", no sign-in). Whoever
 *    requested the change knew the password and held a session, so both
 *    modes evict them: every session, unused reset token, pending change,
 *    user LINE Login identity and recovery code ends, and the password stays
 *    unusable until a reset to the account's address.
 *    - Cancel: the change never completed and the account still has the
 *      address the link went to. No change lock, and the MFA factor stays
 *      (the clicker already holds the login mailbox; removing the factor
 *      would hand that mailbox a way past MFA it does not have today).
 *    - Lockdown (any other case): also restores the previous address (and
 *      the founder's `Vendor.email` if it followed), removes an MFA factor
 *      enrolled (or re-enrolled) since the requester's session began, and
 *      blocks self-service changes for seven days.
 *    Either way later revert links are revoked; earlier ones keep working.
 *
 * Enumeration safety: when the new address belongs to (or is reserved for)
 * another account, nothing is sent to it, but a request row is stored all the
 * same (its change link is never mailed), the previous open request is
 * revoked, and the current address gets the same notice with a working
 * revert link. The requester's message, its timing (everything runs after the
 * response), the settings page (which never shows pending requests), their
 * earlier links and the notice therefore look identical either way. A "someone
 * tried" notice to the existing account was rejected: it would let anyone
 * mail arbitrary registered users through the platform and protects nobody
 * (their account does not change). Only the holder of the new mailbox learns
 * that it is taken, by never receiving a link; that holder could learn the
 * same from a password reset.
 */

/**
 * Self-service changes stay blocked this long after a revert that locked the
 * account down (`revertedAt`). A cancel of a change that never completed ends
 * its link with `revertRevokedAt` instead and sets no lock.
 */
export const ACCOUNT_EMAIL_CHANGE_LOCK_DAYS = 7;
const LOCK_MS = ACCOUNT_EMAIL_CHANGE_LOCK_DAYS * 24 * 60 * 60 * 1_000;

export type AccountEmailChangeRequestOutcome =
  | "sent"
  | "target_unavailable"
  | "recipient_rate_limited"
  | "account_changed"
  | "locked"
  | "send_failed";

type RequestInput = {
  userId: string;
  /** The session the request was made from (from `requireAuth`, never the form). */
  sessionId: string;
  /** The account's address when the request was made (from the session, never the form). */
  currentEmail: string;
  /** Already normalized by `normalizeLoginEmail` and different from `currentEmail`. */
  newEmail: string;
  vendorId?: string | null;
  actorLabel?: string | null;
  now?: Date;
};

type Tx = Prisma.TransactionClient;
type RequestReader = Pick<Prisma.TransactionClient, "userEmailChangeRequest">;

const TRANSACTION_OPTIONS = {
  // Same reasoning as password reset: the production pool is small, so let a
  // second operation on the same user wait for the row lock instead of
  // failing with Prisma's default two-second admission timeout.
  maxWait: 5_000,
  timeout: 10_000,
} as const;

/** Serializes every request, confirmation, revert and reset-token write for one user. */
async function lockUser(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  return rows.length === 1;
}

function revokeOpenRequests(tx: Tx, userId: string, now: Date) {
  return tx.userEmailChangeRequest.updateMany({
    where: { userId, consumedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** When the seven-day lock after a used revert ends, or null when there is none. */
export async function accountEmailChangeLockedUntil(db: RequestReader, userId: string, now = new Date()) {
  const latest = await db.userEmailChangeRequest.findFirst({
    where: { userId, revertedAt: { gt: new Date(now.getTime() - LOCK_MS) } },
    orderBy: { revertedAt: "desc" },
    select: { revertedAt: true },
  });
  return latest?.revertedAt ? new Date(latest.revertedAt.getTime() + LOCK_MS) : null;
}

/** Deadlocks, serialization failures and transaction timeouts: nothing was written, try again. */
export function isTransientTransactionError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034" || error.code === "P2028") return true;
    const code = (error.meta as { code?: unknown } | undefined)?.code;
    if (code === "40P01" || code === "40001") return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /\b40P01\b|\b40001\b|deadlock detected|could not serialize access/u.test(message);
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type StoredRow = { revoked: number; requestId: string; token: string; jti: string; revertToken: string; expiresAt: Date };
type StoredRequest =
  | { kind: "account_changed" }
  | { kind: "locked" }
  | ({ kind: "created" } & StoredRow)
  | ({ kind: "target_unavailable" } & StoredRow);

/**
 * Stores the request and sends both mails. Runs after the action's response;
 * never throws. Every input comes from the authenticated session or the
 * already validated form, never from another lookup the client controls.
 */
export async function processAccountEmailChangeRequest(input: RequestInput): Promise<{ outcome: AccountEmailChangeRequestOutcome }> {
  const now = input.now ?? new Date();
  const audit = (action: string, after: Record<string, unknown>) => writeAuditLog({
    vendorId: input.vendorId ?? null,
    actorId: input.userId,
    actorLabel: input.actorLabel ?? "system",
    action,
    targetType: "User",
    targetId: input.userId,
    after: auditSnapshot(after),
  }).catch(() => undefined);

  if (normalizeLoginEmail(input.newEmail) !== input.newEmail || input.newEmail === input.currentEmail) {
    return { outcome: "account_changed" };
  }

  try {
    // Both keys ignore whether (and to whom) the address belongs.
    const pair = await consumeAccountRateLimit("account_email_change_pair", `${input.userId}\u0000${input.newEmail}`);
    const recipient = pair.allowed ? await consumeAccountRateLimit("account_email_change_recipient", input.newEmail) : null;
    if (!pair.allowed || !recipient?.allowed) {
      await audit("account_email_change_suppressed", { reason: pair.allowed ? "recipient_rate_limited" : "pair_rate_limited" });
      return { outcome: "recipient_rate_limited" };
    }

    const stored = await getDb().$transaction(async (tx): Promise<StoredRequest> => {
      if (!await lockUser(tx, input.userId)) return { kind: "account_changed" };
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { email: true, status: true } });
      // The account changed since the request (suspended, or its address moved on).
      if (!user || user.status !== "active" || user.email !== input.currentEmail) return { kind: "account_changed" };
      // The requesting session, bound to this user: a revert later evicts
      // factors enrolled since it began. Ended meanwhile (logout, password
      // change, another revert): store nothing.
      const session = await tx.userSession.findFirst({
        where: { id: input.sessionId, userId: input.userId, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true, createdAt: true },
      });
      if (!session) return { kind: "account_changed" };
      if (await accountEmailChangeLockedUntil(tx, input.userId, now)) return { kind: "locked" };
      const revoked = (await revokeOpenRequests(tx, input.userId, now)).count;
      const taken = Boolean(await tx.user.findUnique({ where: { email: input.newEmail }, select: { id: true } }))
        || await loginEmailReservedForAnother(tx, input.newEmail, input.userId, now);
      // A taken address still gets a row (its change link is never mailed) so
      // the notice's revert link and the superseded links behave the same.
      const link = createAccountEmailChangeToken({ userId: input.userId, newEmail: input.newEmail, now });
      const revert = createAccountEmailRevertToken({ userId: input.userId, previousEmail: input.currentEmail, now });
      const request = await tx.userEmailChangeRequest.create({
        data: {
          userId: input.userId,
          previousEmail: input.currentEmail,
          newEmail: input.newEmail,
          tokenHash: link.tokenHash,
          expiresAt: link.expiresAt,
          // Until the change completes, the revert link only cancels it.
          revertTokenHash: revert.tokenHash,
          revertExpiresAt: link.expiresAt,
          initiatingSessionId: session.id,
          initiatingSessionCreatedAt: session.createdAt,
          createdAt: now,
        },
        select: { id: true },
      });
      const row: StoredRow = { revoked, requestId: request.id, token: link.token, jti: link.jti, revertToken: revert.token, expiresAt: link.expiresAt };
      return taken ? { kind: "target_unavailable", ...row } : { kind: "created", ...row };
    }, TRANSACTION_OPTIONS);

    if (stored.kind === "account_changed" || stored.kind === "locked") {
      await audit("account_email_change_suppressed", { reason: stored.kind });
      return { outcome: stored.kind };
    }

    let outcome: AccountEmailChangeRequestOutcome = "target_unavailable";
    if (stored.kind === "created") {
      try {
        await sendAccountEmailChangeVerificationEmail({
          to: input.newEmail,
          maskedCurrentEmail: maskEmailRecipient(input.currentEmail),
          confirmUrl: accountEmailChangeUrl(stored.token),
          validMinutes: ACCOUNT_EMAIL_CHANGE_TTL_MINUTES,
          idempotencyKey: `account-email-change:${stored.jti}`,
        });
        outcome = "sent";
      } catch (error) {
        // Never leave a usable link the recipient did not get; no notice goes out either.
        const revokedAt = new Date();
        await getDb().userEmailChangeRequest.updateMany({
          where: { id: stored.requestId, consumedAt: null, revokedAt: null },
          data: { revokedAt, revertRevokedAt: revokedAt },
        }).catch(() => undefined);
        await audit("account_email_change_email_failed", {
          requestId: stored.requestId,
          jti: stored.jti,
          errorCode: error instanceof TransactionalEmailError ? error.code : "unknown",
        });
        return { outcome: "send_failed" };
      }
    }

    // The old address hears about every stored request, taken target or not.
    let noticeSent = true;
    try {
      await sendAccountEmailChangeNoticeEmail({
        to: input.currentEmail,
        maskedNewEmail: maskEmailRecipient(input.newEmail),
        revertUrl: accountEmailRevertUrl(stored.revertToken),
        revertValidDays: ACCOUNT_EMAIL_REVERT_TTL_DAYS,
        idempotencyKey: `account-email-change-notice:${stored.jti}`,
      });
    } catch {
      noticeSent = false;
    }

    // The audit row never holds an address, a token or a link. Audit logs
    // are only shown to platform administrators.
    await audit("account_email_change_requested", {
      outcome,
      requestId: stored.requestId,
      jti: stored.jti,
      expiresAt: stored.expiresAt.toISOString(),
      supersededRequests: stored.revoked,
      noticeSent,
    });
    return { outcome };
  } catch {
    // Rate-limit counter, database or provider unavailable: nothing usable was left behind.
    return { outcome: "send_failed" };
  }
}

/** Processes the request after the response, so its outcome cannot be timed. */
export function scheduleAccountEmailChangeRequest(input: Omit<RequestInput, "now">) {
  after(async () => {
    await processAccountEmailChangeRequest(input);
  });
}

/**
 * What the confirm page may show before the click: the masked current
 * address of the account the link belongs to, so someone who does not
 * recognize it does not confirm. Read-only; null for any link that the
 * confirmation would refuse right now.
 */
export async function describeAccountEmailChangeLink(token: unknown, now = new Date()) {
  const candidate = readAccountEmailChangeToken(token, now);
  if (!candidate || typeof token !== "string") return null;
  const request = await getDb().userEmailChangeRequest.findUnique({
    where: { tokenHash: accountEmailChangeTokenHash(token) },
    select: { userId: true, previousEmail: true, newEmail: true, consumedAt: true, revokedAt: true, expiresAt: true, user: { select: { email: true, status: true } } },
  });
  if (!request || request.userId !== candidate.userId || request.consumedAt || request.revokedAt || request.expiresAt <= now) return null;
  if (request.user.status !== "active" || request.user.email !== request.previousEmail) return null;
  if (!verifyAccountEmailChangeToken(token, request.newEmail, now)) return null;
  return { maskedCurrentEmail: maskEmailRecipient(request.previousEmail) };
}

export type AccountEmailChangeConfirmation = { status: "changed" | "invalid" | "email_taken" | "retry" };

/** Thrown inside the confirmation transaction to roll it back. */
class ConfirmRollback extends Error {}

/**
 * Completes a change from its link. Works signed out or while another account
 * is signed in, and never signs anyone in: the token alone names the request,
 * and every write is bound to the user that request belongs to.
 */
export async function confirmAccountEmailChange(token: unknown, now = new Date()): Promise<AccountEmailChangeConfirmation> {
  const candidate = readAccountEmailChangeToken(token, now);
  if (!candidate || typeof token !== "string") return { status: "invalid" };
  const tokenHash = accountEmailChangeTokenHash(token);
  const meta = await requestAuditMeta();
  try {
    return await getDb().$transaction(async (tx): Promise<AccountEmailChangeConfirmation> => {
      const request = await tx.userEmailChangeRequest.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, previousEmail: true, newEmail: true },
      });
      // The token's user must own the row its hash found, and the MAC must bind the stored address.
      if (!request || request.userId !== candidate.userId) return { status: "invalid" };
      const claim = verifyAccountEmailChangeToken(token, request.newEmail, now);
      if (!claim) return { status: "invalid" };

      if (!await lockUser(tx, request.userId)) return { status: "invalid" };
      const user = await tx.user.findUnique({ where: { id: request.userId }, select: { email: true, status: true } });
      // The request was made from the address the account still has.
      if (!user || user.status !== "active" || user.email !== request.previousEmail) return { status: "invalid" };
      await lockLoginEmails(tx, [user.email, request.newEmail]);
      // Re-read under the locks: a concurrent request, revert or password change may have revoked it.
      const open = await tx.userEmailChangeRequest.findFirst({
        where: { id: request.id, userId: request.userId, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!open) return { status: "invalid" };

      const taken = Boolean(await tx.user.findFirst({ where: { email: request.newEmail, id: { not: request.userId } }, select: { id: true } }))
        || await loginEmailReservedForAnother(tx, request.newEmail, request.userId, now);
      if (taken) {
        // The address was claimed (or reserved) after the request: this link can never succeed.
        await tx.userEmailChangeRequest.updateMany({ where: { id: request.id, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
        return { status: "email_taken" };
      }

      // Keep the founding account bound to its workspace (registration gives
      // Vendor and User the same address and vendorEmailVerificationState
      // matches on it), but only while this user is still an active owner of
      // it and no other workspace already uses the new address.
      const founded = await tx.vendor.findFirst({
        where: { email: user.email, members: { some: { userId: request.userId, status: "active", role: "owner" } } },
        select: { id: true },
      });
      const syncVendor = Boolean(founded) && !await tx.vendor.findUnique({ where: { email: request.newEmail }, select: { id: true } });

      const consumed = await tx.userEmailChangeRequest.updateMany({
        where: { id: request.id, userId: request.userId, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        // Opens the revert window, which reserves the previous address for this user.
        data: { consumedAt: now, revertExpiresAt: new Date(now.getTime() + ACCOUNT_EMAIL_REVERT_TTL_MS), syncedVendorId: syncVendor ? founded!.id : null },
      });
      if (consumed.count !== 1) return { status: "invalid" };

      // Bound to the id and the address read under the lock. A unique
      // violation here rolls everything back and reports email_taken.
      const updated = await tx.user.updateMany({
        where: { id: request.userId, email: user.email, status: "active" },
        data: { email: request.newEmail, emailVerifiedAt: now },
      });
      if (updated.count !== 1) throw new ConfirmRollback();
      if (syncVendor) await tx.vendor.update({ where: { id: founded!.id }, data: { email: request.newEmail } });

      // Mirror password reset: the change may come from any browser, so every session ends.
      const sessions = await tx.userSession.updateMany({ where: { userId: request.userId, revokedAt: null }, data: { revokedAt: now } });
      // Reset tokens went to the old address; completing one must not verify the new one.
      const resetTokens = await tx.passwordResetToken.updateMany({ where: { userId: request.userId, usedAt: null }, data: { usedAt: now } });
      await revokeOpenRequests(tx, request.userId, now);

      await tx.auditLog.create({
        data: {
          vendorId: founded?.id ?? null,
          actorId: request.userId,
          actorLabel: "account_email_change",
          action: "account_email_changed",
          targetType: "User",
          targetId: request.userId,
          after: auditSnapshot({
            requestId: request.id,
            jti: claim.jti,
            sessionsRevoked: sessions.count,
            resetLinksRevoked: resetTokens.count,
            founderVendorUpdated: syncVendor,
          }),
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });
      return { status: "changed" };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "email_taken" };
    if (error instanceof ConfirmRollback) return { status: "invalid" };
    if (isTransientTransactionError(error)) return { status: "retry" };
    throw error;
  }
}

/**
 * What the revert page may show before the click: whether pressing it will
 * cancel a pending change or restore the previous address. Read-only; null
 * for any link the revert would refuse right now.
 */
export async function describeAccountEmailRevertLink(token: unknown, now = new Date()) {
  const candidate = readAccountEmailRevertToken(token, now);
  if (!candidate || typeof token !== "string") return null;
  const row = await getDb().userEmailChangeRequest.findUnique({
    where: { revertTokenHash: accountEmailChangeTokenHash(token) },
    select: { userId: true, previousEmail: true, consumedAt: true, revertedAt: true, revertRevokedAt: true, revertExpiresAt: true, user: { select: { email: true } } },
  });
  if (!row || row.userId !== candidate.userId || row.revertedAt || row.revertRevokedAt || row.revertExpiresAt <= now) return null;
  if (!verifyAccountEmailRevertToken(token, row.previousEmail, now)) return null;
  return { mode: isCancel(row.consumedAt, row.user.email, row.previousEmail) ? "cancel" as const : "restore" as const };
}

/**
 * A revert only cancels when the change never completed and the account
 * still has the address the link went to: whoever clicks already holds the
 * login mailbox, so there is nobody to evict. Anything else (the change
 * completed, or a later change moved the account away) locks it down.
 */
function isCancel(consumedAt: Date | null, currentEmail: string, previousEmail: string) {
  return consumedAt === null && currentEmail === previousEmail;
}

export type AccountEmailRevertResult = { status: "reverted" | "cancelled" | "invalid" | "conflict" | "retry" };

/**
 * "不是我操作，還原 Email". The link went to the address the account had when
 * the change was requested. Works signed out and never signs anyone in.
 */
export async function revertAccountEmailChange(token: unknown, now = new Date()): Promise<AccountEmailRevertResult> {
  const candidate = readAccountEmailRevertToken(token, now);
  if (!candidate || typeof token !== "string") return { status: "invalid" };
  const revertTokenHash = accountEmailChangeTokenHash(token);
  const meta = await requestAuditMeta();
  try {
    return await getDb().$transaction(async (tx): Promise<AccountEmailRevertResult> => {
      const row = await tx.userEmailChangeRequest.findUnique({
        where: { revertTokenHash },
        select: { id: true, userId: true, previousEmail: true, createdAt: true, initiatingSessionCreatedAt: true },
      });
      if (!row || row.userId !== candidate.userId) return { status: "invalid" };
      const claim = verifyAccountEmailRevertToken(token, row.previousEmail, now);
      if (!claim) return { status: "invalid" };

      if (!await lockUser(tx, row.userId)) return { status: "invalid" };
      const user = await tx.user.findUnique({ where: { id: row.userId }, select: { email: true } });
      if (!user) return { status: "invalid" };
      await lockLoginEmails(tx, [user.email, row.previousEmail]);
      // Re-read under the locks: a concurrent confirmation may have completed the change.
      const open = await tx.userEmailChangeRequest.findFirst({
        where: { id: row.id, userId: row.userId, revertedAt: null, revertRevokedAt: null, revertExpiresAt: { gt: now } },
        select: { id: true, consumedAt: true },
      });
      if (!open) return { status: "invalid" };

      // Single use either way. Later revert links (changes made after this
      // one, e.g. by whoever took over) stop working; earlier ones keep
      // working, so a later revert can never lock out the original owner.
      const revokeLaterRevertLinks = () => tx.userEmailChangeRequest.updateMany({
        where: { userId: row.userId, id: { not: row.id }, createdAt: { gte: row.createdAt }, revertedAt: null, revertRevokedAt: null },
        data: { revertRevokedAt: now },
      });
      const cancel = isCancel(open.consumedAt, user.email, row.previousEmail);

      // Both modes: whoever requested the change knew the password and held a
      // session. Every session, unused reset token, pending change and user
      // LINE Login identity (which signs in without a password) ends.
      const sessions = await tx.userSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      const resetTokens = await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
      const pending = await revokeOpenRequests(tx, row.userId, now);
      const lineIdentities = await revokeUserLineIdentities(tx, row.userId, now);

      const restore = !cancel && user.email !== row.previousEmail;
      let vendorRestored = false;
      if (restore) {
        const taken = Boolean(await tx.user.findFirst({ where: { email: row.previousEmail, id: { not: row.userId } }, select: { id: true } }))
          || await loginEmailReservedForAnother(tx, row.previousEmail, row.userId, now);
        if (taken) {
          // Should not happen while the reservation holds; support resolves it. The link stays usable.
          await tx.auditLog.create({
            data: revertAudit(row, claim.jti, meta, "account_email_revert_conflict", {
              sessionsRevoked: sessions.count,
              pendingCancelled: pending.count,
              lineIdentitiesRevoked: lineIdentities.count,
            }),
          });
          return { status: "conflict" };
        }
        const restored = await tx.user.updateMany({ where: { id: row.userId, email: user.email }, data: { email: row.previousEmail, emailVerifiedAt: now } });
        if (restored.count !== 1) throw new RevertRollback();
        // Undo the founder's Vendor.email sync of this change or a later one, if the workspace still follows the account.
        const synced = await tx.userEmailChangeRequest.findMany({
          where: { userId: row.userId, createdAt: { gte: row.createdAt }, consumedAt: { not: null }, syncedVendorId: { not: null } },
          select: { syncedVendorId: true },
        });
        const vendorIds = synced.map((entry) => entry.syncedVendorId).filter((id): id is string => Boolean(id));
        if (vendorIds.length > 0 && !await tx.vendor.findUnique({ where: { email: row.previousEmail }, select: { id: true } })) {
          const moved = await tx.vendor.updateMany({ where: { id: { in: vendorIds }, email: user.email }, data: { email: row.previousEmail } });
          vendorRestored = moved.count > 0;
        }
      }

      const evicted = await evictCredentials(tx, row, { removeLaterFactor: !cancel });

      // A cancel ends the link with `revertRevokedAt`, so it sets no change lock.
      const ended = await tx.userEmailChangeRequest.updateMany({
        where: { id: row.id, userId: row.userId, revertedAt: null, revertRevokedAt: null },
        data: cancel ? { revertRevokedAt: now } : { revertedAt: now },
      });
      if (ended.count !== 1) throw new RevertRollback();
      const laterLinks = await revokeLaterRevertLinks();
      if (evicted.factor) {
        await tx.auditLog.create({
          data: {
            ...revertAudit(row, claim.jti, meta, "account_email_revert_mfa_removed", {
              factorType: evicted.factor.factorType,
              factorEnabledAt: evicted.factor.enabledAt.toISOString(),
              factorCutoff: evicted.cutoff.toISOString(),
              cutoffSource: evicted.cutoffSource,
            }),
            targetType: "UserMfaFactor",
          },
        });
      }
      const evictedDetails = {
        sessionsRevoked: sessions.count,
        resetLinksRevoked: resetTokens.count,
        pendingCancelled: pending.count,
        laterRevertLinksRevoked: laterLinks.count,
        lineIdentitiesRevoked: lineIdentities.count,
        loginCredentialDisabled: true,
        recoveryCodesRemoved: evicted.recoveryCodesRemoved,
      };
      if (cancel) {
        await tx.auditLog.create({ data: revertAudit(row, claim.jti, meta, "account_email_change_cancelled_by_owner", evictedDetails) });
        return { status: "cancelled" };
      }
      await tx.auditLog.create({
        data: revertAudit(row, claim.jti, meta, "account_email_change_reverted", {
          ...evictedDetails,
          previousRestored: restore,
          vendorRestored,
          mfaFactorRemoved: Boolean(evicted.factor),
          changeLockedUntil: new Date(now.getTime() + LOCK_MS).toISOString(),
        }),
      });
      return { status: "reverted" };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "conflict" };
    if (error instanceof RevertRollback) return { status: "invalid" };
    if (isTransientTransactionError(error)) return { status: "retry" };
    throw error;
  }
}

/** Thrown inside the revert transaction to roll it back. */
class RevertRollback extends Error {}

/**
 * Rows created before `initiatingSessionCreatedAt` existed (migration
 * 20261030200000_user_email_change_initiating_session) have no session time. For them the factor cutoff falls
 * back to this long before the request: a sign-in that enrolled a factor and
 * then requested the change within a day is covered; a factor enrolled
 * earlier is treated as the owner's.
 */
export const ACCOUNT_EMAIL_REVERT_LEGACY_FACTOR_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * Factors enabled at or after this instant are treated as the requester's:
 * the earlier of the requesting session's start and the request itself, so
 * signing in, enrolling a factor and only then requesting the change does
 * not keep that factor.
 */
export function accountEmailRevertFactorCutoff(row: { createdAt: Date; initiatingSessionCreatedAt: Date | null }) {
  if (!row.initiatingSessionCreatedAt) {
    return { cutoff: new Date(row.createdAt.getTime() - ACCOUNT_EMAIL_REVERT_LEGACY_FACTOR_WINDOW_MS), source: "legacy_window" as const };
  }
  const session = row.initiatingSessionCreatedAt.getTime();
  return { cutoff: new Date(Math.min(session, row.createdAt.getTime())), source: "initiating_session" as const };
}

/** Ends the account's LINE Login identities (`subjectType: "user"`) in every workspace. */
function revokeUserLineIdentities(tx: Tx, userId: string, now: Date) {
  return tx.lineUserIdentity.updateMany({
    where: { subjectType: "user", subjectId: userId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/**
 * Part of every revert, under the user's row lock. Whoever requested the
 * change may know the password and may hold recovery codes or their own
 * factor, so:
 *
 * - The password stops working (`unusablePasswordHash`). The owner sets a new
 *   one through password reset, whose link goes to the account's address (a
 *   reset replaces `passwordHash` like any other).
 * - Every recovery code is removed; the owner regenerates them after signing
 *   in with the factor (or enrols again).
 * - On a lockdown (`removeLaterFactor`), the MFA factor is removed when it
 *   was enrolled, or re-enrolled with a new secret, at or after the cutoff
 *   (`accountEmailRevertFactorCutoff`; `enabledAt`, which re-enrolment
 *   refreshes, or `createdAt`). An older factor is the owner's and stays. A
 *   cancel keeps the factor: its clicker already holds the login mailbox and
 *   must not gain a way past MFA.
 *
 * A factor enrolled before the cutoff cannot be told apart from the owner's
 * own and is kept; that case needs support.
 */
async function evictCredentials(
  tx: Tx,
  row: { userId: string; createdAt: Date; initiatingSessionCreatedAt: Date | null },
  options: { removeLaterFactor: boolean },
) {
  await tx.user.update({
    where: { id: row.userId },
    data: { passwordHash: unusablePasswordHash("account_email_revert") },
  });
  const { cutoff, source } = accountEmailRevertFactorCutoff(row);
  let factor: { id: string; factorType: string; enabledAt: Date } | null = null;
  if (options.removeLaterFactor) {
    const later = await tx.userMfaFactor.findFirst({
      where: { userId: row.userId, OR: [{ enabledAt: { gte: cutoff } }, { createdAt: { gte: cutoff } }] },
      select: { id: true, factorType: true, enabledAt: true },
    });
    if (later && (await tx.userMfaFactor.deleteMany({ where: { id: later.id, userId: row.userId } })).count === 1) factor = later;
  }
  const codes = await tx.userRecoveryCode.deleteMany({ where: { userId: row.userId } });
  return { factor, cutoff, cutoffSource: source, recoveryCodesRemoved: codes.count };
}
function revertAudit(
  row: { id: string; userId: string },
  jti: string,
  meta: { ipAddress: string | null | undefined; userAgent: string | null | undefined },
  action: string,
  details: Record<string, unknown>,
) {
  return {
    actorId: row.userId,
    actorLabel: "account_email_revert",
    action,
    targetType: "User",
    targetId: row.userId,
    after: auditSnapshot({ requestId: row.id, jti, ...details }),
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  };
}
