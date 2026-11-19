import { Prisma, type PrismaClient } from "@prisma/client";
import {
  AUTOMATION_EXECUTION_RECLAIM_AFTER_MS,
  automationCustomerKeyHash,
  deferrableAutomationEventId,
  deferrableExecutionIdempotencyKey,
  dispatchAutomationEvent,
  isAutomationTriggerAvailableForVendor,
  isDeferrableAutomationTrigger,
  type AutomationEvent,
  type DeferrableAutomationTrigger,
} from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { utcTimestamp } from "@/lib/delayed-step-runs";
import { captureOperationalError } from "@/lib/monitoring";
import { dispatchPaymentPaidAutomationForOrder } from "@/lib/payment-paid-automation";

/**
 * A2-08: the e-mail job's pass over automation rules a request-path event
 * could not claim (docs/domain-workflows.md「自動化規則」).
 *
 * A merchant save holds the rule row FOR UPDATE (step editor, switch on/off,
 * delete, funnel editor; each in a transaction with a 15 s timeout). The
 * execution log's foreign key waits for that lock, so a registration, a
 * consultation booking or no-show, or a payment's `after()` hook used to be
 * held for as long as the save, up to 15 s. Their claim now waits at most
 * about 2 s (claimRuleExecution in automation-workflow.ts) and, past that,
 * records the rule and the event's subject in AutomationDeferredDispatch and
 * goes on. This pass runs those rules later:
 *
 * - The event is rebuilt from server records bound to the row's vendor, never
 *   from the request: the registration through its form (`form: { vendorId }`)
 *   with its stored funnel page, the booking by vendorId (a no-show only while
 *   the booking is still `no_show`, a booking only while it is not
 *   `cancelled`), the order through dispatchPaymentPaidAutomationForOrder
 *   (still paid, nothing refunded, not a test order, vendor not suspended;
 *   amount from the order). A subject gone settles the row without running.
 * - It goes through the same dispatchAutomationEvent with
 *   `onlyRuleIds: [ruleId]`, so only that rule runs, and only while it is
 *   still the vendor's, active and of that trigger (a rule switched off or
 *   deleted by the save settles the row without running). The event id and
 *   the execution log's idempotency key are the live path's, so the rule runs
 *   once whoever claims it first (this pass, a webhook replay, the payment
 *   catch-up, two overlapping job rounds): the others get `duplicate`.
 * - #671 review MINOR-3: both paths pass `rulesUnchangedSince` = the row's
 *   createdAt + DEFERRED_DISPATCH_SAVE_GRACE_MS. The save that caused the
 *   deferral (it commits within its 15 s transaction timeout) still applies;
 *   a rule edited, or switched off and on again, after that never runs late
 *   for this event: the row settles without running.
 * - #671 review MINOR-2 and re-review R-1: before dispatching, the event's
 *   logs for the rule are read by event id, whatever the rule's version
 *   (existingExecution). A finished one settles the row; a `running` one
 *   (another process, or an earlier round of this job, claimed it and may
 *   have stopped) keeps the row without counting an attempt; once it is older
 *   than AUTOMATION_EXECUTION_RECLAIM_AFTER_MS the dispatch reclaims and
 *   finishes it, but only under the same version's key: a stale claim under
 *   another version settles the row and is reported, never run again.
 * - Still held (`deferred` again): the row stays for the next round and the
 *   attempt is not counted; after DEFERRED_DISPATCH_MAX_CONSECUTIVE_DEFERRED
 *   in a row the pass stops (merchants are saving right now).
 * - Any other outcome settles the row (deleted). A thrown error counts an
 *   attempt and moves `nextAttemptAt` back (#671 review MINOR-5:
 *   DEFERRED_DISPATCH_RETRY_DELAYS_MS, 1, 2, 5, 10, then every 30 minutes).
 * - The limit is time, not a count: rows older than
 *   DEFERRED_DISPATCH_WINDOW_MS are deleted and reported (`dispatch_expired`);
 *   a welcome e-mail two days late helps nobody. Rows of a suspended vendor
 *   are not taken (they wait, inside the window).
 *
 * The job takes no id from outside: every id comes from the row, and every
 * read and write is bound to the row's vendor.
 */

/** Rows are dispatched for events deferred within this window. */
export const DEFERRED_DISPATCH_WINDOW_MS = 48 * 60 * 60_000;
/** Rows dispatched per job round, taken round-robin between vendors. */
export const DEFERRED_DISPATCH_LIMIT = 50;
/**
 * #671 review MINOR-5: the wait before the next attempt after the 1st, 2nd,
 * ... failed one (a lock wait given up or a claim still running elsewhere does
 * not count); the last value repeats until the window ends.
 */
export const DEFERRED_DISPATCH_RETRY_DELAYS_MS = [1, 2, 5, 10, 30].map((minutes) => minutes * 60_000);
/**
 * #671 review MINOR-3: how long after the row was written a rule change still
 * counts as the save that caused the deferral: that save commits within its
 * 15 s transaction timeout; 60 s more cover the gap between the database's
 * clock (the row's createdAt) and the application's (the rule's updatedAt),
 * the platform's usual clock-skew allowance (Q-19).
 */
export const DEFERRED_DISPATCH_SAVE_GRACE_MS = 15_000 + 60_000;
/** Lock waits given up in a row after which the round stops taking rows. */
export const DEFERRED_DISPATCH_MAX_CONSECUTIVE_DEFERRED = 3;
/** The pass's own budget, and the latest point of the e-mail round it may run to. */
export const DEFERRED_DISPATCH_DEADLINE_MS = 10_000;
export const DEFERRED_DISPATCH_ROUTE_BUDGET_MS = 55_000;
export const DEFERRED_DISPATCH_MIN_DEADLINE_MS = 3_000;

/** min(10 s, 55 s − elapsed), or null to skip the pass this round when less than 3 s are left. */
export function deferredDispatchDeadline(routeElapsedMs: number): number | null {
  if (!Number.isFinite(routeElapsedMs)) return null;
  const left = DEFERRED_DISPATCH_ROUTE_BUDGET_MS - Math.max(0, routeElapsedMs);
  const deadline = Math.min(DEFERRED_DISPATCH_DEADLINE_MS, left);
  return deadline >= DEFERRED_DISPATCH_MIN_DEADLINE_MS ? deadline : null;
}

type Database = PrismaClient;

type DeferredRow = {
  id: string;
  vendorId: string;
  ruleId: string;
  trigger: string;
  subjectId: string;
  attempts: number;
  createdAt: Date;
  betaFeatureGrants: string[];
};

/**
 * `dispatched`: the rule ran (or another path already had). `settled`: nothing
 * to run any more. `deferred`: the rule row is still held. `running_elsewhere`:
 * a claim of this event is still running (MINOR-2). Only `dispatched` and
 * `settled` delete the row; only `failed` counts an attempt.
 */
export type DeferredDispatchOutcome = "dispatched" | "settled" | "deferred" | "running_elsewhere" | "failed";

export type DeferredDispatchSummary = {
  expired: number;
  results: Array<{ status: DeferredDispatchOutcome }>;
};

function report(error: unknown, operation: "dispatch_failed" | "dispatch_expired" | "dispatch_stale_claim_settled") {
  try {
    captureOperationalError(error, { source: "automation_deferred_dispatch", operation }, operation === "dispatch_failed" ? undefined : { level: "warning" });
  } catch {
    // Monitoring must never change the round's outcome.
  }
}

/** The rule's event for the row's subject, read now and bound to the row's vendor; null when there is none any more. */
async function rebuildEvent(db: Database, row: DeferredRow & { trigger: Exclude<DeferrableAutomationTrigger, "payment_paid"> }): Promise<AutomationEvent | null> {
  const eventId = deferrableAutomationEventId(row.trigger, row.subjectId);
  if (row.trigger === "form_registered") {
    // FormSubmission has no vendorId: the registration is bound through its form.
    const submission = await db.formSubmission.findFirst({
      where: { id: row.subjectId, form: { vendorId: row.vendorId } },
      select: { id: true, email: true },
    });
    if (!submission?.email) return null;
    // The funnel scope stored with the registration (as the route's missed-dispatch path reads it).
    const funnel = await db.funnelSubmission.findFirst({ where: { vendorId: row.vendorId, submissionId: submission.id }, select: { pageId: true } });
    return {
      vendorId: row.vendorId,
      eventId,
      trigger: "form_registered",
      subjectType: "buyer_registration",
      subjectId: submission.id,
      subjectKeyHash: automationCustomerKeyHash(row.vendorId, submission.email),
      recipientEmail: submission.email,
      ...(funnel ? { funnelPageId: funnel.pageId } : {}),
    };
  }
  const booking = await db.consultationBooking.findFirst({
    where: {
      id: row.subjectId,
      vendorId: row.vendorId,
      status: row.trigger === "consultation_no_show" ? "no_show" : { not: "cancelled" },
    },
    select: { id: true, clientEmail: true, meetingUrl: true },
  });
  if (!booking?.clientEmail) return null;
  return {
    vendorId: row.vendorId,
    eventId,
    trigger: row.trigger,
    subjectType: "buyer_registration",
    subjectId: booking.id,
    subjectKeyHash: automationCustomerKeyHash(row.vendorId, booking.clientEmail),
    recipientEmail: booking.clientEmail,
    consultationUrl: booking.meetingUrl ?? undefined,
  };
}

/**
 * #671 re-review R-1: what this event already has for the rule, whatever the
 * rule's version. The execution's idempotency key contains the version, so a
 * save that bumps it between rounds would otherwise hide a claim already made
 * (and the dispatch would claim, and run, the rule a second time). Read by
 * (vendorId, ruleId, eventId) on the `(vendorId, eventId)` index; the event id
 * is the one every caller of the trigger uses.
 * - `none`: no log; dispatch.
 * - `finished`: a `completed`, `skipped` or `failed` log; settle.
 * - `running`: a log claimed within AUTOMATION_EXECUTION_RECLAIM_AFTER_MS; keep.
 * - `stale_current`: only stale `running` logs, one of them under the current
 *   version's key; dispatch, which reclaims and finishes it.
 * - `stale_other`: only stale `running` logs under another version's key;
 *   settle and report (running it under the new key would repeat it).
 */
type ExistingExecution = "none" | "finished" | "running" | "stale_current" | "stale_other";

async function existingExecution(db: Database, row: DeferredRow & { trigger: DeferrableAutomationTrigger }, now: Date): Promise<ExistingExecution> {
  const logs = await db.automationExecutionLog.findMany({
    where: { vendorId: row.vendorId, ruleId: row.ruleId, eventId: deferrableAutomationEventId(row.trigger, row.subjectId) },
    select: { status: true, startedAt: true, idempotencyKey: true },
  });
  if (logs.length === 0) return "none";
  if (logs.some((log) => log.status !== "running")) return "finished";
  const staleBefore = now.getTime() - AUTOMATION_EXECUTION_RECLAIM_AFTER_MS;
  if (logs.some((log) => log.startedAt.getTime() >= staleBefore)) return "running";
  const rule = await db.automationRule.findFirst({ where: { id: row.ruleId, vendorId: row.vendorId }, select: { version: true } });
  if (!rule) return "finished";
  const currentKey = deferrableExecutionIdempotencyKey({ vendorId: row.vendorId, ruleId: row.ruleId, ruleVersion: rule.version, trigger: row.trigger, subjectId: row.subjectId });
  return logs.some((log) => log.idempotencyKey === currentKey) ? "stale_current" : "stale_other";
}

/** Runs one row's rule. */
async function dispatchRow(db: Database, row: DeferredRow, now: Date): Promise<Exclude<DeferredDispatchOutcome, "failed">> {
  if (!isDeferrableAutomationTrigger(row.trigger) || !isAutomationTriggerAvailableForVendor(row.trigger, { betaFeatureGrants: row.betaFeatureGrants })) {
    return "settled";
  }
  const deferrable = { ...row, trigger: row.trigger };
  // R-1: never dispatch over a claim this event already has under another version.
  const existing = await existingExecution(db, deferrable, now);
  if (existing === "finished") return "settled";
  if (existing === "running") return "running_elsewhere";
  if (existing === "stale_other") {
    report(new Error("A stale claim of a deferred automation rule was made under an older rule version; not run again."), "dispatch_stale_claim_settled");
    return "settled";
  }
  // MINOR-3: the save that caused the deferral still counts; a later change does not.
  const options = { onlyRuleIds: [row.ruleId], rulesUnchangedSince: new Date(row.createdAt.getTime() + DEFERRED_DISPATCH_SAVE_GRACE_MS) };
  let results: Array<{ ruleId: string; status: string }>;
  if (row.trigger === "payment_paid") {
    const outcome = await dispatchPaymentPaidAutomationForOrder({ vendorId: row.vendorId, orderId: row.subjectId }, db, options);
    if (outcome.status !== "dispatched") return "settled";
    results = outcome.results;
  } else {
    const event = await rebuildEvent(db, { ...row, trigger: row.trigger });
    if (!event) return "settled";
    results = await dispatchAutomationEvent(db, event, options);
  }
  const result = results.find((entry) => entry.ruleId === row.ruleId);
  // Still held: the row stays (a failed re-record of an existing row leaves it too).
  if (result?.status === "deferred" || result?.status === "deferred_unrecorded") return "deferred";
  // Another process claimed it between the check above and this dispatch: keep the row while that claim runs.
  if (result?.status === "duplicate" && await existingExecution(db, deferrable, now) === "running") return "running_elsewhere";
  // Ran now (completed, skipped, failed: its log records it and the usual
  // retries apply), ran elsewhere (duplicate of a finished log), or no longer
  // runs (rule gone, switched off, changed since, invalid).
  return result && result.status !== "rule_deleted" && result.status !== "invalid_rule" ? "dispatched" : "settled";
}

/** MINOR-5: one failed attempt, bound to the row's vendor: counted, and the row is not taken again before its back-off. */
async function countFailedAttempt(db: Database, row: DeferredRow, now: Date) {
  const delay = DEFERRED_DISPATCH_RETRY_DELAYS_MS[Math.min(row.attempts, DEFERRED_DISPATCH_RETRY_DELAYS_MS.length - 1)]!;
  await db.automationDeferredDispatch.updateMany({
    where: { id: row.id, vendorId: row.vendorId },
    data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + delay) },
  });
}

export async function runDeferredAutomationDispatches(
  options: { now?: Date; vendorId?: string; deadlineMs?: number; limit?: number; clock?: () => number } = {},
  db: Database = getDb(),
): Promise<DeferredDispatchSummary> {
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const now = options.now ?? new Date(startedAt);
  const deadlineMs = Math.min(options.deadlineMs ?? DEFERRED_DISPATCH_DEADLINE_MS, DEFERRED_DISPATCH_DEADLINE_MS);
  const pastDeadline = () => clock() - startedAt >= deadlineMs;
  const limit = Math.max(0, Math.min(options.limit ?? DEFERRED_DISPATCH_LIMIT, DEFERRED_DISPATCH_LIMIT));
  const summary: DeferredDispatchSummary = { expired: 0, results: [] };
  if (limit === 0 || deadlineMs <= 0) return summary;
  const windowStart = new Date(now.getTime() - DEFERRED_DISPATCH_WINDOW_MS);
  const vendorFilter = options.vendorId ? Prisma.sql`AND d."vendorId" = ${options.vendorId}` : Prisma.empty;

  const expired = await db.$executeRaw`
    DELETE FROM "AutomationDeferredDispatch" d
    WHERE d."createdAt" < ${utcTimestamp(windowStart)} ${vendorFilter}
  `;
  summary.expired = expired;
  if (expired > 0) report(new Error("Deferred automation rules expired before they could run."), "dispatch_expired");

  const rows = await db.$queryRaw<DeferredRow[]>`
    WITH "due" AS (
      SELECT d."id", d."vendorId", d."ruleId", d."trigger", d."subjectId", d."attempts", d."createdAt",
             v."betaFeatureGrants",
             ROW_NUMBER() OVER (
               PARTITION BY d."vendorId"
               ORDER BY d."attempts" ASC, d."createdAt" ASC, d."id" ASC
             ) AS "vendorRank"
      FROM "AutomationDeferredDispatch" d
      JOIN "Vendor" v ON v."id" = d."vendorId"
      WHERE d."createdAt" >= ${utcTimestamp(windowStart)}
        -- A row that never failed is always due: its nextAttemptAt is the
        -- database's clock at insert, which may run ahead of this round's.
        -- The back-off (written from this clock) applies after a failure.
        AND (d."attempts" = 0 OR d."nextAttemptAt" <= ${utcTimestamp(now)})
        AND v."suspendedAt" IS NULL
        ${vendorFilter}
    )
    SELECT "id", "vendorId", "ruleId", "trigger", "subjectId", "attempts", "createdAt", "betaFeatureGrants"
    FROM "due"
    WHERE "vendorRank" <= ${limit}
    ORDER BY "vendorRank" ASC, "attempts" ASC, "createdAt" ASC, "id" ASC
    LIMIT ${limit}
  `;

  let deferredInARow = 0;
  for (const row of rows) {
    if (pastDeadline() || deferredInARow >= DEFERRED_DISPATCH_MAX_CONSECUTIVE_DEFERRED) break;
    let status: DeferredDispatchOutcome;
    try {
      status = await dispatchRow(db, row, now);
      if (status === "dispatched" || status === "settled") await db.automationDeferredDispatch.deleteMany({ where: { id: row.id, vendorId: row.vendorId } });
    } catch (error) {
      report(error, "dispatch_failed");
      status = "failed";
      // A failure to count it leaves the row due for the next round.
      await countFailedAttempt(db, row, now).catch(() => undefined);
    }
    deferredInARow = status === "deferred" ? deferredInARow + 1 : 0;
    summary.results.push({ status });
  }
  return summary;
}
