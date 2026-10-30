import { normalizeLoginEmail } from "@/lib/account-email-change-token";
import { auditSnapshot } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { sendAccountMfaRemovedBySupportNoticeEmail, TransactionalEmailError } from "@/lib/email";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";
import { unusablePasswordHash } from "@/lib/password";

/**
 * Security hold ("帳號安全暫停"). A login email change revert (restore or
 * cancel) that finds an MFA factor enabled within its look-back window
 * cannot tell whether that factor belongs to the real owner (who enabled it
 * the same day they moved away from a compromised mailbox) or to whoever took
 * over. Deleting it could hand the account to the old mailbox; keeping it
 * could keep the intruder in (or lock the owner out on a cancel).
 * So the revert keeps the factor and puts the account on hold instead.
 *
 * `User.status` is free text with no CHECK constraint (migration
 * 20260709110000); every sign-in path, session lookup, password reset and
 * LINE Login already require `status = "active"`, so this value blocks all of
 * them without a schema change. Only platform support releases a hold
 * (`releaseAccountSecurityHold`); see docs/launch/account-security-hold-runbook.md.
 */
export const ACCOUNT_SECURITY_HOLD_STATUS = "security_hold";
export const ACCOUNT_SECURITY_HOLD_AUDIT_ACTION = "account_security_hold_placed";
export const ACCOUNT_SECURITY_HOLD_RELEASED_AUDIT_ACTION = "account_security_hold_released";
export const ACCOUNT_SECURITY_HOLDS_PATH = "/admin/account-holds";
export const ACCOUNT_MFA_REMOVED_AUDIT_ACTION = "account_mfa_removed_by_support";
export const ACCOUNT_MFA_REMOVED_NOTICE_FAILED_AUDIT_ACTION = "account_mfa_removed_notice_failed";
export const ACCOUNT_MFA_REMOVAL_LOOKUP_AUDIT_ACTION = "account_mfa_removal_lookup";
export const ACCOUNT_MFA_REMOVAL_REASON_MIN_LENGTH = 10;
export const ACCOUNT_MFA_REMOVAL_REASON_MAX_LENGTH = 500;
const LIST_LIMIT = 100;
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** Masked address for platform pages; an address that cannot be masked shows as none. */
function maskedOrPlaceholder(email: string) {
  try {
    return maskEmailRecipient(email);
  } catch {
    return "***";
  }
}

export type AccountSecurityHoldListItem = {
  userId: string;
  maskedEmail: string;
  heldAt: Date | null;
  hasMfaFactor: boolean;
};

/** Accounts on hold, newest first, with masked addresses only. Platform-admin pages only. */
export async function listAccountSecurityHolds(): Promise<AccountSecurityHoldListItem[]> {
  const users = await getDb().user.findMany({
    where: { status: ACCOUNT_SECURITY_HOLD_STATUS },
    orderBy: { updatedAt: "desc" },
    take: LIST_LIMIT,
    select: { id: true, email: true, mfaFactor: { select: { id: true } } },
  });
  if (users.length === 0) return [];
  const audits = await getDb().auditLog.findMany({
    where: { action: ACCOUNT_SECURITY_HOLD_AUDIT_ACTION, targetType: "User", targetId: { in: users.map((user) => user.id) } },
    orderBy: { createdAt: "desc" },
    select: { targetId: true, createdAt: true },
  });
  return users.map((user) => ({
    userId: user.id,
    maskedEmail: maskedOrPlaceholder(user.email),
    heldAt: audits.find((audit) => audit.targetId === user.id)?.createdAt ?? null,
    hasMfaFactor: Boolean(user.mfaFactor),
  }));
}

export type AccountSecurityHoldRelease = { status: "released" | "not_held" };

/**
 * Support verified the owner out of band: the account becomes active again.
 * Only an account currently on hold changes (`status = security_hold` in the
 * same statement). The password stays unusable, so the owner still signs in
 * through a password reset to the account's address. With `removeMfaFactor`
 * (support could not confirm the factor is the owner's) the factor and every
 * recovery code go too, and the owner enrols again.
 */
export async function releaseAccountSecurityHold(input: {
  userId: string;
  actorId: string;
  removeMfaFactor: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AccountSecurityHoldRelease> {
  return getDb().$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
    if (locked.length !== 1) return { status: "not_held" as const };
    const released = await tx.user.updateMany({
      where: { id: input.userId, status: ACCOUNT_SECURITY_HOLD_STATUS },
      data: { status: "active" },
    });
    if (released.count !== 1) return { status: "not_held" as const };
    let factorsRemoved = 0;
    let recoveryCodesRemoved = 0;
    if (input.removeMfaFactor) {
      factorsRemoved = (await tx.userMfaFactor.deleteMany({ where: { userId: input.userId } })).count;
      recoveryCodesRemoved = (await tx.userRecoveryCode.deleteMany({ where: { userId: input.userId } })).count;
    }
    // Nothing from before the hold may sign in afterwards.
    await tx.userSession.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorLabel: "platform_admin",
        action: ACCOUNT_SECURITY_HOLD_RELEASED_AUDIT_ACTION,
        targetType: "User",
        targetId: input.userId,
        after: auditSnapshot({ factorsRemoved, recoveryCodesRemoved }),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return { status: "released" as const };
  }, TRANSACTION_OPTIONS);
}

/*
 * Support tool: remove MFA from an active account ("移除兩步驟驗證").
 *
 * For an owner locked out by an authenticator they do not hold (lost phone,
 * or a factor someone else enrolled) whose account is NOT on hold; a held
 * account goes through `releaseAccountSecurityHold` instead. Platform admins
 * only, after verifying the owner as docs/launch/account-security-hold-runbook.md
 * says. The admin finds the account by its login email (audited), sees only
 * the masked address, retypes that masked address and gives a reason, which
 * the audit entry keeps. Never for the admin's own account, and never for an
 * account with a platform role: those follow the runbook's two-person
 * procedure.
 *
 * A phone call can be social engineering, so removal never hands over a
 * working account: the password stops working as well, every session ends,
 * and a notice without a link goes to the login email. Whoever holds that
 * mailbox signs in again only through 忘記密碼, and an owner who did not ask
 * for it learns at once.
 */

export type AccountMfaRemovalTarget = {
  userId: string;
  maskedEmail: string;
  status: string;
  hasMfaFactor: boolean;
  recoveryCodeCount: number;
  isPlatformAdmin: boolean;
};

export type AccountMfaRemovalResult = {
  status:
    | "removed"
    | "not_found"
    | "not_active"
    | "self"
    | "platform_role"
    | "confirmation_mismatch"
    | "invalid_reason"
    | "nothing_to_remove";
};

type AuditMeta = { ipAddress?: string | null; userAgent?: string | null };

/** Any platform role (not only today's `platform_admin`) keeps an account out of the support tool. */
function hasPlatformRole(platformRole: string) {
  return platformRole !== "none";
}

/**
 * The account id for a login email, or null. The address is normalized like
 * a sign-in. Every lookup is audited with the admin and the account found (or
 * `not_found`), never the address typed.
 */
export async function lookupAccountForMfaRemoval(input: { email: unknown; actorId: string } & AuditMeta): Promise<string | null> {
  const normalized = normalizeLoginEmail(input.email);
  const user = normalized ? await getDb().user.findUnique({ where: { email: normalized }, select: { id: true } }) : null;
  await getDb().auditLog.create({
    data: {
      actorId: input.actorId,
      actorLabel: "platform_admin",
      action: ACCOUNT_MFA_REMOVAL_LOOKUP_AUDIT_ACTION,
      targetType: "User",
      targetId: user?.id ?? null,
      after: auditSnapshot({ result: user ? "found" : "not_found" }),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
  return user?.id ?? null;
}

/** What the support page shows about the account before removal: masked address and counts only. */
export async function describeAccountForMfaRemoval(userId: string): Promise<AccountMfaRemovalTarget | null> {
  const user = await getDb().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, status: true, platformRole: true, mfaFactor: { select: { id: true } }, _count: { select: { recoveryCodes: true } } },
  });
  if (!user) return null;
  return {
    userId: user.id,
    maskedEmail: maskedOrPlaceholder(user.email),
    status: user.status,
    hasMfaFactor: Boolean(user.mfaFactor),
    recoveryCodeCount: user._count.recoveryCodes,
    isPlatformAdmin: hasPlatformRole(user.platformRole),
  };
}

/** The trimmed reason, or null when it is missing, too short or too long. */
export function normalizeMfaRemovalReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  const length = [...reason].length;
  return length >= ACCOUNT_MFA_REMOVAL_REASON_MIN_LENGTH && length <= ACCOUNT_MFA_REMOVAL_REASON_MAX_LENGTH ? reason : null;
}

/** The typed confirmation must equal the masked login email the page showed (case and spaces ignored). */
function confirmationMatches(confirmation: string, email: string) {
  try {
    return confirmation.trim().toLowerCase() === maskEmailRecipient(email);
  } catch {
    return false;
  }
}

/**
 * Removes the account's MFA factor and every recovery code, makes the
 * password unusable and ends every session, in one transaction under the
 * user's row lock, with an audit entry holding the admin's reason. Only an
 * active account without a platform role, other than the admin's own,
 * changes, and only when the confirmation matches its address as it is under
 * the lock. After the commit a notice without a link goes to the login
 * email; a failed send is audited and does not undo the removal.
 */
export async function removeAccountMfaBySupport(input: {
  userId: string;
  actorId: string;
  confirmation: string;
  reason: string;
} & AuditMeta): Promise<AccountMfaRemovalResult> {
  if (input.userId === input.actorId) return { status: "self" };
  const reason = normalizeMfaRemovalReason(input.reason);
  if (!reason) return { status: "invalid_reason" };
  const outcome = await getDb().$transaction(async (tx): Promise<{ result: AccountMfaRemovalResult; notice: { to: string; auditId: string } | null }> => {
    const done = (status: AccountMfaRemovalResult["status"]) => ({ result: { status }, notice: null });
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
    if (locked.length !== 1) return done("not_found");
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { email: true, status: true, platformRole: true } });
    if (!user) return done("not_found");
    if (user.status !== "active") return done("not_active");
    if (hasPlatformRole(user.platformRole)) return done("platform_role");
    if (!confirmationMatches(input.confirmation, user.email)) return done("confirmation_mismatch");

    const factors = await tx.userMfaFactor.deleteMany({ where: { userId: input.userId } });
    const codes = await tx.userRecoveryCode.deleteMany({ where: { userId: input.userId } });
    if (factors.count === 0 && codes.count === 0) return done("nothing_to_remove");
    // A caller who talked support into this may know the password: only the
    // login mailbox (password reset) opens the account again.
    await tx.user.update({ where: { id: input.userId }, data: { passwordHash: unusablePasswordHash("support_mfa_removal") } });
    const sessions = await tx.userSession.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    const audit = await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorLabel: "platform_admin",
        action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION,
        targetType: "User",
        targetId: input.userId,
        after: auditSnapshot({
          reason,
          factorsRemoved: factors.count,
          recoveryCodesRemoved: codes.count,
          sessionsRevoked: sessions.count,
          loginCredentialDisabled: true,
        }),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true },
    });
    return { result: { status: "removed" }, notice: { to: user.email, auditId: audit.id } };
  }, TRANSACTION_OPTIONS);
  if (outcome.notice) await sendMfaRemovedNotice(outcome.notice, input);
  return outcome.result;
}

/** After the commit: tell the login mailbox. Never throws; a failure is audited for support. */
async function sendMfaRemovedNotice(notice: { to: string; auditId: string }, input: { userId: string; actorId: string } & AuditMeta) {
  try {
    await sendAccountMfaRemovedBySupportNoticeEmail({ to: notice.to, idempotencyKey: `account-mfa-removed-notice:${notice.auditId}` });
  } catch (error) {
    await getDb().auditLog.create({
      data: {
        actorId: input.actorId,
        actorLabel: "platform_admin",
        action: ACCOUNT_MFA_REMOVED_NOTICE_FAILED_AUDIT_ACTION,
        targetType: "User",
        targetId: input.userId,
        after: auditSnapshot({ removalAuditId: notice.auditId, errorCode: error instanceof TransactionalEmailError ? error.code : "unknown" }),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    }).catch(() => undefined);
  }
}
