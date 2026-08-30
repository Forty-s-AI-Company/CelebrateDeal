"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { hashPasswordAsync } from "@/lib/password";
import { sendPasswordResetLink } from "@/lib/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";

const MEMBER_ROLES = new Set(["owner", "admin", "accountant", "support"]);

class LastOwnerInvariantError extends Error {}

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

export async function createVendorMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const email = normalizedEmail(text(formData, "email"));
  const name = text(formData, "name");
  const role = text(formData, "role", "accountant");
  if (!email || !name || !MEMBER_ROLES.has(role)) redirect("/settings/security?error=member_invalid");

  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  const rateLimited = await checkRateLimit(new Request(appUrl, { headers: rateLimitHeaders }), "vendor-member-invitation", 5, 60_000);
  if (rateLimited) redirect(`/settings/security?error=${rateLimited.status === 429 ? "member_invitation_rate_limited" : "member_invitation_unavailable"}`);

  const db = getDb();
  const existingUser = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, platformRole: true, status: true },
  });
  if (existingUser?.platformRole && existingUser.platformRole !== "none") redirect("/settings/security?error=platform_user");
  if (existingUser && existingUser.status !== "active") {
    // Tenant owners may restore membership in their own vendor, but only the platform may reactivate a globally suspended user account.
    redirect("/settings/security?error=inactive_user");
  }

  const existingMember = existingUser
    ? await db.vendorMember.findUnique({
        where: { vendorId_userId: { vendorId: auth.vendor.id, userId: existingUser.id } },
        include: { user: { select: { email: true } } },
      })
    : null;
  const invitationPasswordHash = existingUser ? null : await hashPasswordAsync(randomBytes(32).toString("base64url"));
  if (existingMember?.userId === auth.user.id && role !== "owner") redirect("/settings/security?error=self_role");

  let savedMember;
  try {
    savedMember = await db.$transaction(async (tx) => {
      const user = existingUser ?? await tx.user.create({
        data: { email, name, passwordHash: invitationPasswordHash!, status: "active" },
      });
      await tx.user.update({ where: { id: user.id }, data: { name: user.name || name } });
      if (existingMember?.status === "active" && existingMember.role === "owner" && role !== "owner") {
        const remainingOwnerCount = await tx.vendorMember.count({
          where: { vendorId: auth.vendor.id, status: "active", role: "owner", id: { not: existingMember.id } },
        });
        if (remainingOwnerCount < 1) throw new LastOwnerInvariantError();
      }
      return tx.vendorMember.upsert({
        where: { vendorId_userId: { vendorId: auth.vendor.id, userId: user.id } },
        create: { vendorId: auth.vendor.id, userId: user.id, role, status: "active" },
        update: { role, status: "active", deactivatedAt: null },
        include: { user: { select: { email: true } } },
      });
    }, {
      // The owner-count predicate and role update must share a Serializable snapshot.
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (error instanceof LastOwnerInvariantError || isDatabaseTransactionConflict(error)) redirect("/settings/security?error=last_owner");
    throw error;
  }

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: existingMember?.status === "inactive" ? "reactivate_vendor_member" : existingMember ? "invite_vendor_member" : "create_vendor_member",
    targetType: "VendorMember",
    targetId: savedMember.id,
    before: auditSnapshot(existingMember ? { id: existingMember.id, email: existingMember.user.email, role: existingMember.role, status: existingMember.status } : null),
    after: auditSnapshot({ id: savedMember.id, email: savedMember.user.email, role: savedMember.role, status: savedMember.status }),
  });

  let invitationSent = false;
  try {
    invitationSent = Boolean(await sendPasswordResetLink({
      email: savedMember.user.email,
      appUrl,
      ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerStore.get("user-agent"),
    }));
  } catch {}
  if (!invitationSent) {
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "vendor_member_invitation_email_failed",
      targetType: "VendorMember",
      targetId: savedMember.id,
      after: auditSnapshot({ email: savedMember.user.email, role: savedMember.role, status: savedMember.status }),
    });
    revalidatePath("/settings/security");
    redirect("/settings/security?error=member_invitation");
  }
  revalidatePath("/settings/security");
  redirect("/settings/security?updated=member");
}

export async function resendVendorMemberInvitationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const id = text(formData, "id");
  const db = getDb();
  const member = await db.vendorMember.findFirst({
    where: { id, vendorId: auth.vendor.id, status: "active" },
    include: { user: true },
  });
  if (member?.status !== "active" || member.userId === auth.user.id || member.user.platformRole !== "none") redirect("/settings/security?error=member_invitation_resend_invalid");

  const headerStore = await headers();
  const appUrl = getCanonicalAppUrl();
  const rateLimitHeaders = new Headers();
  for (const headerName of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(headerName);
    if (value) rateLimitHeaders.set(headerName, value);
  }
  const rateLimited = await checkRateLimit(new Request(appUrl, { headers: rateLimitHeaders }), "vendor-member-invitation", 5, 60_000);
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

export async function deactivateVendorMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
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
        await tx.userSession.updateMany({
          where: { userId: member.userId, vendorId: auth.vendor.id, revokedAt: null },
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
