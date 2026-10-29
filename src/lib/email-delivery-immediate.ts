import { after } from "next/server";
import { dispatchEmailDelivery } from "@/lib/email-delivery";
import { captureOperationalError } from "@/lib/monitoring";

/** Audit actor for sends made by the post-response hook instead of the job. */
export const IMMEDIATE_EMAIL_DISPATCH_ACTOR = "request:email-delivery-immediate";

/**
 * One request only ever creates a handful of send-now rows. The bound keeps a
 * mistaken bulk caller from turning one response into an unbounded send loop;
 * anything beyond it simply waits for the job.
 */
const MAX_IMMEDIATE_DISPATCHES_PER_CALL = 5;

/** A row is send-now when its first attempt is already due at creation. */
export function isImmediateEmailDelivery(nextAttemptAt: Date | null | undefined, now = new Date()) {
  return nextAttemptAt instanceof Date && nextAttemptAt.getTime() <= now.getTime();
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
 * has finished, which is also after the creating transaction has committed.
 * The email job stays the retry and safety net: outside a request scope
 * (scripts, tests, a prerender) nothing is scheduled and the job sends later.
 * Returns whether a hook was registered; callers never depend on it.
 */
export function scheduleImmediateEmailDispatch(deliveryIds: ReadonlyArray<string | null | undefined>) {
  const ids = [...new Set(deliveryIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    .slice(0, MAX_IMMEDIATE_DISPATCHES_PER_CALL);
  if (ids.length === 0) return false;
  try {
    after(async () => {
      await dispatchEmailDeliveriesNow(ids);
    });
    return true;
  } catch {
    // `after` throws synchronously outside a request scope. The row is already
    // durable and due, so the job will dispatch it.
    return false;
  }
}
