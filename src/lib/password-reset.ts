import { createHash, randomBytes } from "node:crypto";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { hashPassword } from "@/lib/password";

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

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
  const user = await getDb().user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || user.status !== "active") {
    return null;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  const [, createdToken] = await getDb().$transaction([
    getDb().passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    }),
    getDb().passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(token),
        expiresAt,
        ipAddress,
        userAgent,
      },
    }),
  ]);

  return { user, token, tokenId: createdToken.id, expiresAt };
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

  return { ...reset, resetUrl };
}

export async function consumePasswordResetToken(token: string, password: string) {
  const resetToken = await getDb().passwordResetToken.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date() || resetToken.user.status !== "active") {
    return { ok: false as const, reason: "invalid_or_expired" as const };
  }

  await getDb().$transaction([
    getDb().user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: hashPassword(password) },
    }),
    getDb().passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    getDb().userSession.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await writeAuditLog({
    actorId: resetToken.userId,
    actorLabel: "password_reset_confirm",
    action: "password_reset_completed",
    targetType: "PasswordResetToken",
    targetId: resetToken.id,
    after: auditSnapshot({ userId: resetToken.userId }),
  });

  return { ok: true as const, userId: resetToken.userId };
}
