import { NextResponse } from "next/server";
import { requireCronSecret, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { processDueEmailDeliveries, processDuePostLiveFollowups } from "@/lib/email-delivery";
import { processLiveReminderReconciliationJobs } from "@/lib/live-reminder-reconciliation";
import {
  processDueLiveNotifications,
  processLegacyReminderCutovers,
} from "@/lib/live-notification-delivery";
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

const SAFE_CUTOVER_STATUSES = new Set([
  "cutover",
  "precondition",
  "no_equivalent_rule",
  "legacy_sent_or_sending",
  "capacity",
  "duplicate_conflict",
  "invalid_snapshot",
  "failed",
]);

async function processEmailDeliveries() {
  try {
    // Cut over only proven-equivalent legacy schedules before materializing the
    // canonical rule-scoped snapshots in this bounded invocation.
    const cutovers = await processLegacyReminderCutovers();
    const dueLiveNotifications = await processDueLiveNotifications({ includeFuture: false, writeBudget: 100 });
    const followups = await processDuePostLiveFollowups();
    const reconciliations = await processLiveReminderReconciliationJobs();
    const results = await processDueEmailDeliveries();
    let futureRepairs: Array<{ status: string }> = [];
    try {
      futureRepairs = await processDueLiveNotifications({ includeFuture: true, writeBudget: 100 });
    } catch (error) {
      try {
        captureOperationalError(error, { source: "email_delivery_job", operation: "future_repair", status: "failed" });
      } catch {
        // Future repair is best effort after due dispatch has completed.
      }
    }
    const liveNotifications = [...dueLiveNotifications, ...futureRepairs];
    return NextResponse.json({
      ok: true,
      cutovers: cutovers.length,
      cutoverResults: cutovers.slice(0, 20).map((result) => ({
        status: SAFE_CUTOVER_STATUSES.has(result.status) ? result.status : "unknown",
      })),
      liveNotifications: liveNotifications.length,
      liveNotificationResults: liveNotifications.slice(0, 20).map((result) => ({
        status: SAFE_STATUSES.has(result.status) || new Set(["queued", "duplicate", "already_sent"]).has(result.status)
          ? result.status
          : "unknown",
      })),
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
