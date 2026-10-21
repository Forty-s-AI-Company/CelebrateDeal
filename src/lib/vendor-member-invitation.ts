import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Vendor member invitations (F-029 / B02-06).
 *
 * The owner's "add member" request never creates or changes a membership and
 * answers the same way whether the address is unknown, already a user of
 * another tenant, a platform administrator or a suspended account. The
 * invitee receives a single-use link and must accept it while signed in as
 * the invited address, or create a new account with that address. Platform
 * administrators and suspended accounts are recorded like any other
 * invitation but are never e-mailed and can never accept.
 */
export const VENDOR_MEMBER_ROLES = ["owner", "admin", "accountant", "support"] as const;
export type VendorMemberRole = (typeof VENDOR_MEMBER_ROLES)[number];
export const VENDOR_MEMBER_INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

type Db = PrismaClient | Prisma.TransactionClient;

export function isVendorMemberRole(value: string): value is VendorMemberRole {
  return (VENDOR_MEMBER_ROLES as readonly string[]).includes(value);
}

export function normalizeInvitationEmail(value: string) {
  return value.trim().toLowerCase();
}

export function hashVendorMemberInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isEligibleInvitee(user: { status: string; platformRole: string } | null) {
  return !user || (user.status === "active" && user.platformRole === "none");
}

export type CreatedVendorMemberInvitation = {
  invitationId: string;
  token: string;
  expiresAt: Date;
  /** False for platform administrators and suspended accounts: record only, never e-mail. */
  deliver: boolean;
};

/**
 * Creates a pending invitation for the session's vendor. Any earlier pending
 * invitation for the same address in this vendor is revoked so only the
 * newest link works. The caller decides delivery; the owner sees the same
 * result either way.
 */
export async function createVendorMemberInvitation(
  db: PrismaClient,
  input: { vendorId: string; invitedByUserId: string; email: string; name: string; role: VendorMemberRole; now?: Date },
): Promise<CreatedVendorMemberInvitation> {
  const now = input.now ?? new Date();
  const email = normalizeInvitationEmail(input.email);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + VENDOR_MEMBER_INVITATION_TTL_MS);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email }, select: { status: true, platformRole: true } });
    await tx.vendorMemberInvitation.updateMany({
      where: { vendorId: input.vendorId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const invitation = await tx.vendorMemberInvitation.create({
      data: {
        vendorId: input.vendorId,
        email,
        name: input.name,
        role: input.role,
        tokenHash: hashVendorMemberInvitationToken(token),
        invitedByUserId: input.invitedByUserId,
        expiresAt,
      },
      select: { id: true },
    });
    return { invitationId: invitation.id, token, expiresAt, deliver: isEligibleInvitee(user) };
  });
}

/** Pending, unexpired invitation for a raw token, with the data the accept page shows. */
export async function findPendingVendorMemberInvitation(db: Db, token: string, now = new Date()) {
  if (!token || token.length > 256) return null;
  return db.vendorMemberInvitation.findFirst({
    where: { tokenHash: hashVendorMemberInvitationToken(token), acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, vendorId: true, email: true, name: true, role: true, expiresAt: true, vendor: { select: { name: true } } },
  });
}

export async function revokeVendorMemberInvitation(db: Db, input: { vendorId: string; invitationId: string; now?: Date }) {
  const result = await db.vendorMemberInvitation.updateMany({
    // The vendor predicate binds the client-supplied id to the session tenant.
    where: { id: input.invitationId, vendorId: input.vendorId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: input.now ?? new Date() },
  });
  return result.count === 1;
}

export type AcceptVendorMemberInvitationResult =
  | { ok: true; vendorId: string; userId: string; membershipId: string; createdAccount: boolean; role: string }
  | { ok: false; reason: "invalid" | "login_required" | "wrong_account" | "account_exists" | "last_owner" };

class AcceptAbort extends Error {
  constructor(readonly reason: Exclude<AcceptVendorMemberInvitationResult, { ok: true }>["reason"]) {
    super(reason);
  }
}

/**
 * Accepts an invitation. `actorUserId` is the signed-in user, if any.
 * `newAccount` is only used when no user exists for the invited address.
 * Every check and write shares one Serializable transaction so a token is
 * consumed once and the last-owner invariant holds.
 */
export async function acceptVendorMemberInvitation(
  db: PrismaClient,
  input: {
    token: string;
    actorUserId: string | null;
    newAccount?: { passwordHash: string; name: string; termsVersion: string; privacyVersion: string } | null;
    now?: Date;
  },
): Promise<AcceptVendorMemberInvitationResult> {
  const now = input.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const invitation = await findPendingVendorMemberInvitation(tx, input.token, now);
      if (!invitation) throw new AcceptAbort("invalid");
      const existing = await tx.user.findUnique({
        where: { email: invitation.email },
        select: { id: true, status: true, platformRole: true },
      });
      if (existing && !isEligibleInvitee(existing)) throw new AcceptAbort("invalid");

      let userId: string;
      let createdAccount = false;
      if (existing) {
        if (!input.actorUserId) throw new AcceptAbort("login_required");
        if (input.actorUserId !== existing.id) throw new AcceptAbort("wrong_account");
        userId = existing.id;
      } else {
        // A signed-in user cannot claim an invitation for another address.
        if (input.actorUserId) throw new AcceptAbort("wrong_account");
        if (!input.newAccount) throw new AcceptAbort("invalid");
        const user = await tx.user.create({
          data: { email: invitation.email, name: input.newAccount.name || invitation.name, passwordHash: input.newAccount.passwordHash, status: "active" },
          select: { id: true },
        });
        await tx.userPolicyConsent.create({
          data: {
            userId: user.id,
            vendorId: invitation.vendorId,
            context: "vendor_member_invitation",
            termsVersion: input.newAccount.termsVersion,
            privacyVersion: input.newAccount.privacyVersion,
          },
        });
        userId = user.id;
        createdAccount = true;
      }

      const membership = await tx.vendorMember.findUnique({
        where: { vendorId_userId: { vendorId: invitation.vendorId, userId } },
        select: { id: true, role: true, status: true },
      });
      if (membership?.status === "active" && membership.role === "owner" && invitation.role !== "owner") {
        const otherOwners = await tx.vendorMember.count({
          where: { vendorId: invitation.vendorId, status: "active", role: "owner", id: { not: membership.id } },
        });
        if (otherOwners < 1) throw new AcceptAbort("last_owner");
      }

      const claimed = await tx.vendorMemberInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: now, acceptedUserId: userId },
      });
      if (claimed.count !== 1) throw new AcceptAbort("invalid");

      const saved = await tx.vendorMember.upsert({
        where: { vendorId_userId: { vendorId: invitation.vendorId, userId } },
        create: { vendorId: invitation.vendorId, userId, role: invitation.role, status: "active" },
        update: { role: invitation.role, status: "active", deactivatedAt: null },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          vendorId: invitation.vendorId,
          actorId: userId,
          actorLabel: "invitee",
          action: "accept_vendor_member_invitation",
          targetType: "VendorMember",
          targetId: saved.id,
          before: membership ? { role: membership.role, status: membership.status } : Prisma.JsonNull,
          after: { role: invitation.role, status: "active", invitationId: invitation.id, createdAccount },
        },
      });
      return { ok: true as const, vendorId: invitation.vendorId, userId, membershipId: saved.id, createdAccount, role: invitation.role };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof AcceptAbort) return { ok: false, reason: error.reason };
    if (typeof error === "object" && error !== null && "code" in error) {
      // P2002: an account for the address appeared concurrently. P2034: a
      // concurrent owner change or a second acceptance of the same token.
      if (error.code === "P2002") return { ok: false, reason: "account_exists" };
      if (error.code === "P2034") return { ok: false, reason: "invalid" };
    }
    throw error;
  }
}
