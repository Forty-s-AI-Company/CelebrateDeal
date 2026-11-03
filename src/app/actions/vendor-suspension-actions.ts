"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestAuditMeta } from "@/lib/audit";
import { requireFinanceAdmin } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { requireRecentMfa } from "@/lib/recent-mfa";
import { normalizeVendorSuspensionReason, resumeVendor, suspendVendor } from "@/lib/vendor-suspension";

const ADMIN_PATH = "/admin/vendor-features";
const VENDOR_ID = /^[A-Za-z0-9_-]{1,191}$/u;

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
  if (result.status === "resumed") redirect(resultPath({ suspension: "resumed" }, result.vendorId));
  redirect(resultPath({ suspensionError: result.status }));
}
