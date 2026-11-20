import { requestAuditMeta } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { isVendorBackofficeRole } from "@/lib/vendor-roles";
import { ACTIVE_VENDOR_WHERE } from "@/lib/vendor-suspension-state";

const VENDOR_ID = /^[A-Za-z0-9_-]{1,128}$/u;

/** Why the session is leaving its vendor; the vendor itself is never named in the target tenant's audit. */
export type SessionVendorSwitchReason = "suspended_vendor" | "beta_agreement_pending";

export function switchTargetVendorId(formData: FormData) {
  const value = formData.get("vendorId");
  return typeof value === "string" && VENDOR_ID.test(value.trim()) ? value.trim() : null;
}

/**
 * Moves only this session to another vendor of the signed-in user, from a
 * page that holds the current one (F-036 suspended page, O-11 agreement
 * gate). The target must be an active back-office membership of this user in
 * a vendor that is not suspended. The membership re-check, the session
 * change and the `session_vendor_switched` audit row commit together.
 */
export async function switchSessionVendor(
  auth: { user: { id: string }; session: { id: string } },
  vendorId: string,
  reason: SessionVendorSwitchReason,
) {
  const meta = await requestAuditMeta();
  return getDb().$transaction(async (tx) => {
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
      before: { from: reason }, after: { vendorId: membership.vendorId },
      ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null,
    } });
    return true;
  });
}
