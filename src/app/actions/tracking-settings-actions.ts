"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { normalizeTrackingId, type TrackingIdKind } from "@/lib/tracking-integration-ids";

type TrackingIdField = "facebookPixelId" | "tiktokPixelId" | "googleTagManagerId" | "ga4MeasurementId";
const TRACKING_ID_FIELDS: ReadonlyArray<readonly [TrackingIdField, TrackingIdKind]> = [
  ["facebookPixelId", "metaPixel"],
  ["tiktokPixelId", "tiktok"],
  ["googleTagManagerId", "gtm"],
  ["ga4MeasurementId", "ga4"],
];

/**
 * 只接受 ID。只驗證這次有變動的欄位：資料表裡早於格式檢查的舊值，若商家原封不動
 * 送回，就照舊保留，不會讓整份設定無法儲存。保留的舊值不會被渲染成追蹤碼
 * （`publicTrackingTags` 與伺服器 transport 都會再驗證格式）。變動過的欄位格式
 * 不符時整份設定都不寫入，網址只帶固定的結果代碼。
 */
function trackingId(formData: FormData, key: TrackingIdField, kind: TrackingIdKind, stored: string | null | undefined): string | null {
  const raw = formData.get(key);
  if (typeof raw === "string" && stored && raw.trim() === stored) return stored;
  const result = normalizeTrackingId(kind, raw);
  if (!result.ok) redirect("/settings/tracking?tracking=invalid");
  return result.value;
}

export async function saveTrackingSettingsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const db = getDb();
  const existing = await db.trackingSetting.findUnique({
    where: { vendorId: vendor.id },
    select: { facebookPixelId: true, tiktokPixelId: true, googleTagManagerId: true, ga4MeasurementId: true },
  });
  const ids = Object.fromEntries(TRACKING_ID_FIELDS.map(([key, kind]) => [key, trackingId(formData, key, kind, existing?.[key])])) as Record<TrackingIdField, string | null>;
  const settings = {
    ...ids,
    enableBrowserTags: formData.get("enableBrowserTags") === "on",
    enablePageView: formData.get("enablePageView") === "on",
    enableLeadEvent: formData.get("enableLeadEvent") === "on",
    enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
  };
  await db.trackingSetting.upsert({
    where: { vendorId: vendor.id },
    create: { vendorId: vendor.id, ...settings },
    update: settings,
  });
  revalidatePath("/settings/tracking");
}
