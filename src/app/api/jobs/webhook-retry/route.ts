import { NextResponse } from "next/server";
import { requireCronSecret, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { releaseExpiredInventoryReservations } from "@/lib/inventory-reservations";
import { captureOperationalError } from "@/lib/monitoring";
import { paymentPaidCatchupDeadline, runPaymentPaidAutomationCatchup, type PaymentPaidCatchupSummary } from "@/lib/payment-paid-automation-catchup";
import { processDueWebhookRetries } from "@/lib/webhook-retry";

// One run releases expired reservations (each row with the 5-attempt
// EXPIRY_CLEANUP_RETRY budget, and no new row after EXPIRY_CLEANUP_DEADLINE_MS
// = 60 s, so the cleanup cannot starve webhook recovery; leftovers wait for
// the next run), then retries up to 20 webhooks in
// sequence, each a Serializable transaction (15 s timeout, up to 3 attempts)
// that can also schedule its paid receipt email and, for an order's first
// paid transition, its `payment_paid` automations with `after()`
// (src/lib/payment-paid-automation.ts), and last runs the `payment_paid`
// catch-up (src/lib/payment-paid-automation-catchup.ts): orders paid 10 min
// to 48 h ago whose `after()` hook never ran or died mid-run, at most 20 per
// run, round-robin across vendors. It only uses what is left of the time the
// scheduler waits (scripts/scheduled-jobs-runner.mjs, 120 s): skipped once
// the route has run 60 s, otherwise no new order after min(60 s, 100 s −
// elapsed). The live path is still `after()`; the catch-up reuses its
// idempotency keys, so a rule runs once either way. Under Fluid
// Compute the platform default is already 300 s, so a lower value would cut
// the batch off mid-run, leave events `retrying` until the lease expires and
// lose the summary and alerts. 300 s is the Hobby maximum under Fluid and is
// above IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS.
export const maxDuration = 300;

const SAFE_RETRY_STATUSES = new Set([
  "processed",
  "failed",
  "exhausted",
  "missing",
  "claimed_elsewhere",
  "not_retrying",
  "not_stale",
]);

type MaintenanceStep = "inventory_cleanup" | "webhook_retry";

/**
 * The catch-up's part of the response: its counts, `{ skipped: true }` when
 * the route had no time left for it, or `{ failed: true }` when it threw
 * (reported to monitoring; the job still answers 200 for it, the next run
 * tries again).
 */
type CatchupOutcome = PaymentPaidCatchupSummary | { skipped: true } | { failed: true };

function reportMaintenanceFailure(error: unknown, operation: MaintenanceStep | "payment_paid_catchup") {
  // Observability must never turn a recoverable maintenance failure into a
  // second failure that prevents the other job from being attempted.
  try {
    captureOperationalError(error, {
      source: "webhook_retry_job",
      operation,
      status: "failed",
    });
  } catch {
    // The HTTP contract below remains fail-closed even when monitoring is unavailable.
  }
}

/**
 * Counts the scheduler reads to fail a run (PR #447 review M2): any event that
 * became exhausted, or hit sold-out inventory after its reservation expired
 * (B03-07), needs a human even though the HTTP call itself succeeded.
 */
function attentionCounts(results: Awaited<ReturnType<typeof processDueWebhookRetries>>) {
  return {
    exhausted: results.filter((result) => result.status === "exhausted").length,
    inventoryUnavailable: results.filter((result) => result.inventoryUnavailable === true).length,
  };
}

function safeRetryResults(results: Awaited<ReturnType<typeof processDueWebhookRetries>>) {
  return results.slice(0, 20).map((result) => ({
    status: SAFE_RETRY_STATUSES.has(result.status) ? result.status : "unknown",
  }));
}

async function runCatchupWithinBudget(routeStartedAt: number): Promise<CatchupOutcome> {
  const deadlineMs = paymentPaidCatchupDeadline(Date.now() - routeStartedAt);
  if (deadlineMs === null) return { skipped: true };
  try {
    return await runPaymentPaidAutomationCatchup({ deadlineMs });
  } catch (error) {
    // Not a webhook-retry failure: payments are untouched and the next run
    // scans again, so the job keeps its 200 and monitoring gets the error.
    reportMaintenanceFailure(error, "payment_paid_catchup");
    return { failed: true };
  }
}

async function processWebhookRetryMaintenance() {
  const routeStartedAt = Date.now();
  let inventory: Awaited<ReturnType<typeof releaseExpiredInventoryReservations>> | null = null;
  let results: Awaited<ReturnType<typeof processDueWebhookRetries>> = [];
  const failures: MaintenanceStep[] = [];

  // Keep this ordering deliberately sequential: both jobs use the same local
  // database, but an inventory fault must not starve payment webhook recovery.
  try {
    inventory = await releaseExpiredInventoryReservations();
  } catch (error) {
    failures.push("inventory_cleanup");
    reportMaintenanceFailure(error, "inventory_cleanup");
  }

  try {
    results = await processDueWebhookRetries();
  } catch (error) {
    failures.push("webhook_retry");
    reportMaintenanceFailure(error, "webhook_retry");
  }

  // Last, so neither step above waits for it. The summary holds counts only.
  const paymentPaidCatchup = await runCatchupWithinBudget(routeStartedAt);

  if (failures.length > 0) {
    return NextResponse.json({
      ok: false,
      inventory,
      processed: results.length,
      ...attentionCounts(results),
      results: safeRetryResults(results),
      paymentPaidCatchup,
      failures,
    }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    inventory,
    processed: results.length,
    ...attentionCounts(results),
    results,
    paymentPaidCatchup,
  });
}

/** Vercel Cron entry: Vercel sends GET with `Authorization: Bearer CRON_SECRET`. */
export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  return processWebhookRetryMaintenance();
}

/** Controlled job runner entry (GitHub Actions schedule or manual operations). */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }
  return processWebhookRetryMaintenance();
}
