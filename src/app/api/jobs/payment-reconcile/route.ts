import { NextResponse } from "next/server";
import { requireCronSecret, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { captureOperationalError } from "@/lib/monitoring";
import { runPendingPaymentReconciliation } from "@/lib/payment-pending-reconciliation";

// A-2 05: asks PayUni about payments whose callback never arrived (at most 20
// per run, round-robin across vendors, no new query after 40 s, each query at
// most 10 s) and applies a paid/failed decision through the payment webhook
// pipeline (Serializable, 15 s timeout, up to 3 attempts). A paid decision can
// schedule its receipt email and `payment_paid` automations with `after()`, so
// this route keeps the 300 s Fluid Compute default like webhook-retry: a lower
// limit could cut those hooks off. The scheduler waits 120 s
// (scripts/scheduled-jobs-runner.mjs), above the run's own budget.
export const maxDuration = 300;

async function reconcilePendingPayments() {
  try {
    const summary = await runPendingPaymentReconciliation();
    return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "payment_reconcile_job", operation: "scan", status: "failed" });
    } catch {
      // The HTTP contract below stays fail-closed even when monitoring is unavailable.
    }
    return NextResponse.json({ ok: false, error: "payment_reconcile_failed" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

/** Vercel Cron entry: Vercel sends GET with `Authorization: Bearer CRON_SECRET`. */
export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  return reconcilePendingPayments();
}

/** Controlled job runner entry (Cloudflare Worker / GitHub Actions schedule or manual operations). */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();
  return reconcilePendingPayments();
}
