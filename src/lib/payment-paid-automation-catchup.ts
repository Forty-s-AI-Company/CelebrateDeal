import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AUTOMATION_EXECUTION_RECLAIM_AFTER_MS, parseAutomationRule } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { utcTimestamp } from "@/lib/delayed-step-runs";
import { INVENTORY_EXPIRY_RECONCILE_EVENT_PREFIX } from "@/lib/inventory-reservations";
import { captureOperationalError } from "@/lib/monitoring";
import { dispatchPaymentPaidAutomationForOrder } from "@/lib/payment-paid-automation";

/**
 * Q-10: catch-up for the `payment_paid` automation (docs/domain-workflows.md
 * 「自動化規則」→「付款完成」→「補跑」, docs/product/delayed-steps-design.md
 * §8 F-4 PR 3 point 4).
 *
 * The live path runs the rules once, in an `after()` hook, after the payment
 * webhook committed the order's first paid transition. When that hook never
 * runs or is stopped mid-run (the platform ends the function after the
 * response, a database outage), nothing retries it. The webhook-retry job
 * calls `runPaymentPaidAutomationCatchup` every run to find those orders and
 * run them through the same `dispatchPaymentPaidAutomationForOrder`, so the
 * event id (`payment-paid:{orderId}`) and every idempotency key are the live
 * path's: the execution log's unique (vendorId, idempotencyKey) claim lets
 * only one of them run a rule, and every action output (tag upsert,
 * deterministic voucher id, LINE idempotency key, deterministic e-mail id) is
 * bound to that one log.
 *
 * An order qualifies when all of these hold (every condition bound to the
 * order's own vendor):
 * - it is a canonical order still `paid` with nothing refunded, not a test
 *   order, and its vendor is not suspended;
 * - its `payment.paid` event came from the payment webhook (the live
 *   trigger's `firstPaidOrderIdOf`): not the inventory-expiry job's
 *   transition, and not recorded while the vendor was suspended
 *   (`fulfillmentHeld`, which never triggers and is not run after resume);
 * - it was paid (`paidAt`) and recorded (the event's `createdAt`) between
 *   PAYMENT_PAID_CATCHUP_MAX_AGE_MS and PAYMENT_PAID_CATCHUP_MIN_AGE_MS ago;
 * - the vendor has an active, vendor-wide, parseable `payment_paid` rule that
 *   has not changed since the payment was recorded (`updatedAt` at or before
 *   it: a rule created, edited or switched back on later never runs late for
 *   an earlier payment) and whose execution log for the order is missing,
 *   or is a `running` one older than the reclaim threshold (a run that died),
 *   or is a first attempt that ended `failed / action_failed` (an action threw,
 *   for example on a transient database error) at least
 *   PAYMENT_PAID_CATCHUP_FAILED_RETRY_AFTER_MS ago.
 *
 * The failed retry happens at most once without a new column: a log the
 * catch-up has never reclaimed still has `startedAt = createdAt`, and the
 * reclaim moves `startedAt`, so the same log never qualifies again. Other
 * failures (`unsubscribe_url_unavailable`, a deployment setting) are not
 * transient and are never retried. Only the rules the scan chose run
 * (`onlyRuleIds`), so another rule's failed log is never reclaimed on the way.
 *
 * Each run takes at most PAYMENT_PAID_CATCHUP_ORDER_LIMIT orders, round-robin
 * across vendors (each vendor's oldest order first, then each vendor's
 * second, ...), and stops starting new orders at its deadline; the rest wait
 * for the next run.
 */

/**
 * Orders recorded less than this long ago are left to the live `after()`
 * hook. The longest route that registers it (webhook-retry) has a 300 s
 * `maxDuration`, so by then the hook has finished or been stopped; a
 * `running` log it left is then older than the 5-minute reclaim threshold
 * (AUTOMATION_EXECUTION_RECLAIM_AFTER_MS) and can be reclaimed.
 */
export const PAYMENT_PAID_CATCHUP_MIN_AGE_MS = 10 * 60_000;
/**
 * Orders paid longer ago than this are not run any more: a "thank you for
 * your purchase" tag, voucher or message two days late is more confusing
 * than useful, and the job (every 5 minutes) has had hundreds of chances.
 */
export const PAYMENT_PAID_CATCHUP_MAX_AGE_MS = 48 * 60 * 60_000;
/** Orders run per job run, shared fairly across vendors. */
export const PAYMENT_PAID_CATCHUP_ORDER_LIMIT = 20;
/** No new order starts after this long; the rest wait for the next run. */
export const PAYMENT_PAID_CATCHUP_DEADLINE_MS = 60_000;
/** A first-attempt `failed` execution is retried once, this long after it ended. */
export const PAYMENT_PAID_CATCHUP_FAILED_RETRY_AFTER_MS = 10 * 60_000;
/** Failure codes worth one retry: an action threw (transient database or outbox errors). */
export const PAYMENT_PAID_CATCHUP_RETRYABLE_ERROR_CODES = ["action_failed"] as const;
/**
 * The webhook-retry route must answer before the scheduler gives up
 * (scripts/scheduled-jobs-runner.mjs REQUEST_TIMEOUT_MS = 120 s). The
 * catch-up runs last: it is skipped once the route has used this long ...
 */
export const PAYMENT_PAID_CATCHUP_ROUTE_SKIP_AFTER_MS = 60_000;
/** ... and otherwise stops starting orders when the route reaches this. */
export const PAYMENT_PAID_CATCHUP_ROUTE_RESPONSE_BUDGET_MS = 100_000;
/** Scan passes when unparseable rules have to be left out (they never write a log). */
const MAX_SCAN_PASSES = 3;

/**
 * The catch-up's own deadline for a route that has already used
 * `routeElapsedMs`, or null to skip it this run: min(60 s, 100 s − elapsed).
 */
export function paymentPaidCatchupDeadline(routeElapsedMs: number): number | null {
  if (!Number.isFinite(routeElapsedMs) || routeElapsedMs >= PAYMENT_PAID_CATCHUP_ROUTE_SKIP_AFTER_MS) return null;
  return Math.min(PAYMENT_PAID_CATCHUP_DEADLINE_MS, PAYMENT_PAID_CATCHUP_ROUTE_RESPONSE_BUDGET_MS - Math.max(0, routeElapsedMs));
}

export type PaymentPaidCatchupSummary = {
  /** Orders the scan found. */
  candidates: number;
  /** Orders dispatched this run (at most `candidates`; the rest hit the deadline). */
  examined: number;
  /** Rule results across the dispatched orders. */
  completed: number;
  skipped: number;
  failed: number;
  duplicate: number;
  /** Orders the dispatch no longer accepted (refunded, rule switched off, ... since the scan). */
  notApplicable: number;
  /** Orders whose dispatch threw (reported; the next run tries again). */
  errors: number;
};

type CatchupDb = ReturnType<typeof getDb>;

type CatchupCandidate = { vendorId: string; orderId: string; recordedAt: Date; ruleIds: string[] };

/** What a catch-up report says. Only monitoring.ts SAFE_CONTEXT_KEYS reach Sentry: `source` + `operation`. */
export type PaymentPaidCatchupReport = "catchup_dispatch" | "catchup_rule_failed";

function report(error: unknown, operation: PaymentPaidCatchupReport, fingerprint?: string[]) {
  try {
    captureOperationalError(error, { source: "payment_paid_automation", operation }, fingerprint ? { fingerprint } : undefined);
  } catch {
    // Monitoring must never stop the job.
  }
}

/** A fixed error kind: a Prisma code, an error class name, or "unknown"; never a message. */
function errorKind(error: unknown) {
  if (error && typeof error === "object") {
    const code = "code" in error ? String((error as { code: unknown }).code) : "";
    if (/^P\d{4}$/.test(code)) return code;
    const name = error instanceof Error ? error.name : "";
    if (/^[A-Za-z]{1,60}$/.test(name)) return name;
  }
  return "unknown";
}

/**
 * Groups repeated reports of one order's failing dispatch: an opaque digest
 * of vendor and order (no ids reach Sentry) plus the error kind.
 */
export function catchupDispatchFingerprint(input: { vendorId: string; orderId: string }, error: unknown) {
  const order = createHash("sha256").update(`${input.vendorId}:${input.orderId}`).digest("hex").slice(0, 16);
  return ["payment-paid-catchup-dispatch", order, errorKind(error)];
}

function scan(db: CatchupDb, now: Date, limit: number, excludedRuleIds: string[]) {
  const newest = new Date(now.getTime() - PAYMENT_PAID_CATCHUP_MIN_AGE_MS);
  const oldest = new Date(now.getTime() - PAYMENT_PAID_CATCHUP_MAX_AGE_MS);
  const staleRunningBefore = new Date(now.getTime() - AUTOMATION_EXECUTION_RECLAIM_AFTER_MS);
  const failedRetryBefore = new Date(now.getTime() - PAYMENT_PAID_CATCHUP_FAILED_RETRY_AFTER_MS);
  const inventoryPaidKeyPrefix = `payment.paid:${INVENTORY_EXPIRY_RECONCILE_EVENT_PREFIX}`;
  const retryableCodes = [...PAYMENT_PAID_CATCHUP_RETRYABLE_ERROR_CODES];
  // Every join is bound to the order's vendor. Only vendors with an active
  // vendor-wide payment_paid rule are scanned (each through the
  // (vendorId, paidAt) index); no vendor is cut off by a rule-count cap. The
  // per-vendor rank makes the cap fair: each vendor's oldest order comes
  // before any vendor's second.
  return db.$queryRaw<CatchupCandidate[]>(Prisma.sql`
    WITH "ruleVendor" AS (
      SELECT DISTINCT ar."vendorId"
      FROM "AutomationRule" ar
      WHERE ar."trigger" = 'payment_paid' AND ar."isActive" = true AND ar."funnelPageId" IS NULL
    ),
    "candidate" AS (
      SELECT o."vendorId", o."id" AS "orderId", o."paidAt", e."createdAt" AS "recordedAt", rr."ruleIds",
             ROW_NUMBER() OVER (PARTITION BY o."vendorId" ORDER BY o."paidAt" ASC, o."id" ASC) AS "vendorRank"
      FROM "ruleVendor" rv
      JOIN "CommerceOrder" o ON o."vendorId" = rv."vendorId"
      JOIN "Vendor" v ON v."id" = o."vendorId" AND v."suspendedAt" IS NULL
      JOIN LATERAL (
        SELECT ev."createdAt", ev."dedupKey", ev."sanitizedData"
        FROM "CommerceOrderEvent" ev
        WHERE ev."vendorId" = o."vendorId" AND ev."orderId" = o."id" AND ev."eventType" = 'payment.paid'
        ORDER BY ev."createdAt" ASC, ev."id" ASC
        LIMIT 1
      ) e ON TRUE
      JOIN LATERAL (
        SELECT array_agg(r."id" ORDER BY r."createdAt" ASC, r."id" ASC) AS "ruleIds"
        FROM "AutomationRule" r
        WHERE r."vendorId" = o."vendorId"
          AND r."trigger" = 'payment_paid'
          AND r."isActive" = true
          AND r."funnelPageId" IS NULL
          AND r."updatedAt" <= e."createdAt"
          AND NOT (r."id" = ANY(${excludedRuleIds}::text[]))
          AND NOT EXISTS (
            SELECT 1 FROM "AutomationExecutionLog" l
            WHERE l."vendorId" = o."vendorId"
              AND l."eventId" = 'payment-paid:' || o."id"
              AND l."ruleId" = r."id"
              AND NOT (l."status" = 'running' AND l."startedAt" < ${utcTimestamp(staleRunningBefore)})
              AND NOT (
                l."status" = 'failed'
                AND l."errorCode" = ANY(${retryableCodes}::text[])
                AND l."startedAt" = l."createdAt"
                AND l."completedAt" < ${utcTimestamp(failedRetryBefore)}
              )
          )
      ) rr ON rr."ruleIds" IS NOT NULL
      WHERE o."status" = 'paid'
        AND o."refundedAmountCents" = 0
        AND o."isTestOrder" = false
        AND o."paidAt" >= ${utcTimestamp(oldest)}
        AND o."paidAt" <= ${utcTimestamp(newest)}
        AND e."createdAt" >= ${utcTimestamp(oldest)}
        AND e."createdAt" <= ${utcTimestamp(newest)}
        AND NOT starts_with(e."dedupKey", ${inventoryPaidKeyPrefix})
        AND (e."sanitizedData" IS NULL OR e."sanitizedData"->>'fulfillmentHeld' IS NULL)
    )
    SELECT "vendorId", "orderId", "recordedAt", "ruleIds"
    FROM "candidate"
    WHERE "vendorRank" <= ${limit}
    ORDER BY "vendorRank" ASC, "paidAt" ASC, "orderId" ASC
    LIMIT ${limit}
  `);
}

/**
 * The scan's candidates with only parseable rules. An unparseable rule never
 * writes a log, so it would be chosen again every run and take slots: it is
 * left out and the scan repeats (at most MAX_SCAN_PASSES times).
 */
async function findCandidates(db: CatchupDb, now: Date, limit: number): Promise<CatchupCandidate[]> {
  const excluded: string[] = [];
  for (let pass = 1; ; pass += 1) {
    const rows = await scan(db, now, limit, excluded);
    const ruleIds = [...new Set(rows.flatMap((row) => row.ruleIds))];
    if (ruleIds.length === 0) return [];
    const rules = await db.automationRule.findMany({
      where: { id: { in: ruleIds }, vendorId: { in: [...new Set(rows.map((row) => row.vendorId))] }, trigger: "payment_paid" },
      select: { id: true, vendorId: true, version: true, condition: true, actions: true },
    });
    const runnable = new Map(rules.filter((rule) => parseAutomationRule(rule) !== null).map((rule) => [rule.id, rule.vendorId]));
    const unparseable = ruleIds.filter((id) => !runnable.has(id));
    if (unparseable.length === 0 || pass >= MAX_SCAN_PASSES) {
      return rows
        .map((row) => ({ ...row, ruleIds: row.ruleIds.filter((id) => runnable.get(id) === row.vendorId) }))
        .filter((row) => row.ruleIds.length > 0);
    }
    excluded.push(...unparseable);
  }
}

/**
 * One catch-up pass. A thrown scan rejects (the job reports it); a thrown
 * dispatch is reported and the pass goes on with the next order.
 */
export async function runPaymentPaidAutomationCatchup(options: {
  db?: CatchupDb;
  now?: Date;
  limit?: number;
  deadlineMs?: number;
  clock?: () => number;
} = {}): Promise<PaymentPaidCatchupSummary> {
  const db = options.db ?? getDb();
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const now = options.now ?? new Date(startedAt);
  const limit = Math.max(0, Math.min(options.limit ?? PAYMENT_PAID_CATCHUP_ORDER_LIMIT, PAYMENT_PAID_CATCHUP_ORDER_LIMIT));
  const deadlineMs = Math.min(options.deadlineMs ?? PAYMENT_PAID_CATCHUP_DEADLINE_MS, PAYMENT_PAID_CATCHUP_DEADLINE_MS);
  const summary: PaymentPaidCatchupSummary = {
    candidates: 0, examined: 0, completed: 0, skipped: 0, failed: 0, duplicate: 0, notApplicable: 0, errors: 0,
  };
  if (limit === 0 || deadlineMs <= 0) return summary;
  const candidates = await findCandidates(db, now, limit);
  summary.candidates = candidates.length;
  for (const candidate of candidates) {
    if (clock() - startedAt >= deadlineMs) break;
    summary.examined += 1;
    try {
      const outcome = await dispatchPaymentPaidAutomationForOrder(
        { vendorId: candidate.vendorId, orderId: candidate.orderId },
        db,
        { rulesUnchangedSince: candidate.recordedAt, onlyRuleIds: candidate.ruleIds },
      );
      if (outcome.status !== "dispatched") {
        summary.notApplicable += 1;
        continue;
      }
      for (const result of outcome.results) {
        if (result.status === "completed") summary.completed += 1;
        else if (result.status === "skipped") summary.skipped += 1;
        else if (result.status === "failed") summary.failed += 1;
        else if (result.status === "duplicate") summary.duplicate += 1;
      }
      // Which rule and why stays on its execution log, visible to the merchant.
      if (outcome.results.some((result) => result.status === "failed")) {
        report(new Error("Payment-paid automation catch-up rule failed."), "catchup_rule_failed");
      }
    } catch (error) {
      summary.errors += 1;
      report(error, "catchup_dispatch", catchupDispatchFingerprint(candidate, error));
    }
  }
  return summary;
}
