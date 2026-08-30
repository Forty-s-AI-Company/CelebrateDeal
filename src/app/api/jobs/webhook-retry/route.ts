import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { releaseExpiredInventoryReservations } from "@/lib/inventory-reservations";
import { captureOperationalError } from "@/lib/monitoring";
import { processDueWebhookRetries } from "@/lib/webhook-retry";

const SAFE_RETRY_STATUSES = new Set([
  "processed",
  "failed",
  "exhausted",
  "missing",
  "claimed_elsewhere",
  "not_retrying",
  "not_stale",
]);

function reportMaintenanceFailure(error: unknown, operation: "inventory_cleanup" | "webhook_retry") {
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

function safeRetryResults(results: Awaited<ReturnType<typeof processDueWebhookRetries>>) {
  return results.slice(0, 20).map((result) => ({
    status: SAFE_RETRY_STATUSES.has(result.status) ? result.status : "unknown",
  }));
}

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  let inventory: Awaited<ReturnType<typeof releaseExpiredInventoryReservations>> | null = null;
  let results: Awaited<ReturnType<typeof processDueWebhookRetries>> = [];
  const failures: Array<"inventory_cleanup" | "webhook_retry"> = [];

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

  if (failures.length > 0) {
    return NextResponse.json({
      ok: false,
      inventory,
      processed: results.length,
      results: safeRetryResults(results),
      failures,
    }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    inventory,
    processed: results.length,
    results,
  });
}
