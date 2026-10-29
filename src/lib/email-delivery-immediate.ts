import { after } from "next/server";
import { dispatchEmailDelivery } from "@/lib/email-delivery";
import { captureOperationalError } from "@/lib/monitoring";

/** Audit actor for sends made by the post-response hook instead of the job. */
export const IMMEDIATE_EMAIL_DISPATCH_ACTOR = "request:email-delivery-immediate";

/**
 * One request only ever creates a handful of send-now rows. The bound keeps a
 * mistaken bulk caller from turning one response into an unbounded send loop
 * and keeps the worst case (each provider call times out after 10 s) inside
 * `IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS`. Anything beyond it simply
 * waits for the job.
 */
export const MAX_IMMEDIATE_DISPATCHES_PER_CALL = 5;

/**
 * Value for `export const maxDuration` on every route or page whose request
 * schedules an immediate dispatch. `after()` runs within the route's maximum
 * duration; a platform kill mid-send would leave the row leased (`sending`)
 * until the job's stale-lease recovery, which is too late for a 15-minute
 * magic link. Route segment config must be a literal, so routes repeat `60`.
 */
export const IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS = 60;

/** A row is send-now when its first attempt is already due at creation. */
export function isImmediateEmailDelivery(nextAttemptAt: Date | null | undefined, now = new Date()) {
  return nextAttemptAt instanceof Date && nextAttemptAt.getTime() <= now.getTime();
}

/**
 * Reads the delivery id from an enqueue helper's result only for the listed
 * statuses. A missing or unexpected result yields null, so this bookkeeping
 * can never throw inside the caller (for example inside the payment
 * transaction) or change its outcome.
 */
export function deliveryIdForStatuses(
  outcome: { status: string; deliveryId?: string | null } | null | undefined,
  statuses: readonly string[],
) {
  if (!outcome || !statuses.includes(outcome.status)) return null;
  return typeof outcome.deliveryId === "string" && outcome.deliveryId.length > 0 ? outcome.deliveryId : null;
}

function reportImmediateDispatchFailure(error: unknown, operation: string) {
  try {
    captureOperationalError(error, { source: "email_delivery_immediate", operation, status: "failed" });
  } catch {
    // Monitoring must never change the durable delivery state.
  }
}

/**
 * Sends already-committed rows through the same claim/recheck/finalize path
 * the job uses. `dispatchEmailDelivery` claims each row with a compare-and-set
 * on status, attemptCount and updatedAt, so a concurrent job run (or a second
 * hook) gets `claimed_elsewhere` instead of sending again. A thrown error is
 * contained here and the row stays queued, failed or leased for the job.
 */
export async function dispatchEmailDeliveriesNow(deliveryIds: readonly string[]) {
  const results: Array<{ deliveryId: string; status: string }> = [];
  for (const deliveryId of deliveryIds) {
    try {
      const result = await dispatchEmailDelivery(deliveryId, IMMEDIATE_EMAIL_DISPATCH_ACTOR);
      results.push({ deliveryId, status: result.status });
    } catch (error) {
      reportImmediateDispatchFailure(error, "dispatch");
      results.push({ deliveryId, status: "dispatch_error" });
    }
  }
  return results;
}

/**
 * Schedules send-now deliveries to be dispatched after the current response
 * has finished. Callers invoke it only after the creating write (or its
 * transaction) has returned, so the row is committed before the hook reads
 * it; a row that never committed would just come back as `missing`.
 * The email job stays the retry and safety net: when `after` cannot register
 * (outside a request scope such as scripts, tests or a prerender, or a module
 * environment without a usable `after`) nothing is scheduled, nothing throws,
 * and the job sends later. Returns whether a hook was registered; callers
 * never depend on it.
 */
export function scheduleImmediateEmailDispatch(deliveryIds: ReadonlyArray<string | null | undefined>) {
  const ids = [...new Set(deliveryIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    .slice(0, MAX_IMMEDIATE_DISPATCHES_PER_CALL);
  if (ids.length === 0) return false;
  try {
    // Accessing or calling `after` throws outside a request scope (and when a
    // module mock leaves it undefined); both mean "let the job send it".
    after(async () => {
      await dispatchEmailDeliveriesNow(ids);
    });
    return true;
  } catch {
    return false;
  }
}
