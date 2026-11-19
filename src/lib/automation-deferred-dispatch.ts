import { Prisma, type PrismaClient } from "@prisma/client";
import {
  automationCustomerKeyHash,
  deferrableAutomationEventId,
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
 * - Still held (`deferred` again): the row stays for the next round and the
 *   attempt is not counted; after DEFERRED_DISPATCH_MAX_CONSECUTIVE_DEFERRED
 *   in a row the pass stops (merchants are saving right now).
 * - Any other outcome settles the row (deleted). A thrown error counts an
 *   attempt; the attempt reaching DEFERRED_DISPATCH_MAX_ATTEMPTS deletes the
 *   row and reports `dispatch_abandoned` once.
 * - Rows older than DEFERRED_DISPATCH_WINDOW_MS are deleted and reported
 *   (`dispatch_expired`): a welcome e-mail two days late helps nobody.
 *   Rows of a suspended vendor are not taken (they wait, inside the window).
 *
 * The job takes no id from outside: every id comes from the row, and every
 * read and write is bound to the row's vendor.
 */

/** Rows are dispatched for events deferred within this window. */
export const DEFERRED_DISPATCH_WINDOW_MS = 48 * 60 * 60_000;
/** Rows dispatched per job round, taken round-robin between vendors. */
export const DEFERRED_DISPATCH_LIMIT = 50;
/** Failed attempts (a lock wait given up does not count) after which a row is dropped and reported. */
export const DEFERRED_DISPATCH_MAX_ATTEMPTS = 5;
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
  betaFeatureGrants: string[];
};

/** `dispatched`: the rule ran (or another path already had). `settled`: nothing to run any more. */
export type DeferredDispatchOutcome = "dispatched" | "settled" | "deferred" | "failed" | "abandoned";

export type DeferredDispatchSummary = {
  expired: number;
  results: Array<{ status: DeferredDispatchOutcome }>;
};

function report(error: unknown, operation: "dispatch_failed" | "dispatch_abandoned" | "dispatch_expired") {
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

/** Runs one row's rule; `deferred` when the rule row is still held, `dispatched` or `settled` otherwise. */
async function dispatchRow(db: Database, row: DeferredRow): Promise<"dispatched" | "settled" | "deferred"> {
  if (!isDeferrableAutomationTrigger(row.trigger) || !isAutomationTriggerAvailableForVendor(row.trigger, { betaFeatureGrants: row.betaFeatureGrants })) {
    return "settled";
  }
  let results: Array<{ ruleId: string; status: string }>;
  if (row.trigger === "payment_paid") {
    const outcome = await dispatchPaymentPaidAutomationForOrder({ vendorId: row.vendorId, orderId: row.subjectId }, db, { onlyRuleIds: [row.ruleId] });
    if (outcome.status !== "dispatched") return "settled";
    results = outcome.results;
  } else {
    const event = await rebuildEvent(db, { ...row, trigger: row.trigger });
    if (!event) return "settled";
    results = await dispatchAutomationEvent(db, event, { onlyRuleIds: [row.ruleId] });
  }
  const result = results.find((entry) => entry.ruleId === row.ruleId);
  // Still held: the row stays (a failed re-record of an existing row leaves it too).
  if (result?.status === "deferred" || result?.status === "deferred_unrecorded") return "deferred";
  // Ran now (completed, skipped, failed: its log records it and the usual
  // retries apply), ran elsewhere (duplicate), or no longer runs (rule gone,
  // switched off, invalid).
  return result && result.status !== "rule_deleted" && result.status !== "invalid_rule" ? "dispatched" : "settled";
}

/** One failed attempt, bound to the row's vendor; the attempt reaching the limit deletes the row and reports once. */
async function countFailedAttempt(db: Database, row: DeferredRow): Promise<"failed" | "abandoned"> {
  const counted = await db.$queryRaw<Array<{ attempts: number }>>`
    UPDATE "AutomationDeferredDispatch"
    SET "attempts" = "attempts" + 1
    WHERE "id" = ${row.id} AND "vendorId" = ${row.vendorId}
    RETURNING "attempts"
  `;
  if ((counted[0]?.attempts ?? 0) < DEFERRED_DISPATCH_MAX_ATTEMPTS) return "failed";
  await db.automationDeferredDispatch.deleteMany({ where: { id: row.id, vendorId: row.vendorId } });
  report(new Error("Gave up dispatching a deferred automation rule."), "dispatch_abandoned");
  return "abandoned";
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
        AND v."suspendedAt" IS NULL
        ${vendorFilter}
    )
    SELECT "id", "vendorId", "ruleId", "trigger", "subjectId", "attempts", "betaFeatureGrants"
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
      status = await dispatchRow(db, row);
      if (status !== "deferred") await db.automationDeferredDispatch.deleteMany({ where: { id: row.id, vendorId: row.vendorId } });
    } catch (error) {
      report(error, "dispatch_failed");
      // A failure to count it leaves the row as it was for the next round.
      status = await countFailedAttempt(db, row).catch(() => "failed" as const);
    }
    deferredInARow = status === "deferred" ? deferredInARow + 1 : 0;
    summary.results.push({ status });
  }
  return summary;
}
