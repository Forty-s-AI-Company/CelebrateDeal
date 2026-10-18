"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { META_PIXEL_ID_PATTERN } from "@/lib/tracking-meta-transport";

function optionalText(formData: FormData, key: string) {
  const value = formData.get(key);
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function saveTrackingSettingsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const facebookPixelId = optionalText(formData, "facebookPixelId");
  // Same bound as the server transport; only a closed result code enters the URL.
  if (facebookPixelId !== null && !META_PIXEL_ID_PATTERN.test(facebookPixelId)) {
    redirect("/settings/tracking?tracking=invalid");
  }
  const settings = {
    facebookPixelId,
    tiktokPixelId: optionalText(formData, "tiktokPixelId"),
    googleTagManagerId: optionalText(formData, "googleTagManagerId"),
    enablePageView: formData.get("enablePageView") === "on",
    enableLeadEvent: formData.get("enableLeadEvent") === "on",
    enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
  };
  await getDb().trackingSetting.upsert({
    where: { vendorId: vendor.id },
    create: { vendorId: vendor.id, ...settings },
    update: settings,
  });
  revalidatePath("/settings/tracking");
}
