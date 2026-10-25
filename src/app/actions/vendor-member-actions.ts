"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { sendVendorMemberInvitationEmail } from "@/lib/email";
import { sendPasswordResetLink } from "@/lib/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAccountRateLimit } from "@/lib/account-rate-limit";
import { requireRecentMfa } from "@/lib/recent-mfa";
import {
  createVendorMemberInvitation,
  downgradeRolesFor,
  isVendorMemberRole,
  normalizeInvitationEmail,
  revokeVendorMemberInvitation,
  type CreatedVendorMemberInvitation,
} from "@/lib/vendor-member-invitation";

const SECURITY_PATH = "/settings/security";

class LastOwnerInvariantError extends Error {}
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function isDatabaseTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "P2025" || error.code === "P2034");
}

function isSerializationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

/** IP layer (provider-dependent) first, then the per-vendor database limit (F-028). */
async function invitationRateLimited(headerStore: Awaited<ReturnType<typeof headers>>, appUrl: string, vendorId: string) {
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  return await checkRateLimit(new Request(appUrl, { headers: rateLimitHeaders }), "vendor-member-invitation", 5, 60_000)
    ?? await checkAccountRateLimit("vendor_member_invitation_vendor", vendorId);
}

/**
 * F-029 / B02-06: "add member" only records an invitation for the session's
 * vendor. No membership is created or changed here; the invitee must accept
 * the e-mailed link. The synchronous path and the response are identical for
 * an unknown address, another tenant's user, an existing member, a platform
 * administrator and a suspended account. E-mail delivery (or its deliberate
 * suppression) runs after the response so timing does not reveal which.
 */
export async function createVendorMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  // Member management can add owners (F-027 step-up).
  requireRecentMfa(auth, { nextPath: SECURITY_PATH });
  const email = normalizeInvitationEmail(text(formData, "email"));
  const name = text(formData, "name");
  const role = text(formData, "role", "accountant");
  if (!EMAIL_PATTERN.test(email) || email.length > 320 || !name || name.length > 120 || !isVendorMemberRole(role)) {
    redirect(`${SECURITY_PATH}?error=member_invalid`);
  }
  // The owner's own address is known to them; nothing to protect here.
  if (email === normalizedEmail(auth.user.email)) redirect(`${SECURITY_PATH}?error=self_invite`);

  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const rateLimited = await invitationRateLimited(headerStore, appUrl, auth.vendor.id);
  if (rateLimited) redirect(`${SECURITY_PATH}?error=${rateLimited.status === 429 ? "member_invitation_rate_limited" : "member_invitation_unavailable"}`);

  const invitation = await createVendorMemberInvitation(getDb(), {
    vendorId: auth.vendor.id,
    invitedByUserId: auth.user.id,
    email,
    name,
    role,
  });
  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "invite_vendor_member",
    targetType: "VendorMemberInvitation",
    targetId: invitation.invitationId,
    after: auditSnapshot({ email, role, expiresAt: invitation.expiresAt.toISOString() }),
  });

  const vendor = { id: auth.vendor.id, name: auth.vendor.name };
  const actorId = auth.user.id;
  after(() => deliverVendorMemberInvitation({ appUrl, vendor, actorId, email, role, invitation }));

  revalidatePath(SECURITY_PATH);
  redirect(`${SECURITY_PATH}?updated=member_invited`);
}

async function deliverVendorMemberInvitation(input: {
  appUrl: string;
  vendor: { id: string; name: string };
  actorId: string;
  email: string;
  role: string;
  invitation: CreatedVendorMemberInvitation;
}) {
  const { invitation } = input;
  try {
    // Platform administrators and suspended accounts are never e-mailed; the
    // note is platform-scoped (no vendorId) so the tenant cannot read it.
    if (!invitation.deliver) {
      await writeAuditLog({
        actorId: input.actorId,
        actorLabel: "system",
        action: "vendor_member_invitation_suppressed",
        targetType: "VendorMemberInvitation",
        targetId: invitation.invitationId,
        after: auditSnapshot({ vendorId: input.vendor.id, reason: "ineligible_account" }),
      });
      return;
    }
    // Cross-tenant guard: one address receives a bounded number of
    // invitations whatever vendor sends them (F-028).
    const recipientLimited = await checkAccountRateLimit("vendor_member_invitation_recipient", input.email);
    if (recipientLimited) {
      await writeAuditLog({
        actorId: input.actorId,
        actorLabel: "system",
        action: "vendor_member_invitation_suppressed",
        targetType: "VendorMemberInvitation",
        targetId: invitation.invitationId,
        after: auditSnapshot({ vendorId: input.vendor.id, reason: "recipient_rate_limited" }),
      });
      return;
    }
    const acceptUrl = `${input.appUrl.replace(/\/$/, "")}/invitations/accept?token=${encodeURIComponent(invitation.token)}`;
    await sendVendorMemberInvitationEmail({ to: input.email, vendorName: input.vendor.name, role: input.role, acceptUrl });
  } catch {
    try {
      // Platform-scoped like the suppression note: only deliverable
      // addresses can fail, so a tenant-visible row would reveal which.
      await writeAuditLog({
        actorId: input.actorId,
        actorLabel: "system",
        action: "vendor_member_invitation_email_failed",
        targetType: "VendorMemberInvitation",
        targetId: invitation.invitationId,
        after: auditSnapshot({ vendorId: input.vendor.id }),
      });
    } catch {
      // Deferred work has no caller to report to; the invitation stays pending.
    }
  }
}

export async function revokeVendorMemberInvitationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  requireRecentMfa(auth, { nextPath: SECURITY_PATH });
  const invitationId = text(formData, "invitationId");
  if (!invitationId || invitationId.length > 64) redirect(`${SECURITY_PATH}?error=member_invitation_not_found`);
  const revoked = await revokeVendorMemberInvitation(getDb(), { vendorId: auth.vendor.id, invitationId });
  if (!revoked) redirect(`${SECURITY_PATH}?error=member_invitation_not_found`);
  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "revoke_vendor_member_invitation",
    targetType: "VendorMemberInvitation",
    targetId: invitationId,
  });
  revalidatePath(SECURITY_PATH);
  redirect(`${SECURITY_PATH}?updated=member_invitation_revoked`);
}

export async function resendVendorMemberInvitationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  // Member management can add owners (F-027 step-up).
  requireRecentMfa(auth, { nextPath: "/settings/security" });
  const id = text(formData, "id");
  const db = getDb();
  const member = await db.vendorMember.findFirst({
    where: { id, vendorId: auth.vendor.id, status: "active" },
    include: { user: true },
  });
  if (member?.status !== "active" || member.userId === auth.user.id || member.user.platformRole !== "none") redirect("/settings/security?error=member_invitation_resend_invalid");

  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const rateLimited = await invitationRateLimited(headerStore, appUrl, auth.vendor.id);
  if (rateLimited) redirect(`/settings/security?error=${rateLimited.status === 429 ? "member_invitation_rate_limited" : "member_invitation_unavailable"}`);

  let invitationSent = false;
  try {
    invitationSent = Boolean(await sendPasswordResetLink({
      email: member.user.email,
      appUrl,
      ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerStore.get("user-agent"),
    }));
  } catch {}
  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: invitationSent ? "vendor_member_invitation_resent" : "vendor_member_invitation_resend_email_failed",
    targetType: "VendorMember",
    targetId: member.id,
    after: auditSnapshot({ email: member.user.email, role: member.role, status: member.status }),
  });
  if (invitationSent) {
    revalidatePath("/settings/security");
    redirect("/settings/security?updated=member_invitation_resent");
  }
  redirect("/settings/security?error=member_invitation_resend_failed");
}

/**
 * #462 m7: an owner may lower another member's role directly (fewer
 * privileges take effect at once). Raising a role still goes through an
 * invitation the member must accept.
 */
export async function changeVendorMemberRoleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  requireRecentMfa(auth, { nextPath: SECURITY_PATH });
  const id = text(formData, "id");
  const role = text(formData, "role");
  if (!id || !isVendorMemberRole(role)) redirect(`${SECURITY_PATH}?error=member_role_invalid`);
  const db = getDb();
  const member = await db.vendorMember.findFirst({
    where: { id, vendorId: auth.vendor.id, status: "active" },
    select: { id: true, userId: true, role: true },
  });
  if (!member) redirect(`${SECURITY_PATH}?error=member_not_found`);
  if (member.userId === auth.user.id) redirect(`${SECURITY_PATH}?error=self_role`);
  if (!downgradeRolesFor(member.role).includes(role)) redirect(`${SECURITY_PATH}?error=member_role_upgrade`);

  let updated;
  try {
    updated = await db.$transaction(async (tx) => {
      if (member.role === "owner") {
        const otherOwners = await tx.vendorMember.count({
          where: { vendorId: auth.vendor.id, role: "owner", status: "active", id: { not: member.id } },
        });
        if (otherOwners < 1) throw new LastOwnerInvariantError();
      }
      // The role predicate makes a concurrent change fail instead of being overwritten.
      return tx.vendorMember.update({
        where: { id: member.id, vendorId: auth.vendor.id, status: "active", role: member.role },
        data: { role },
        select: { id: true, role: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof LastOwnerInvariantError || isSerializationConflict(error)) redirect(`${SECURITY_PATH}?error=last_owner`);
    if (isDatabaseTransactionConflict(error)) redirect(`${SECURITY_PATH}?error=member_not_found`);
    throw error;
  }
  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "downgrade_vendor_member_role",
    targetType: "VendorMember",
    targetId: member.id,
    before: auditSnapshot({ role: member.role }),
    after: auditSnapshot({ role: updated.role }),
  });
  revalidatePath(SECURITY_PATH);
  redirect(`${SECURITY_PATH}?updated=member_role_downgraded`);
}

export async function deactivateVendorMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  // Member management can add owners (F-027 step-up).
  requireRecentMfa(auth, { nextPath: "/settings/security" });
  const id = text(formData, "id");
  const confirmation = normalizedEmail(text(formData, "confirmation"));
  const db = getDb();
  const member = await db.vendorMember.findFirst({
    where: { id, vendorId: auth.vendor.id },
    include: { user: true },
  });
  if (!member || member.status !== "active" || member.user.platformRole !== "none") redirect("/settings/security?error=member_not_found");
  if (member.userId === auth.user.id) redirect("/settings/security?error=self_deactivate");
  if (confirmation !== normalizedEmail(member.user.email)) redirect("/settings/security?error=member_confirmation");

  const updated = await (async () => {
    try {
      return await db.$transaction(async (tx) => {
        // This check and deactivation share one Serializable transaction so two owners cannot remove each other concurrently.
        if (member.role === "owner") {
          const activeOwnerCount = await tx.vendorMember.count({
            where: { vendorId: auth.vendor.id, role: "owner", status: "active", id: { not: member.id } },
          });
          if (activeOwnerCount === 0) redirect("/settings/security?error=last_owner");
        }
        const saved = await tx.vendorMember.update({
          where: { id: member.id, vendorId: auth.vendor.id, status: "active", role: member.role },
          data: { status: "inactive", deactivatedAt: new Date() },
        });
        // A session records at most one vendor, and some carry none (invitation
        // sign-ins) or another tenant's (a partner whose portal spans vendors).
        // When the account keeps no other active membership, nothing it signed
        // in with may survive, so revoke by user. Otherwise only this vendor's
        // sessions end; the account still legitimately uses its other memberships.
        const otherActiveMemberships = await tx.vendorMember.count({
          where: { userId: member.userId, status: "active", id: { not: member.id } },
        });
        await tx.userSession.updateMany({
          where: { userId: member.userId, ...(otherActiveMemberships === 0 ? {} : { vendorId: auth.vendor.id }), revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return saved;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (member.role === "owner" && isSerializationConflict(error)) redirect("/settings/security?error=last_owner");
      if (isDatabaseTransactionConflict(error)) redirect("/settings/security?error=member_not_found");
      throw error;
    }
  })();
  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "deactivate_vendor_member",
    targetType: "VendorMember",
    targetId: member.id,
    before: auditSnapshot(member),
    after: auditSnapshot(updated),
  });
  revalidatePath("/settings/security");
  redirect("/settings/security?updated=member_deactivated");
}
