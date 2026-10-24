import { createHmac } from "node:crypto";
import { getDb } from "@/lib/db";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";
import { MERCHANT_REGISTRATION_INVITE_TTL_MS, normalizeMerchantRegistrationEmail } from "@/lib/merchant-registration-invite";
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
/** Older, already-expired invitations shown as history. */
export const MERCHANT_INVITE_HISTORY_LIMIT = 30;
/** Safety bound for invitations that may still be valid (created within one TTL). */
export const MERCHANT_INVITE_ACTIVE_LIMIT = 500;

/**
 * Stored on each creation entry so a later question such as "was this address
 * already invited?" or "which invitation went to this address?" can be
 * answered by hashing the address the admin types, without ever keeping the
 * plaintext in the append-only audit log. Nothing reads it yet. It is keyed
 * (not a bare SHA-256) so the stored value cannot be checked against guessed
 * addresses without the deployment secret, which in turn requires the CSRF
 * key-separation fix (PR #485) to be deployed.
 */
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

export type MerchantInvitationList = {
  items: MerchantInvitationListItem[];
  /** True when more than MERCHANT_INVITE_ACTIVE_LIMIT invitations may still be valid. */
  activeTruncated: boolean;
};

/**
 * Every invitation created within one TTL (all that can still be valid, so all
 * revocable ones are listed), then the latest older ones as history; each with
 * registration (by jti), revocation and expiry status.
 */
export async function recentMerchantInvitations(now = new Date(), db: Pick<Db, "auditLog"> = getDb()): Promise<MerchantInvitationList> {
  const base = { action: MERCHANT_INVITATION_AUDIT_ACTION, vendorId: null, targetType: MERCHANT_INVITE_AUDIT_TARGET_TYPE };
  const windowStart = new Date(now.getTime() - MERCHANT_REGISTRATION_INVITE_TTL_MS);
  const select = { targetId: true, createdAt: true, after: true } as const;
  const [active, history] = await Promise.all([
    db.auditLog.findMany({ where: { ...base, createdAt: { gte: windowStart } }, orderBy: { createdAt: "desc" }, take: MERCHANT_INVITE_ACTIVE_LIMIT + 1, select }),
    db.auditLog.findMany({ where: { ...base, createdAt: { lt: windowStart } }, orderBy: { createdAt: "desc" }, take: MERCHANT_INVITE_HISTORY_LIMIT, select }),
  ]);
  const activeTruncated = active.length > MERCHANT_INVITE_ACTIVE_LIMIT;
  const entries = [...active.slice(0, MERCHANT_INVITE_ACTIVE_LIMIT), ...history];
  const invitations = entries.flatMap((entry) => entry.targetId ? [{ ...entry, jti: entry.targetId }] : []);
  if (invitations.length === 0) return { items: [], activeTruncated };
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
  const items = invitations.map((invitation): MerchantInvitationListItem => {
    const expiresAt = readString(invitation.after, "expiresAt");
    const expired = expiresAt ? new Date(expiresAt) <= now : false;
    const status = registered.has(invitation.jti) ? "registered" : revoked.has(invitation.jti) ? "revoked" : expired ? "expired" : "pending";
    return { jti: invitation.jti, createdAt: invitation.createdAt, maskedEmail: readString(invitation.after, "maskedEmail"), expiresAt, status };
  });
  return { items, activeTruncated };
}
