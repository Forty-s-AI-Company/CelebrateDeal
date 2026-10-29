import { auditSnapshot } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";

/**
 * Security hold ("帳號安全暫停"). A login email change revert that finds an
 * MFA factor enabled within its look-back window cannot tell whether that
 * factor belongs to the real owner (who enabled it the same day they moved
 * away from a compromised mailbox) or to whoever took over. Deleting it could
 * hand the account to the old mailbox; keeping it could keep the intruder in.
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
const LIST_LIMIT = 100;

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
    maskedEmail: maskEmailRecipient(user.email),
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
  }, { maxWait: 5_000, timeout: 10_000 });
}
