import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { consumeAccountRateLimit } from "@/lib/account-rate-limit";
import {
  accountEmailChangeTokenHash,
  accountEmailChangeUrl,
  ACCOUNT_EMAIL_CHANGE_TTL_MINUTES,
  createAccountEmailChangeToken,
  normalizeLoginEmail,
  readAccountEmailChangeToken,
  verifyAccountEmailChangeToken,
} from "@/lib/account-email-change-token";
import { auditSnapshot, requestAuditMeta, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import {
  sendAccountEmailChangeNoticeEmail,
  sendAccountEmailChangeVerificationEmail,
  TransactionalEmailError,
} from "@/lib/email";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";

/**
 * Login email change (account settings → 安全性 → 變更登入 Email).
 *
 * 1. Request (signed in, current password, recent MFA when a factor exists;
 *    see `requestAccountEmailChangeAction`). The action answers the same
 *    "已寄出驗證信" whatever happens next and hands the rest to
 *    `scheduleAccountEmailChangeRequest`, which runs after the response.
 * 2. `processAccountEmailChangeRequest`: per-recipient limit, then under a
 *    row lock on the user, revoke every open request of that user and, only
 *    when no account uses the new address, store a new one (SHA-256 of the
 *    signed link) and e-mail the link to the NEW address. The CURRENT address
 *    always gets a masked security notice without a completing link.
 * 3. `confirmAccountEmailChange`: the link names the request by its hash;
 *    under the same row lock it re-checks the request (unexpired, unconsumed,
 *    unrevoked, MAC bound to the stored new address), the account (active)
 *    and uniqueness, then sets `email` and `emailVerifiedAt`, consumes the
 *    request, revokes every session and every outstanding password-reset link
 *    (those went to the old address), and audits, all in one transaction.
 *
 * Enumeration safety: when the new address already belongs to another
 * account, nothing is sent to it and no request is stored. The requester sees
 * the same message, the old address gets the same notice, and the previous
 * open request is revoked exactly as in the success case, so neither the
 * response, its timing (all of this runs after the response), the settings
 * page (which never shows pending requests), nor the requester's earlier
 * link reveals that the address is taken. Sending a "someone tried" notice to
 * the existing account was rejected: it would let anyone mail arbitrary
 * registered users through the platform and adds no protection for them
 * (their account does not change). Only the holder of the new mailbox learns
 * that it is taken, by never receiving a link; that holder could learn the
 * same from a password reset.
 */

export type AccountEmailChangeRequestOutcome =
  | "sent"
  | "target_unavailable"
  | "recipient_rate_limited"
  | "account_changed"
  | "send_failed";

type RequestInput = {
  userId: string;
  /** The account's address when the request was made (from the session, never the form). */
  currentEmail: string;
  /** Already normalized by `normalizeLoginEmail` and different from `currentEmail`. */
  newEmail: string;
  vendorId?: string | null;
  actorLabel?: string | null;
  now?: Date;
};

type LockedTransaction = Prisma.TransactionClient;
type RequestWriter = Pick<Prisma.TransactionClient, "userEmailChangeRequest">;

const TRANSACTION_OPTIONS = {
  // Same reasoning as password reset: the production pool is small, so let a
  // second request for the same user wait for the row lock instead of
  // failing with Prisma's default two-second admission timeout.
  maxWait: 5_000,
  timeout: 10_000,
} as const;

/** Serializes every request and confirmation for one user. */
async function lockUser(tx: LockedTransaction, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  return rows.length === 1;
}

function revokeOpenRequests(tx: RequestWriter, userId: string, now: Date) {
  return tx.userEmailChangeRequest.updateMany({
    where: { userId, consumedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
}

type StoredRequest =
  | { kind: "account_changed" }
  | { kind: "target_unavailable"; revoked: number }
  | { kind: "created"; revoked: number; requestId: string; token: string; jti: string; expiresAt: Date };

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
    // Keyed by the new address whatever account (if any) owns it.
    const recipient = await consumeAccountRateLimit("account_email_change_recipient", input.newEmail);
    if (!recipient.allowed) {
      await audit("account_email_change_suppressed", { reason: "recipient_rate_limited" });
      return { outcome: "recipient_rate_limited" };
    }

    const stored = await getDb().$transaction(async (tx): Promise<StoredRequest> => {
      if (!await lockUser(tx, input.userId)) return { kind: "account_changed" };
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { email: true, status: true } });
      // The account changed since the request (suspended, or its address moved on).
      if (!user || user.status !== "active" || user.email !== input.currentEmail) return { kind: "account_changed" };
      const revoked = (await revokeOpenRequests(tx, input.userId, now)).count;
      const taken = await tx.user.findUnique({ where: { email: input.newEmail }, select: { id: true } });
      if (taken) return { kind: "target_unavailable", revoked };
      const link = createAccountEmailChangeToken({ userId: input.userId, newEmail: input.newEmail, now });
      const request = await tx.userEmailChangeRequest.create({
        data: { userId: input.userId, newEmail: input.newEmail, tokenHash: link.tokenHash, expiresAt: link.expiresAt, createdAt: now },
        select: { id: true },
      });
      return { kind: "created", revoked, requestId: request.id, token: link.token, jti: link.jti, expiresAt: link.expiresAt };
    }, TRANSACTION_OPTIONS);

    if (stored.kind === "account_changed") {
      await audit("account_email_change_suppressed", { reason: "account_changed" });
      return { outcome: "account_changed" };
    }

    let outcome: AccountEmailChangeRequestOutcome = "target_unavailable";
    if (stored.kind === "created") {
      try {
        await sendAccountEmailChangeVerificationEmail({
          to: input.newEmail,
          confirmUrl: accountEmailChangeUrl(stored.token),
          validMinutes: ACCOUNT_EMAIL_CHANGE_TTL_MINUTES,
          idempotencyKey: `account-email-change:${stored.jti}`,
        });
        outcome = "sent";
      } catch (error) {
        // Never leave a usable link the recipient did not get.
        await getDb().userEmailChangeRequest.updateMany({
          where: { id: stored.requestId, consumedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        }).catch(() => undefined);
        await audit("account_email_change_email_failed", {
          requestId: stored.requestId,
          jti: stored.jti,
          errorCode: error instanceof TransactionalEmailError ? error.code : "unknown",
        });
        return { outcome: "send_failed" };
      }
    }

    // The old address hears about every processed request, taken target or not.
    let noticeSent = true;
    try {
      await sendAccountEmailChangeNoticeEmail({
        to: input.currentEmail,
        maskedNewEmail: maskEmailRecipient(input.newEmail),
        idempotencyKey: stored.kind === "created" ? `account-email-change-notice:${stored.jti}` : undefined,
      });
    } catch {
      noticeSent = false;
    }

    // The audit row never holds an address, the token or the link. Audit
    // logs are only shown to platform administrators.
    await audit("account_email_change_requested", {
      outcome,
      supersededRequests: stored.revoked,
      noticeSent,
      ...(stored.kind === "created" ? { requestId: stored.requestId, jti: stored.jti, expiresAt: stored.expiresAt.toISOString() } : {}),
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

export type AccountEmailChangeConfirmation = { status: "changed" | "invalid" | "email_taken" };

type ConfirmResult =
  | { status: "invalid" }
  | { status: "email_taken" }
  | { status: "changed" };

/** Thrown inside the confirmation transaction to roll it back. */
/** Thrown inside the confirmation transaction to roll it back. */
class ConfirmRollback extends Error {}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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
    return await getDb().$transaction(async (tx): Promise<ConfirmResult> => {
      const request = await tx.userEmailChangeRequest.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, newEmail: true },
      });
      // The token's user must own the row its hash found, and the MAC must bind the stored address.
      if (!request || request.userId !== candidate.userId) return { status: "invalid" };
      const claim = verifyAccountEmailChangeToken(token, request.newEmail, now);
      if (!claim) return { status: "invalid" };

      if (!await lockUser(tx, request.userId)) return { status: "invalid" };
      // Re-read under the lock: a concurrent request or password change may have revoked it.
      const open = await tx.userEmailChangeRequest.findFirst({
        where: { id: request.id, userId: request.userId, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!open) return { status: "invalid" };
      const user = await tx.user.findUnique({ where: { id: request.userId }, select: { email: true, status: true } });
      if (!user || user.status !== "active") return { status: "invalid" };

      const taken = await tx.user.findFirst({ where: { email: request.newEmail, id: { not: request.userId } }, select: { id: true } });
      if (taken) {
        // The address was claimed after the request: this link can never succeed.
        await tx.userEmailChangeRequest.updateMany({ where: { id: request.id, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
        return { status: "email_taken" };
      }

      const consumed = await tx.userEmailChangeRequest.updateMany({
        where: { id: request.id, userId: request.userId, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return { status: "invalid" };

      const previousEmail = user.email;
      // Bound to the id and the address read under the lock. A unique
      // violation here (another account took the address after the check)
      // rolls everything back and reports email_taken.
      const updated = await tx.user.updateMany({
        where: { id: request.userId, email: previousEmail, status: "active" },
        data: { email: request.newEmail, emailVerifiedAt: now },
      });
      if (updated.count !== 1) throw new ConfirmRollback();

      // Keep the founding account bound to its workspace: registration gives
      // Vendor and User the same address and vendorEmailVerificationState
      // matches on it. Only a vendor this user is still an active member of,
      // and only when no other workspace already uses the new address.
      const founded = await tx.vendor.findFirst({
        where: { email: previousEmail, members: { some: { userId: request.userId, status: "active" } } },
        select: { id: true },
      });
      let founderVendorUpdated = false;
      if (founded && !await tx.vendor.findUnique({ where: { email: request.newEmail }, select: { id: true } })) {
        await tx.vendor.update({ where: { id: founded.id }, data: { email: request.newEmail } });
        founderVendorUpdated = true;
      }

      // Mirror password reset: the change may come from any browser, so every session ends.
      const sessions = await tx.userSession.updateMany({ where: { userId: request.userId, revokedAt: null }, data: { revokedAt: now } });
      // Reset links went to the old address; completing one must not verify the new one.
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
            founderVendorUpdated,
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
    throw error;
  }
}
