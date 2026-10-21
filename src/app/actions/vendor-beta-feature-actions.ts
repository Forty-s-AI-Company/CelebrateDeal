"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFinanceAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  BETA_GATED_FEATURES,
  normalizeBetaFeatureGrants,
  normalizeVendorFeatureModules,
  type BetaGatedFeature,
} from "@/lib/vendor-feature-toggles";

const ADMIN_PATH = "/admin/vendor-features";
const VENDOR_ID = /^[A-Za-z0-9_-]{1,191}$/u;

/**
 * Platform-admin only: opens or closes closed-beta modules for one vendor
 * (F-001 / F-002). Merchants can never reach this; their own settings action
 * only writes `enabledFeatureModules`.
 */
export async function updateVendorBetaFeatureGrantsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user } = await requireFinanceAdmin();
  const vendorId = String(formData.get("vendorId") ?? "").trim();
  if (!VENDOR_ID.test(vendorId)) redirect(`${ADMIN_PATH}?error=invalid`);
  const requested = formData.getAll("grants").map(String);
  if (requested.some((value) => !(BETA_GATED_FEATURES as readonly string[]).includes(value))) redirect(`${ADMIN_PATH}?error=invalid`);
  const grants: BetaGatedFeature[] = BETA_GATED_FEATURES.filter((feature) => requested.includes(feature));

  const db = getDb();
  const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: { id: true, betaFeatureGrants: true, enabledFeatureModules: true } });
  if (!vendor) redirect(`${ADMIN_PATH}?error=not_found`);
  const before = normalizeBetaFeatureGrants(vendor.betaFeatureGrants);
  // Opening consultation_booking for a consulting customer also switches the
  // merchant toggle on, so the grant takes effect without a second step. The
  // merchant can still hide it again from their own settings.
  const modules = normalizeVendorFeatureModules(vendor.enabledFeatureModules);
  const enabledFeatureModules = grants.includes("consultation_booking") && !before.includes("consultation_booking") && !modules.includes("consultation_booking")
    ? [...modules, "consultation_booking" as const]
    : null;

  // Compare-and-set on the value read above so two admins cannot silently
  // overwrite each other's change.
  const result = await db.vendor.updateMany({
    where: {
      id: vendor.id,
      betaFeatureGrants: { equals: vendor.betaFeatureGrants },
      // The merchant may save its own toggles at the same time; never overwrite them blindly.
      ...(enabledFeatureModules ? { enabledFeatureModules: { equals: vendor.enabledFeatureModules } } : {}),
    },
    data: { betaFeatureGrants: grants, ...(enabledFeatureModules ? { enabledFeatureModules } : {}) },
  });
  if (result.count !== 1) redirect(`${ADMIN_PATH}?error=conflict`);

  await writeAuditLog({
    vendorId: vendor.id,
    actorId: user.id,
    actorLabel: "platform_admin",
    action: "update_vendor_beta_feature_grants",
    targetType: "vendor",
    targetId: vendor.id,
    before: { betaFeatureGrants: before },
    after: { betaFeatureGrants: grants },
  });
  revalidatePath("/", "layout");
  redirect(`${ADMIN_PATH}?saved=1`);
}
