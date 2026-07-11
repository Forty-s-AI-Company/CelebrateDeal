import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { sendTransactionalEmail } from "@/lib/email";
import { hashPassword, verifyPassword } from "@/lib/password";

export const INVITATION_ROLES = ["owner", "admin", "accountant"] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

class InvalidInvitationError extends Error {}

export function normalizeInvitationEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isInvitationRole(role: string): role is InvitationRole {
  return (INVITATION_ROLES as readonly string[]).includes(role);
}

function invitationIsActive(input: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}, now: Date) {
  return !input.acceptedAt && !input.revokedAt && input.expiresAt > now;
}

export async function createVendorInvitation(input: {
  vendorId: string;
  email: string;
  role: InvitationRole;
  invitedByUserId: string;
  now?: Date;
}) {
  const email = normalizeInvitationEmail(input.email);
  const now = input.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  try {
    const invitation = await getDb().$transaction(async (tx) => {
      const [activeMember, currentInvitation] = await Promise.all([
        tx.vendorMember.findFirst({
          where: {
            vendorId: input.vendorId,
            status: "active",
            user: { email },
          },
          select: { id: true },
        }),
        tx.vendorInvitation.findUnique({
          where: { vendorId_email: { vendorId: input.vendorId, email } },
        }),
      ]);

      if (activeMember || (currentInvitation && invitationIsActive(currentInvitation, now))) {
        throw new InvalidInvitationError();
      }

      return tx.vendorInvitation.upsert({
        where: { vendorId_email: { vendorId: input.vendorId, email } },
        create: {
          vendorId: input.vendorId,
          email,
          role: input.role,
          tokenHash,
          invitedByUserId: input.invitedByUserId,
          expiresAt,
        },
        update: {
          role: input.role,
          tokenHash,
          invitedByUserId: input.invitedByUserId,
          acceptedByUserId: null,
          acceptedAt: null,
          revokedAt: null,
          expiresAt,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { ok: true as const, invitation, token, expiresAt };
  } catch (error) {
    if (error instanceof InvalidInvitationError || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))) {
      return { ok: false as const, reason: "unavailable" as const };
    }
    throw error;
  }
}

export async function getInvitationDetails(token: string, now = new Date()) {
  if (!token) return null;

  const invitation = await getDb().vendorInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: {
      vendor: { select: { id: true, name: true, onboardingStatus: true } },
    },
  });

  if (!invitation || !invitationIsActive(invitation, now) || !isInvitationRole(invitation.role)) return null;

  const existingUser = await getDb().user.findUnique({
    where: { email: invitation.email },
    select: { id: true, status: true, platformRole: true },
  });
  if (existingUser && (existingUser.status !== "active" || existingUser.platformRole !== "none")) return null;

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    vendor: invitation.vendor,
    requiresRegistration: !existingUser,
  };
}

export async function acceptVendorInvitation(input: {
  token: string;
  name?: string;
  password?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const name = input.name?.trim() ?? "";
  const password = input.password ?? "";

  try {
    return await getDb().$transaction(async (tx) => {
      const invitation = await tx.vendorInvitation.findUnique({
        where: { tokenHash: hashInvitationToken(input.token) },
        include: { vendor: { select: { id: true, onboardingStatus: true } } },
      });
      if (!invitation || !invitationIsActive(invitation, now) || !isInvitationRole(invitation.role)) {
        throw new InvalidInvitationError();
      }

      let user = await tx.user.findUnique({ where: { email: invitation.email } });
      if (user && (user.status !== "active" || user.platformRole !== "none")) {
        throw new InvalidInvitationError();
      }

      if (user && !verifyPassword(password, user.passwordHash)) {
        return { ok: false as const, reason: "authentication_required" as const };
      }

      if (!user) {
        if (name.length < 2 || password.length < 12) {
          return { ok: false as const, reason: "profile_invalid" as const };
        }
        user = await tx.user.create({
          data: {
            email: invitation.email,
            name,
            passwordHash: hashPassword(password),
            status: "active",
          },
        });
      }

      const currentMembership = await tx.vendorMember.findUnique({
        where: { vendorId_userId: { vendorId: invitation.vendorId, userId: user.id } },
      });
      if (currentMembership?.status === "active") {
        throw new InvalidInvitationError();
      }

      // The conditional claim is the one-time-use boundary; all later writes roll
      // back if another request already consumed, revoked, or expired this token.
      const claimed = await tx.vendorInvitation.updateMany({
        where: {
          id: invitation.id,
          tokenHash: hashInvitationToken(input.token),
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          acceptedAt: now,
          acceptedByUserId: user.id,
        },
      });
      if (claimed.count !== 1) throw new InvalidInvitationError();

      const membership = await tx.vendorMember.upsert({
        where: { vendorId_userId: { vendorId: invitation.vendorId, userId: user.id } },
        create: {
          vendorId: invitation.vendorId,
          userId: user.id,
          role: invitation.role,
          status: "active",
        },
        update: {
          role: invitation.role,
          status: "active",
          deactivatedAt: null,
        },
      });

      return {
        ok: true as const,
        userId: user.id,
        vendorId: invitation.vendorId,
        invitationId: invitation.id,
        membershipId: membership.id,
        role: membership.role,
        onboardingStatus: invitation.vendor.onboardingStatus,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof InvalidInvitationError || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))) {
      return { ok: false as const, reason: "invalid_or_expired" as const };
    }
    throw error;
  }
}

export async function revokeVendorInvitation(input: {
  invitationId: string;
  vendorId: string;
  now?: Date;
}) {
  const result = await getDb().vendorInvitation.updateMany({
    where: {
      id: input.invitationId,
      vendorId: input.vendorId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: input.now ?? new Date() },
  });
  return result.count === 1;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendVendorInvitationEmail(input: {
  to: string;
  vendorName: string;
  invitationUrl: string;
  expiresAt: Date;
}) {
  const safeVendorName = escapeHtml(input.vendorName);
  const safeInvitationUrl = escapeHtml(input.invitationUrl);
  return sendTransactionalEmail({
    to: input.to,
    subject: `${input.vendorName} 邀請你加入 CelebrateDeal`,
    text: `${input.vendorName} 邀請你加入 CelebrateDeal 工作區。\n\n請在 ${input.expiresAt.toLocaleString("zh-TW")} 前開啟：\n${input.invitationUrl}\n\n如果你不認識這個邀請，可以直接忽略。`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">
        <h2 style="margin:0 0 12px">加入 ${safeVendorName}</h2>
        <p>你受邀加入 CelebrateDeal 工作區。</p>
        <p><a href="${safeInvitationUrl}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">接受邀請</a></p>
        <p style="word-break:break-all;color:#475569">${safeInvitationUrl}</p>
        <p>此連結將於 ${input.expiresAt.toLocaleString("zh-TW")} 到期，且只能使用一次。</p>
      </div>
    `,
  });
}
