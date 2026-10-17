import { NextResponse } from "next/server";
import { readJsonBody, requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { MetricRegistrationReconcileRequest, reconcileMetricRegistrations } from "@/lib/live-metric-registration-reconcile";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const json = (value: unknown, status: number) => NextResponse.json(value, { status, headers });

/** Scheduler-only: one explicitly scoped bounded page per authenticated call.
 * No global scan or implicit collection enablement. The caller continues the
 * cursor, and starts a fresh pass later; coverage remains the service's unknown.
 */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return json({ error: "Unauthorized" }, 401);
  let body: unknown;
  try { body = await readJsonBody(request, 1024); }
  catch { return json({ error: "Invalid reconciliation request" }, 400); }
  const parsed = MetricRegistrationReconcileRequest.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid reconciliation request" }, 400);
  try {
    const result = await reconcileMetricRegistrations(getDb(), parsed.data);
    // Successful execution does not promise every row is recorded. Pending and
    // terminal gaps remain explicit for the scheduler and later report coverage.
    return json(result, 200);
  } catch {
    return json({ error: "Reconciliation unavailable" }, 503);
  }
}
