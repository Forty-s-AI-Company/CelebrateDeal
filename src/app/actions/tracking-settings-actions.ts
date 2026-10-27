"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { normalizeTrackingId, type TrackingIdKind } from "@/lib/tracking-integration-ids";

/** 只接受 ID；格式不符時整份設定都不寫入，網址只帶固定的結果代碼。 */
function trackingId(formData: FormData, key: string, kind: TrackingIdKind): string | null {
  const result = normalizeTrackingId(kind, formData.get(key));
  if (!result.ok) redirect("/settings/tracking?tracking=invalid");
  return result.value;
}

export async function saveTrackingSettingsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const settings = {
    // Same bound as the server transport (META_PIXEL_ID_PATTERN).
    facebookPixelId: trackingId(formData, "facebookPixelId", "metaPixel"),
    tiktokPixelId: trackingId(formData, "tiktokPixelId", "tiktok"),
    googleTagManagerId: trackingId(formData, "googleTagManagerId", "gtm"),
    ga4MeasurementId: trackingId(formData, "ga4MeasurementId", "ga4"),
    enableBrowserTags: formData.get("enableBrowserTags") === "on",
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
