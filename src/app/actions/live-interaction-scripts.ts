"use server";

import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import type { LiveScriptListResult } from "@/lib/live-script-refresh";

/** The live pages list at most this many scripts; the refresh must not hand the studio more. */
const MAX_LISTED_SCRIPTS = 500;

/**
 * Read-only: the published interaction scripts of the session vendor, the same
 * rows and order as the live pages' 互動腳本 select. The studio calls it when
 * the merchant comes back from the tab where they created a script. The vendor
 * comes only from the session; the input is just the CSRF token.
 */
export async function listLiveInteractionScriptsAction(formData: FormData): Promise<LiveScriptListResult> {
  try {
    await assertServerActionSecurity(formData);
  } catch {
    return { status: "error" };
  }
  const vendor = await requireVendorManager();
  const scripts = await getDb().interactionScript.findMany({
    where: { vendorId: vendor.id, status: "published" },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
    take: MAX_LISTED_SCRIPTS,
  });
  return { status: "success", scripts };
}
