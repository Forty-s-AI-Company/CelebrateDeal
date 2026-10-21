import { requireCronSecret, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { DataRetentionConfigError, dataRetentionEnabled, dataRetentionPolicy, purgeExpiredData } from "@/lib/data-retention";
import { getDb } from "@/lib/db";

const NO_STORE = { "Cache-Control": "no-store" };

async function sweep() {
  // Off unless the deployment opts in (owner decision on retention windows and
  // the privacy-policy wording). A valid secret alone never deletes data.
  if (!dataRetentionEnabled()) {
    return Response.json({ skipped: "disabled" }, { headers: NO_STORE });
  }
  let policy;
  try {
    policy = dataRetentionPolicy();
  } catch (error) {
    if (error instanceof DataRetentionConfigError) {
      return Response.json({ error: "Retention configuration invalid" }, { status: 503, headers: NO_STORE });
    }
    throw error;
  }
  try {
    // Counts only: no ids, tenants, payloads or addresses leave this route.
    return Response.json(await purgeExpiredData(getDb(), { policy }), { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Retention sweep failed" }, { status: 503, headers: NO_STORE });
  }
}

/** Vercel Cron entry: Vercel sends GET with `Authorization: Bearer CRON_SECRET`. */
export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  return sweep();
}

/** Controlled job runner entry (GitHub Actions schedule holds only JOB_SECRET). */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();
  return sweep();
}
