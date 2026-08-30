import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { runBillingCycleJob } from "@/lib/billing-cycle-job";
import { captureOperationalError } from "@/lib/monitoring";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();

  try {
    const result = await runBillingCycleJob();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    try {
      captureOperationalError(error, {
        source: "billing_cycle_job",
        operation: "run",
        status: "failed",
      });
    } catch {
      // Keep the public contract sanitized even if monitoring is unavailable.
    }
    return NextResponse.json({ ok: false, error: "billing_cycle_failed" }, { status: 503 });
  }
}
