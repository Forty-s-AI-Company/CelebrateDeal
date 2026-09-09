"use server";

import { revalidatePath } from "next/cache";
import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { protectFacebookAccessToken } from "@/lib/tracking-credentials";

function optionalText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function saveTrackingSettingsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const facebookAccessToken = optionalText(formData, "facebookAccessToken");
  const protectedFacebookAccessToken = facebookAccessToken
    ? protectFacebookAccessToken(vendor.id, facebookAccessToken)
    : null;
  const facebookTestEventCode = optionalText(formData, "facebookTestEventCode");
  await getDb().trackingSetting.upsert({
    where: { vendorId: vendor.id },
    create: {
      vendorId: vendor.id,
      facebookPixelId: optionalText(formData, "facebookPixelId"),
      facebookAccessTokenEncrypted: protectedFacebookAccessToken,
      facebookTestEventCode,
      tiktokPixelId: optionalText(formData, "tiktokPixelId"),
      googleTagManagerId: optionalText(formData, "googleTagManagerId"),
      enablePageView: formData.get("enablePageView") === "on",
      enableLeadEvent: formData.get("enableLeadEvent") === "on",
      enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
    },
    update: {
      facebookPixelId: optionalText(formData, "facebookPixelId"),
      // Empty password fields preserve the existing encrypted token rather
      // than accidentally disabling a production tracking integration.
      ...(protectedFacebookAccessToken ? { facebookAccessTokenEncrypted: protectedFacebookAccessToken } : {}),
      facebookTestEventCode,
      tiktokPixelId: optionalText(formData, "tiktokPixelId"),
      googleTagManagerId: optionalText(formData, "googleTagManagerId"),
      enablePageView: formData.get("enablePageView") === "on",
      enableLeadEvent: formData.get("enableLeadEvent") === "on",
      enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
    },
  });
  revalidatePath("/settings/tracking");
}
