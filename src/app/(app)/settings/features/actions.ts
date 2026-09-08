"use server";

import { revalidatePath } from "next/cache";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { parseVendorFeatureModules } from "@/lib/vendor-feature-toggles";

export async function updateVendorFeaturesAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const raw = formData.get("enabledModules");
  let decoded: unknown;
  try {
    decoded = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    throw new Error("Invalid vendor feature modules.");
  }
  const enabledFeatureModules = parseVendorFeatureModules(decoded);

  // vendorId 永遠取自驗證後的 session，不接受瀏覽器送來的租戶識別碼。
  const result = await getDb().vendor.updateMany({
    where: { id: vendor.id },
    data: { enabledFeatureModules },
  });
  if (result.count !== 1) throw new Error("Vendor feature settings were not updated.");

  revalidatePath("/", "layout");
  return { enabledModules: enabledFeatureModules };
}
