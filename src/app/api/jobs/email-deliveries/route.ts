import { NextResponse } from "next/server";
import { requireCronSecret, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { processDueEmailDeliveries, processDuePostLiveFollowups } from "@/lib/email-delivery";
import { processLiveReminderReconciliationJobs } from "@/lib/live-reminder-reconciliation";
import { captureOperationalError } from "@/lib/monitoring";

const SAFE_STATUSES = new Set([
  "sent",
  "failed",
  "exhausted",
  "suppressed",
  "superseded",
  "recovered",
  "missing",
  "not_due",
  "claimed_elsewhere",
]);

const SAFE_RECONCILIATION_STATUSES = new Set([
  "pending",
  "completed",
  "cancelled",
  "superseded",
  "failed",
  "missing",
  "claimed_elsewhere",
]);

async function processEmailDeliveries() {
  try {
    // Materialize due post-live follow-ups before claiming delivery rows.
    const followups = await processDuePostLiveFollowups();
    // Reconcile current reminder revisions first so newly due snapshots can be
    // claimed by the delivery worker in the same bounded cron invocation.
    const reconciliations = await processLiveReminderReconciliationJobs();
    const results = await processDueEmailDeliveries();
    return NextResponse.json({
      ok: true,
      followups: followups.length,
      followupResults: followups.slice(0, 20).map((result) => ({
        status: SAFE_STATUSES.has(result.status) || new Set(["queued", "duplicate", "already_sent"]).has(result.status)
          ? result.status
          : "unknown",
      })),
      reconciled: reconciliations.length,
      reconciliationResults: reconciliations.slice(0, 20).map((result) => ({
        status: SAFE_RECONCILIATION_STATUSES.has(result.status) ? result.status : "unknown",
      })),
      processed: results.length,
      results: results.slice(0, 20).map((result) => ({
        status: SAFE_STATUSES.has(result.status) ? result.status : "unknown",
      })),
    });
  } catch (error) {
    try {
      captureOperationalError(error, {
        source: "email_delivery_job",
        operation: "process_due",
        status: "failed",
      });
    } catch {
      // Keep the HTTP response closed even if monitoring is unavailable.
    }
    return NextResponse.json({ ok: false, processed: 0, results: [] }, { status: 503 });
  }
}

export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  return processEmailDeliveries();
}

export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();
  return processEmailDeliveries();
}
