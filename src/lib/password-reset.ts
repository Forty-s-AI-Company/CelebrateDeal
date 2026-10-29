import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import { consumeAccountRateLimit } from "@/lib/account-rate-limit";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { hashPasswordAsync } from "@/lib/password";

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

// Production uses a deliberately small serverless pool. Allow a second claim
// on the same account to wait for the row lock rather than surfacing Prisma's
// default two-second P2028 admission timeout.
const PASSWORD_RESET_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPasswordResetToken({
  email,
  ipAddress,
  userAgent,
}: {
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const normalized = email.toLowerCase().trim();
  const candidate = await getDb().user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!candidate) {
    return null;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  // The lookup above ran without a lock: a login email change may have moved
  // this account to another address since. Under the same User row lock that
  // the email change confirmation takes, re-read the account and issue the
  // token only if it still has this address and is active. The caller mails
  // the address read here, never the one the request named.
  return getDb().$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${candidate.id} FOR UPDATE`;
    if (locked.length !== 1) return null;
    const user = await tx.user.findUnique({ where: { id: candidate.id } });
    if (!user || user.status !== "active" || user.email !== normalized) return null;
    const now = new Date();
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    const createdToken = await tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash: tokenHash(token), expiresAt, ipAddress, userAgent },
    });
    return { user, token, tokenId: createdToken.id, expiresAt };
  }, PASSWORD_RESET_TRANSACTION_OPTIONS);
}

export async function sendPasswordResetLink({
  email,
  appUrl,
  ipAddress,
  userAgent,
}: {
  email: string;
  appUrl: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const reset = await createPasswordResetToken({ email, ipAddress, userAgent });
  if (!reset) {
    await writeAuditLog({
      actorLabel: "anonymous",
      action: "password_reset_requested_unknown_email",
      targetType: "PasswordResetToken",
      after: auditSnapshot({ email }),
    });
    return null;
  }

  const resetUrl = `${appUrl.replace(/\/$/, "")}/password-reset/confirm?token=${encodeURIComponent(reset.token)}`;
  try {
    await sendPasswordResetEmail({
      to: reset.user.email,
      resetUrl,
    });
  } catch (error) {
    // 外部寄信失敗時不能留下收件人從未取得的有效 token。
    await getDb().passwordResetToken.updateMany({
      where: { id: reset.tokenId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await writeAuditLog({
      actorId: reset.user.id,
      actorLabel: "password_reset_request",
      action: "password_reset_email_failed",
      targetType: "PasswordResetToken",
      targetId: reset.tokenId,
      after: auditSnapshot({ email: reset.user.email, tokenRevoked: true }),
    });
    throw error;
  }
  await writeAuditLog({
    actorId: reset.user.id,
    actorLabel: "password_reset_request",
    action: "password_reset_requested",
    targetType: "PasswordResetToken",
    targetId: reset.tokenId,
    after: auditSnapshot({ email: reset.user.email, expiresAt: reset.expiresAt.toISOString() }),
  });

  // Callers only need to know whether delivery was scheduled. Keeping the raw
  // token and reset URL inside this module prevents accidental API, redirect,
  // telemetry, or Server Component disclosure.
  return { sent: true as const };
}

export function schedulePasswordResetLink(
  input: Parameters<typeof sendPasswordResetLink>[0],
) {
  // Account lookup, token creation, audit work, and email delivery all happen
  // after the generic response. This removes their observable workload
  // difference from anonymous reset requests.
  after(async () => {
    try {
      // Account layer (F-028): a recipient gets at most a few reset mails per
      // window whatever the source IP or RATE_LIMIT_PROVIDER. Over the limit,
      // or if the counter is unavailable, nothing is sent; the anonymous
      // response is already generic, so this reveals nothing.
      const decision = await consumeAccountRateLimit("password_reset_request", input.email.trim().toLowerCase());
      if (!decision.allowed) return;
      await sendPasswordResetLink(input);
    } catch {
      // sendPasswordResetLink revokes a token that was not delivered and writes
      // a safe audit record. Anonymous callers always keep the same response.
    }
  });
}

/**
 * The address and platform role of the account a still-usable reset token
 * belongs to, so the new-password policy can apply the administrator length
 * and refuse a password built from the address. One read-only lookup; an
 * unusable token yields null, the same as an unknown one. Consuming the token
 * stays in consumePasswordResetToken, which re-checks everything atomically.
 */
export async function findPasswordResetTokenAccount(token: string, now = new Date()) {
  if (!token) return null;
  const resetToken = await getDb().passwordResetToken.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { usedAt: true, expiresAt: true, user: { select: { email: true, status: true, platformRole: true } } },
  });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now || resetToken.user.status !== "active") return null;
  return { email: resetToken.user.email, platformRole: resetToken.user.platformRole };
}

export async function consumePasswordResetToken(token: string, password: string) {
  const now = new Date();
  const passwordHash = await hashPasswordAsync(password);
  const consumed = await getDb().$transaction(
    async (tx) => {
      const owner = await tx.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(token) }, select: { userId: true } });
      if (!owner) return null;
      // Lock the account first, the same order as the login email change
      // confirmation and revert, then re-read the token under that lock (a
      // completed email change marks it used).
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${owner.userId} FOR UPDATE`;
      const resetToken = await tx.passwordResetToken.findUnique({
        where: { tokenHash: tokenHash(token) },
        include: { user: true },
      });

      if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now || resetToken.user.status !== "active") {
        return null;
      }

      const claim = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (claim.count !== 1) {
        return null;
      }

      await tx.user.update({
        where: { id: resetToken.userId },
        // The link was e-mailed to the address createPasswordResetToken read
        // under this same row lock. A login email change confirmation or
        // revert takes that lock too and marks every unused reset token used
        // when it moves the address, so a token still usable here was sent to
        // the current address. Completing it therefore proves the mailbox; an
        // earlier timestamp stays.
        data: { passwordHash, ...(resetToken.user.emailVerifiedAt ? {} : { emailVerifiedAt: now }) },
      });
      await tx.userSession.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      // The old-address notice of a login email change says a reset stops a pending one.
      await tx.userEmailChangeRequest.updateMany({
        where: { userId: resetToken.userId, consumedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });

      return {
        tokenId: resetToken.id,
        userId: resetToken.userId,
      };
    },
    PASSWORD_RESET_TRANSACTION_OPTIONS,
  );

  if (!consumed) {
    return { ok: false as const, reason: "invalid_or_expired" as const };
  }

  await writeAuditLog({
    actorId: consumed.userId,
    actorLabel: "password_reset_confirm",
    action: "password_reset_completed",
    targetType: "PasswordResetToken",
    targetId: consumed.tokenId,
    after: auditSnapshot({ userId: consumed.userId }),
  });

  return { ok: true as const, userId: consumed.userId };
}
