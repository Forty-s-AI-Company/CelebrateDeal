"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestAuditMeta } from "@/lib/audit";
import { requireAuth, requireFinanceAdmin } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { requireRecentMfa } from "@/lib/recent-mfa";
import { isVendorBackofficeRole, signedInHomePath } from "@/lib/vendor-roles";
import { normalizeVendorSuspensionReason, releaseHeldEntitlements, resumeVendor, suspendVendor } from "@/lib/vendor-suspension";
import { ACTIVE_VENDOR_WHERE, VENDOR_SUSPENDED_PATH } from "@/lib/vendor-suspension-state";

const ADMIN_PATH = "/admin/vendor-features";
const VENDOR_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function vendorIdFrom(formData: FormData) {
  const value = formData.get("vendorId");
  return typeof value === "string" && VENDOR_ID.test(value.trim()) ? value.trim() : null;
}

/** Only an id that the database just returned is echoed into the URL. */
function resultPath(params: Record<string, string>, vendorId?: string) {
  const query = new URLSearchParams({ ...params, ...(vendorId ? { vendor: vendorId } : {}) }).toString();
  return `${ADMIN_PATH}?${query}${vendorId ? `#vendor-${vendorId}` : ""}`;
}

/**
 * F-036 (B02-14): platform admin suspends a whole tenant. CSRF, platform
 * role and a 15-minute MFA step-up come before any input is read; the
 * suspension, the learner portal revocation and the audit row commit together.
 */
export async function suspendVendorAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, session } = await requireFinanceAdmin();
  requireRecentMfa({ user, session }, { nextPath: ADMIN_PATH });
  const vendorId = vendorIdFrom(formData);
  const reason = normalizeVendorSuspensionReason(formData.get("reason"));
  if (!vendorId) redirect(resultPath({ suspensionError: "invalid" }));
  if (!reason) redirect(resultPath({ suspensionError: "reason_required" }));
  // The irreversible-looking step needs an explicit confirmation from the form.
  if (formData.get("confirm") !== "on") redirect(resultPath({ suspensionError: "confirm_required" }));
  const meta = await requestAuditMeta();
  const result = await suspendVendor(getDb(), {
    vendorId,
    reason,
    actorUserId: user.id,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });
  revalidatePath("/", "layout");
  if (result.status === "suspended") redirect(resultPath({ suspension: "suspended" }, result.vendorId));
  redirect(resultPath({ suspensionError: result.status }));
}

/** Lifts a suspension; held paid entitlements are granted in the same transaction. */
export async function resumeVendorAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, session } = await requireFinanceAdmin();
  requireRecentMfa({ user, session }, { nextPath: ADMIN_PATH });
  const vendorId = vendorIdFrom(formData);
  if (!vendorId) redirect(resultPath({ suspensionError: "invalid" }));
  const meta = await requestAuditMeta();
  const result = await resumeVendor(getDb(), {
    vendorId,
    actorUserId: user.id,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });
  revalidatePath("/", "layout");
  if (result.status === "resumed") redirect(resultPath(result.complete ? { suspension: "resumed" } : { suspensionError: "release_incomplete" }, result.vendorId));
  redirect(resultPath({ suspensionError: result.status }));
}

/**
 * Repeats the release of held paid entitlements for a vendor that is no
 * longer suspended (after an incomplete release). Idempotent; same guards.
 */
export async function releaseHeldEntitlementsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, session } = await requireFinanceAdmin();
  requireRecentMfa({ user, session }, { nextPath: ADMIN_PATH });
  const vendorId = vendorIdFrom(formData);
  if (!vendorId) redirect(resultPath({ suspensionError: "invalid" }));
  const vendor = await getDb().vendor.findUnique({ where: { id: vendorId }, select: { id: true, suspendedAt: true } });
  if (!vendor) redirect(resultPath({ suspensionError: "not_found" }));
  if (vendor.suspendedAt) redirect(resultPath({ suspensionError: "already_suspended" }, vendor.id));
  const meta = await requestAuditMeta();
  const result = await releaseHeldEntitlements(getDb(), {
    vendorId: vendor.id, actorUserId: user.id, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null,
  });
  revalidatePath(ADMIN_PATH);
  redirect(resultPath(result.complete ? { suspension: "released" } : { suspensionError: "release_incomplete" }, vendor.id));
}

/**
 * F-036: a member of a suspended vendor who also belongs to another, active
 * vendor moves this session to it from the "商家已暫停" page. Only the current
 * session changes, and only to an active back-office membership of the
 * signed-in user in a vendor that is not suspended.
 */
export async function switchFromSuspendedVendorAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth({ nextPath: VENDOR_SUSPENDED_PATH });
  // Only reachable while the session's vendor is suspended; this is not a general vendor switcher.
  if (!auth.suspendedVendor) redirect(signedInHomePath(auth));
  const vendorId = vendorIdFrom(formData);
  if (!vendorId) redirect(VENDOR_SUSPENDED_PATH);
  const meta = await requestAuditMeta();
  // The membership re-check, the session change and its audit row commit together.
  const switched = await getDb().$transaction(async (tx) => {
    const membership = await tx.vendorMember.findFirst({
      where: { userId: auth.user.id, vendorId, status: "active", vendor: { is: ACTIVE_VENDOR_WHERE } },
      select: { vendorId: true, role: true },
    });
    if (!membership || !isVendorBackofficeRole(membership.role)) return false;
    const updated = await tx.userSession.updateMany({
      where: { id: auth.session.id, userId: auth.user.id, revokedAt: null },
      data: { vendorId: membership.vendorId },
    });
    if (updated.count !== 1) return false;
    await tx.auditLog.create({ data: {
      vendorId: membership.vendorId, actorId: auth.user.id, actorLabel: membership.role, action: "session_vendor_switched",
      targetType: "UserSession", targetId: auth.session.id,
      // The suspended tenant is not named in another tenant's audit trail.
      before: { from: "suspended_vendor" }, after: { vendorId: membership.vendorId },
      ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null,
    } });
    return true;
  });
  redirect(switched ? "/dashboard" : VENDOR_SUSPENDED_PATH);
}