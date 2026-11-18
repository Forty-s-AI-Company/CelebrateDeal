import { processDueLearnerNotifications } from "@/lib/learner-notification-job";
import { NextResponse } from "next/server";
import { requireCronSecret, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { processDueEmailDeliveries, processDuePostLiveFollowups, processDueSequenceEmailDeliveries } from "@/lib/email-delivery";
import { processLiveReminderReconciliationJobs } from "@/lib/live-reminder-reconciliation";
import {
  processDueLiveNotifications,
  processLegacyReminderCutovers,
} from "@/lib/live-notification-delivery";
import { captureOperationalError } from "@/lib/monitoring";
import { materializeLineNotifications } from "@/lib/line-notification-materializer";
import { processDueLineDeliveries } from "@/lib/line-notification";
import { getDb } from "@/lib/db";
import { sweepExpiredRegistrationRetryDrafts } from "@/lib/registration-form-retry";
import { releaseExpiredFixedSessionSeats } from "@/lib/live-fixed-sessions-store";
import { queueFixedSessionCancellationNotices } from "@/lib/live-fixed-session-notices";
import {
  backfillEmailSequenceEnrollments,
  EMAIL_SEQUENCE_DEADLINE_MS,
  EMAIL_SEQUENCE_START_CUTOFF_MS,
  onceConfigurationReporter,
} from "@/lib/delayed-step-runs";
import { runDelayedStepWorker, startPendingAutomationRuns } from "@/lib/automation-delayed-steps";
import { formNoShowDeadline, runFormNoShowAutomation, type FormNoShowSummary } from "@/lib/form-no-show-automation";
import { runWatchProgressAutomation, watchProgressDeadline, type WatchProgressSummary } from "@/lib/watch-progress-automation";

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

// Outcomes of materializing live notifications and post-live follow-ups.
const SAFE_MATERIALIZATION_STATUSES = new Set([
  "queued",
  "duplicate",
  "already_sent",
  "reactivated",
  "not_scheduled",
  "not_configured",
  // A post-live follow-up that kept hitting a transient transaction conflict;
  // nothing was written and the next round tries again.
  "conflict",
]);

const SAFE_LEARNER_NOTIFICATION_STATUSES = new Set(["sent","failed","suppressed","indeterminate","queued","not_claimed","persistence_failed","configuration_missing","not_delivered","claimed_elsewhere","completed","page_materialized","not_pending","not_due","retry_scheduled","dead_lettered"]);
const safeCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

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

async function processFixedSessionHousekeeping() {
  let seatsReleased: number | null = null;
  let cancellationNotices: number | null = null;
  try {
    seatsReleased = await releaseExpiredFixedSessionSeats(getDb());
  } catch (error) {
    try {
      captureOperationalError(error, { source: "email_delivery_job", operation: "fixed_session_seat_release", status: "failed" });
    } catch {
      // Monitoring must never change the job outcome.
    }
  }
  try {
    cancellationNotices = (await queueFixedSessionCancellationNotices()).length;
  } catch (error) {
    try {
      captureOperationalError(error, { source: "email_delivery_job", operation: "fixed_session_cancellation_notices", status: "failed" });
    } catch {
      // Monitoring must never change the job outcome.
    }
  }
  return { seatsReleased, cancellationNotices };
}

const SAFE_SEQUENCE_STEP_STATUSES = new Set([
  "queued",
  "skipped_stale",
  "skipped_template",
  "skipped_already_sent",
  "waiting_template",
  "waiting_previous",
  "definition_changed",
  "rescheduled",
  "completed",
  "cancelled",
  "claimed_elsewhere",
  "failed",
  // F-4 delayed automation steps share the worker (and these result slots).
  "executed",
  "condition_not_met",
  "skipped_invalid",
  "waiting_capacity",
]);

/**
 * The whole round may run up to the platform's 300 s (Fluid Compute default).
 * Sequence work (F-3) is the last, most deferrable part of it.
 */
export const maxDuration = 300;

async function reportSequenceFailure(error: unknown, operation: string) {
  try {
    captureOperationalError(error, { source: "email_delivery_job", operation, status: "failed" });
  } catch {
    // Monitoring must never change the job outcome.
  }
}

/**
 * F-3 Email 追銷序列, at the very end of the round: add verified registrants
 * the verify route missed, run due steps (F-4 delayed automation steps too,
 * on the same worker and e-mail capacity), then send sequence and delayed
 * automation e-mails on their own quota. Everything time-bound has been handled before it. It is skipped
 * when the round already ran past EMAIL_SEQUENCE_START_CUTOFF_MS, every part
 * stops at EMAIL_SEQUENCE_DEADLINE_MS, and no part failing changes the
 * response of the rest of the round.
 */
async function processEmailSequences(startedAt: number) {
  if (Date.now() - startedAt > EMAIL_SEQUENCE_START_CUTOFF_MS) {
    // m4: visible in monitoring when rounds keep running too long for it.
    try {
      captureOperationalError(new Error("Email sequence work skipped: the round ran past its start cutoff."), {
        source: "email_delivery_job",
        operation: "email_sequences_skipped",
        status: "skipped",
      });
    } catch {
      // Monitoring must never change the job outcome.
    }
    return { skipped: true, enrolled: 0, automationRunsStarted: 0, steps: [] as Array<{ status: string }>, dispatched: [] as Array<{ status: string }> };
  }
  const deadline = startedAt + EMAIL_SEQUENCE_DEADLINE_MS;
  // One configuration report per round, whichever part meets the problem first.
  const onConfigurationError = onceConfigurationReporter();
  let enrollments: Array<{ status: string }> = [];
  let pendingRuns: Array<{ status: string }> = [];
  let steps: Array<{ status: string }> = [];
  let dispatched: Array<{ status: string }> = [];
  try {
    enrollments = await backfillEmailSequenceEnrollments({ deadline, onConfigurationError });
  } catch (error) {
    await reportSequenceFailure(error, "email_sequence_backfill");
  }
  try {
    // Q-13: delayed-step runs events still owe (the rule row was held by a
    // merchant save), before the worker so a step already due runs this round.
    pendingRuns = await startPendingAutomationRuns({ deadline });
  } catch (error) {
    await reportSequenceFailure(error, "automation_pending_runs");
  }
  try {
    // Sequence and automation runs (F-4) in one worker round.
    steps = await runDelayedStepWorker({ deadline, onConfigurationError });
  } catch (error) {
    await reportSequenceFailure(error, "delayed_step_runs");
  }
  try {
    dispatched = await processDueSequenceEmailDeliveries({ deadline });
  } catch (error) {
    await reportSequenceFailure(error, "sequence_email_dispatch");
  }
  return {
    skipped: false,
    enrolled: enrollments.filter((result) => result.status === "enrolled").length,
    automationRunsStarted: pendingRuns.filter((result) => result.status === "started").length,
    steps,
    dispatched,
  };
}

/**
 * Q-11 `form_no_show`: right after the post-live follow-ups (both run on
 * "a registrant's session ended"), before this round's dispatch sends the
 * automation e-mails it queues. Bounded by its own deadline, skipped once the
 * round ran too long, and never changes the rest of the round.
 */
async function processFormNoShows(startedAt: number): Promise<FormNoShowSummary | null> {
  const deadlineMs = formNoShowDeadline(Date.now() - startedAt);
  if (deadlineMs === null) return null;
  try {
    return await runFormNoShowAutomation({ deadlineMs });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "email_delivery_job", operation: "form_no_show", status: "failed" });
    } catch {
      // Monitoring must never change the job outcome.
    }
    return null;
  }
}

/**
 * Q-11 `viewer_watch_progress` and `webinar_attended_duration_gte` (one pass
 * over the same watch time): right after the no-show pass, before this
 * round's dispatch sends the automation e-mails it queues. Bounded by its own
 * deadline (ends by 45 s into the round), skipped once the round ran too
 * long, and never changes the rest of the round.
 */
async function processWatchProgress(startedAt: number): Promise<WatchProgressSummary | null> {
  const deadlineMs = watchProgressDeadline(Date.now() - startedAt);
  if (deadlineMs === null) return null;
  try {
    return await runWatchProgressAutomation({ deadlineMs });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "email_delivery_job", operation: "watch_progress", status: "failed" });
    } catch {
      // Monitoring must never change the job outcome.
    }
    return null;
  }
}

async function processEmailDeliveries() {
  const startedAt = Date.now();
  try {
    // Cut over only proven-equivalent legacy schedules before materializing the
    // canonical rule-scoped snapshots in this bounded invocation.
    const cutovers = await processLegacyReminderCutovers();
    let dueLiveNotifications: Array<{ status: string }> = [];
    try {
      dueLiveNotifications = await processDueLiveNotifications({ includeFuture: false, writeBudget: 100 });
    } catch (error) {
      // A failed due-notification pass must not abort the rest of the round
      // (dispatch, LINE, learner notifications) for every tenant.
      try {
        captureOperationalError(error, { source: "email_delivery_job", operation: "due_live_notifications", status: "failed" });
      } catch {
        // Monitoring must never change the job outcome.
      }
    }
    // 指定場次: give back unverified seats whose window passed and queue the
    // notices of cancelled sessions before this round's dispatch sends them.
    const fixedSessions = await processFixedSessionHousekeeping();
    let followups: Array<{ status: string }> = [];
    try {
      followups = await processDuePostLiveFollowups();
    } catch (error) {
      // A failed follow-up pass (one tenant's data, a conflict) must not stop
      // this round's dispatch, LINE or learner notifications for every tenant.
      try {
        captureOperationalError(error, { source: "email_delivery_job", operation: "post_live_followups", status: "failed" });
      } catch {
        // Monitoring must never change the job outcome.
      }
    }
    const formNoShow = await processFormNoShows(startedAt);
    const watchProgress = await processWatchProgress(startedAt);
    const reconciliations = await processLiveReminderReconciliationJobs();
    const results = await processDueEmailDeliveries();
    const lineMaterialized = await materializeLineNotifications();
    const lineResults = await processDueLineDeliveries();
    const learnerNotifications = await processDueLearnerNotifications();
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
    // Expired registration retry ciphertext is deleted on this schedule, not
    // only when later registration traffic happens to purge it.
    let registrationRetryDraftsPurged: number | null = null;
    try {
      registrationRetryDraftsPurged = await sweepExpiredRegistrationRetryDrafts(getDb());
    } catch (error) {
      try {
        captureOperationalError(error, { source: "email_delivery_job", operation: "registration_retry_purge", status: "failed" });
      } catch {
        // Purge is best effort after due dispatch has completed.
      }
    }
    // F-3: last, after every time-bound pass of the round.
    const sequences = await processEmailSequences(startedAt);
    return NextResponse.json({
      ok: true,
      cutovers: cutovers.length,
      cutoverResults: cutovers.slice(0, 20).map((result) => ({
        status: SAFE_CUTOVER_STATUSES.has(result.status) ? result.status : "unknown",
      })),
      liveNotifications: liveNotifications.length,
      liveNotificationResults: liveNotifications.slice(0, 20).map((result) => ({
        status: SAFE_STATUSES.has(result.status) || SAFE_MATERIALIZATION_STATUSES.has(result.status)
          ? result.status
          : "unknown",
      })),
      followups: followups.length,
      followupConflicts: followups.filter((result) => result.status === "conflict").length,
      followupResults: followups.slice(0, 20).map((result) => ({
        status: SAFE_STATUSES.has(result.status) || SAFE_MATERIALIZATION_STATUSES.has(result.status)
          ? result.status
          : "unknown",
      })),
      sequenceSkipped: sequences.skipped,
      sequenceEnrollments: safeCount(sequences.enrolled),
      automationPendingRunsStarted: safeCount(sequences.automationRunsStarted),
      sequenceSteps: sequences.steps.length,
      sequenceStepResults: sequences.steps.slice(0, 20).map((result) => ({
        status: SAFE_SEQUENCE_STEP_STATUSES.has(result.status) ? result.status : "unknown",
      })),
      sequenceDispatched: sequences.dispatched.length,
      sequenceDispatchResults: sequences.dispatched.slice(0, 20).map((result) => ({
        status: SAFE_STATUSES.has(result.status) ? result.status : "unknown",
      })),
      reconciled: reconciliations.length,
      reconciliationResults: reconciliations.slice(0, 20).map((result) => ({
        status: SAFE_RECONCILIATION_STATUSES.has(result.status) ? result.status : "unknown",
      })),
      processed: results.length,
      results: results.slice(0, 20).map((result) => ({
        status: SAFE_STATUSES.has(result.status) ? result.status : "unknown",
      })),
      learnerNotificationsProcessed: learnerNotifications.results.length,
      learnerNotificationResults: learnerNotifications.results.slice(0,20).map(result => ({ status: SAFE_LEARNER_NOTIFICATION_STATUSES.has(result.status) ? result.status : "unknown" })),
      learnerNotificationBacklog: learnerNotifications.backlog ? {
        sources: safeCount(learnerNotifications.backlog.sources),
        proofs: safeCount(learnerNotifications.backlog.proofs),
        deliveries: safeCount(learnerNotifications.backlog.deliveries),
      } : null,
      lineMaterialized: lineMaterialized.length,
      lineProcessed: lineResults.length,
      lineResults: lineResults.slice(0, 20).map((result) => ({
        status: SAFE_STATUSES.has(result.status) ? result.status : "unknown",
      })),
      registrationRetryDraftsPurged: safeCount(registrationRetryDraftsPurged),
      fixedSessionSeatsReleased: safeCount(fixedSessions.seatsReleased),
      fixedSessionCancellationNotices: safeCount(fixedSessions.cancellationNotices),
      // Counts only: no vendor, registration or rule data.
      formNoShow: formNoShow ? {
        candidates: safeCount(formNoShow.candidates),
        examined: safeCount(formNoShow.examined),
        completed: safeCount(formNoShow.completed),
        failed: safeCount(formNoShow.failed),
        errors: safeCount(formNoShow.errors),
      } : null,
      watchProgress: watchProgress ? {
        candidates: safeCount(watchProgress.candidates),
        examined: safeCount(watchProgress.examined),
        completed: safeCount(watchProgress.completed),
        // #663 review NIT-1: rules held back because the same person already ran them.
        duplicatePerson: safeCount(watchProgress.duplicatePerson),
        failed: safeCount(watchProgress.failed),
        errors: safeCount(watchProgress.errors),
      } : null,
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
