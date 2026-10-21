"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { requireRecentMfa } from "@/lib/recent-mfa";
import { saveTrackingCredentialConfiguration, TrackingConfigurationConflict } from "@/lib/tracking-settings";

export async function saveTrackingCredentialAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext("/settings/tracking");
  // The Meta Conversions API token sends customer events off-platform (F-027 step-up).
  requireRecentMfa(auth, { nextPath: "/settings/tracking" });
  const revision = formData.get("credentialRevision");
  const token = formData.get("facebookAccessToken");
  const code = formData.get("facebookTestEventCode");
  let outcome = "saved";
  try {
    if (typeof revision !== "string" || !/^(0|[1-9]\d{0,9})$/u.test(revision)
      || typeof token !== "string" || typeof code !== "string") throw new TypeError("Invalid tracking configuration.");
    await saveTrackingCredentialConfiguration(vendor.id, {
      expectedRevision: Number(revision), token,
      testEventCode: code.trim() || null, clearToken: formData.get("clearTrackingToken") === "on",
    });
  } catch (error) {
    // Only closed result codes enter the URL; never echo input or provider data.
    outcome = error instanceof TrackingConfigurationConflict ? "conflict" : "invalid";
  }
  if (outcome === "saved") revalidatePath("/settings/tracking");
  redirect(`/settings/tracking?tracking=${outcome}`);
}
