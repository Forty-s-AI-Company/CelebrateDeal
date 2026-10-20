import { requireCronSecret, unauthorizedJson } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { cachedReadiness } from "@/lib/job-readiness";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * F-142: unlike /api/health (DB ping only), this reports background job lag.
 * Only aggregate timestamps and counts are returned; no tenant, recipient or
 * payload data. Derived from existing delivery rows (no schema change); the
 * unindexed success timestamps are cached for 60 seconds.
 */
export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  try {
    const jobs = await cachedReadiness(getDb());
    return Response.json({ ok: true, checkedAt: new Date().toISOString(), jobs }, { headers: NO_STORE });
  } catch {
    return Response.json({ ok: false, error: "Readiness check failed" }, { status: 503, headers: NO_STORE });
  }
}
