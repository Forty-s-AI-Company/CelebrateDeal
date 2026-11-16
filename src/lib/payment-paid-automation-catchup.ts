import { Prisma } from "@prisma/client";
import { AUTOMATION_EXECUTION_RECLAIM_AFTER_MS, parseAutomationRule } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
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
 *   an earlier payment) and that has no execution log for the order, or only
 *   a `running` one older than the reclaim threshold (a run that died).
 *
 * A `failed` execution log is final, as on the live path: it is not retried
 * here (the merchant sees it in the execution log).
 *
 * Each run takes at most PAYMENT_PAID_CATCHUP_ORDER_LIMIT orders, round-robin
 * across vendors (each vendor's oldest order first, then each vendor's
 * second, ...), and stops starting new orders after
 * PAYMENT_PAID_CATCHUP_DEADLINE_MS; the rest wait for the next run.
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
/**
 * Active `payment_paid` rules read per run (all vendors). Beyond it the
 * vendors after the cut wait (reported as `rule_scan_truncated`).
 */
export const PAYMENT_PAID_CATCHUP_RULE_SCAN_LIMIT = 1_000;

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

type CatchupCandidate = { vendorId: string; orderId: string; recordedAt: Date };

/** What a catch-up report says. Only monitoring.ts SAFE_CONTEXT_KEYS reach Sentry: `source` + `operation`. */
export type PaymentPaidCatchupReport = "catchup_dispatch" | "catchup_rule_failed" | "catchup_rule_scan_truncated";

function report(error: unknown, operation: PaymentPaidCatchupReport) {
  try {
    captureOperationalError(error, { source: "payment_paid_automation", operation });
  } catch {
    // Monitoring must never stop the job.
  }
}

/** Active, vendor-wide `payment_paid` rules that parse (an unparseable rule never writes a log, so it would be picked up again every run). */
async function runnableRules(db: CatchupDb) {
  const stored = await db.automationRule.findMany({
    where: { trigger: "payment_paid", isActive: true, funnelPageId: null, vendor: { is: { suspendedAt: null } } },
    orderBy: [{ vendorId: "asc" }, { id: "asc" }],
    take: PAYMENT_PAID_CATCHUP_RULE_SCAN_LIMIT + 1,
    select: { id: true, vendorId: true, version: true, condition: true, actions: true },
  });
  if (stored.length > PAYMENT_PAID_CATCHUP_RULE_SCAN_LIMIT) {
    report(new Error("Payment-paid catch-up rule scan truncated."), "catchup_rule_scan_truncated");
    stored.length = PAYMENT_PAID_CATCHUP_RULE_SCAN_LIMIT;
  }
  return stored.filter((rule) => parseAutomationRule(rule) !== null);
}

async function findCandidates(db: CatchupDb, now: Date, limit: number): Promise<CatchupCandidate[]> {
  const rules = await runnableRules(db);
  if (rules.length === 0) return [];
  const vendorIds = [...new Set(rules.map((rule) => rule.vendorId))];
  const ruleIds = rules.map((rule) => rule.id);
  const newest = new Date(now.getTime() - PAYMENT_PAID_CATCHUP_MIN_AGE_MS);
  const oldest = new Date(now.getTime() - PAYMENT_PAID_CATCHUP_MAX_AGE_MS);
  const staleRunningBefore = new Date(now.getTime() - AUTOMATION_EXECUTION_RECLAIM_AFTER_MS);
  const inventoryPaidKeyPrefix = `payment.paid:${INVENTORY_EXPIRY_RECONCILE_EVENT_PREFIX}`;
  // Every join is bound to the order's vendor. The per-vendor rank makes the
  // cap fair: each vendor's oldest order comes before any vendor's second.
  return db.$queryRaw<CatchupCandidate[]>(Prisma.sql`
    WITH "candidate" AS (
      SELECT o."vendorId", o."id" AS "orderId", o."paidAt", e."createdAt" AS "recordedAt",
             ROW_NUMBER() OVER (PARTITION BY o."vendorId" ORDER BY o."paidAt" ASC, o."id" ASC) AS "vendorRank"
      FROM "CommerceOrder" o
      JOIN "Vendor" v ON v."id" = o."vendorId" AND v."suspendedAt" IS NULL
      JOIN LATERAL (
        SELECT ev."createdAt", ev."dedupKey", ev."sanitizedData"
        FROM "CommerceOrderEvent" ev
        WHERE ev."vendorId" = o."vendorId" AND ev."orderId" = o."id" AND ev."eventType" = 'payment.paid'
        ORDER BY ev."createdAt" ASC, ev."id" ASC
        LIMIT 1
      ) e ON TRUE
      WHERE o."vendorId" = ANY(${vendorIds})
        AND o."status" = 'paid'
        AND o."refundedAmountCents" = 0
        AND o."isTestOrder" = false
        AND o."paidAt" >= ${oldest}
        AND o."paidAt" <= ${newest}
        AND e."createdAt" >= ${oldest}
        AND e."createdAt" <= ${newest}
        AND NOT starts_with(e."dedupKey", ${inventoryPaidKeyPrefix})
        AND (e."sanitizedData" IS NULL OR e."sanitizedData"->>'fulfillmentHeld' IS NULL)
        AND EXISTS (
          SELECT 1 FROM "AutomationRule" r
          WHERE r."vendorId" = o."vendorId"
            AND r."id" = ANY(${ruleIds})
            AND r."trigger" = 'payment_paid'
            AND r."isActive" = true
            AND r."funnelPageId" IS NULL
            AND r."updatedAt" <= e."createdAt"
            AND NOT EXISTS (
              SELECT 1 FROM "AutomationExecutionLog" l
              WHERE l."vendorId" = o."vendorId"
                AND l."eventId" = 'payment-paid:' || o."id"
                AND l."ruleId" = r."id"
                AND NOT (l."status" = 'running' AND l."startedAt" < ${staleRunningBefore})
            )
        )
    )
    SELECT "vendorId", "orderId", "recordedAt"
    FROM "candidate"
    WHERE "vendorRank" <= ${limit}
    ORDER BY "vendorRank" ASC, "paidAt" ASC, "orderId" ASC
    LIMIT ${limit}
  `);
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
  const deadlineMs = options.deadlineMs ?? PAYMENT_PAID_CATCHUP_DEADLINE_MS;
  const summary: PaymentPaidCatchupSummary = {
    candidates: 0, examined: 0, completed: 0, skipped: 0, failed: 0, duplicate: 0, notApplicable: 0, errors: 0,
  };
  if (limit === 0) return summary;
  const candidates = await findCandidates(db, now, limit);
  summary.candidates = candidates.length;
  for (const candidate of candidates) {
    if (clock() - startedAt >= deadlineMs) break;
    summary.examined += 1;
    try {
      const outcome = await dispatchPaymentPaidAutomationForOrder(
        { vendorId: candidate.vendorId, orderId: candidate.orderId },
        db,
        { rulesUnchangedSince: candidate.recordedAt },
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
      report(error, "catchup_dispatch");
    }
  }
  return summary;
}
