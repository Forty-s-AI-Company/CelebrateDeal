import { createHmac } from "node:crypto";
import { getDb } from "@/lib/db";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";
import { normalizeMerchantRegistrationEmail } from "@/lib/merchant-registration-invite";
import { MERCHANT_INVITATION_AUDIT_ACTION, MERCHANT_INVITATION_REVOKED_AUDIT_ACTION } from "@/lib/merchant-invitation-admin";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

/**
 * Invitations live only in the append-only AuditLog. Entries never hold the
 * token or the plaintext address: a masked address for display and a keyed
 * hash for matching. Every lookup uses the (targetType, targetId) or
 * (action, createdAt) indexes on AuditLog.
 */
export const MERCHANT_INVITE_AUDIT_TARGET_TYPE = "MerchantRegistrationInvite";
const EMAIL_HASH_PURPOSE = "merchant-invite-email-v1";
const RECENT_LIMIT = 30;

export function merchantInviteEmailHash(email: string) {
  return createHmac("sha256", deriveSensitiveDataKey(EMAIL_HASH_PURPOSE))
    .update(normalizeMerchantRegistrationEmail(email))
    .digest("base64url");
}

export function maskedMerchantInviteEmail(email: string) {
  return maskEmailRecipient(normalizeMerchantRegistrationEmail(email));
}

type Db = ReturnType<typeof getDb>;

/** One indexed lookup on (targetType, targetId). */
export async function isMerchantRegistrationInviteRevoked(jti: string, db: Pick<Db, "auditLog"> = getDb()) {
  const revoked = await db.auditLog.findFirst({
    where: { targetType: MERCHANT_INVITE_AUDIT_TARGET_TYPE, targetId: jti, action: MERCHANT_INVITATION_REVOKED_AUDIT_ACTION, vendorId: null },
    select: { id: true },
  });
  return Boolean(revoked);
}

/** The creation entry for this jti, if a platform admin issued it. */
export async function findMerchantRegistrationInvite(jti: string, db: Pick<Db, "auditLog"> = getDb()) {
  return db.auditLog.findFirst({
    where: { targetType: MERCHANT_INVITE_AUDIT_TARGET_TYPE, targetId: jti, action: MERCHANT_INVITATION_AUDIT_ACTION, vendorId: null },
    select: { id: true, after: true },
  });
}

function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

export type MerchantInvitationListItem = {
  jti: string;
  createdAt: Date;
  maskedEmail: string | null;
  expiresAt: string | null;
  status: "registered" | "revoked" | "expired" | "pending";
};

/** Recent invitations with registration (by jti), revocation and expiry status. */
export async function recentMerchantInvitations(now = new Date(), db: Pick<Db, "auditLog"> = getDb()): Promise<MerchantInvitationListItem[]> {
  const entries = await db.auditLog.findMany({
    where: { action: MERCHANT_INVITATION_AUDIT_ACTION, vendorId: null, targetType: MERCHANT_INVITE_AUDIT_TARGET_TYPE },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: { targetId: true, createdAt: true, after: true },
  });
  const invitations = entries.flatMap((entry) => entry.targetId ? [{ ...entry, jti: entry.targetId }] : []);
  if (invitations.length === 0) return [];
  const jtis = invitations.map((invitation) => invitation.jti);
  const oldest = invitations.reduce((min, invitation) => invitation.createdAt < min ? invitation.createdAt : min, invitations[0]!.createdAt);
  const [revocations, registrations] = await Promise.all([
    db.auditLog.findMany({
      where: { targetType: MERCHANT_INVITE_AUDIT_TARGET_TYPE, targetId: { in: jtis }, action: MERCHANT_INVITATION_REVOKED_AUDIT_ACTION, vendorId: null },
      select: { targetId: true },
    }),
    // A registration can only follow its invitation, so (action, createdAt) bounds the scan.
    db.auditLog.findMany({
      where: { action: "registration_completed", createdAt: { gte: oldest }, OR: jtis.map((jti) => ({ after: { path: ["registrationInvite", "jti"], equals: jti } })) },
      select: { after: true },
    }),
  ]);
  const revoked = new Set(revocations.map((entry) => entry.targetId));
  const registered = new Set(registrations.map((entry) => {
    const invite = entry.after && typeof entry.after === "object" && !Array.isArray(entry.after) ? (entry.after as Record<string, unknown>).registrationInvite : null;
    return readString(invite, "jti");
  }));
  return invitations.map((invitation) => {
    const expiresAt = readString(invitation.after, "expiresAt");
    const expired = expiresAt ? new Date(expiresAt) <= now : false;
    const status = registered.has(invitation.jti) ? "registered" : revoked.has(invitation.jti) ? "revoked" : expired ? "expired" : "pending";
    return { jti: invitation.jti, createdAt: invitation.createdAt, maskedEmail: readString(invitation.after, "maskedEmail"), expiresAt, status };
  });
}
