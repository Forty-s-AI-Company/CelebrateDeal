import { NextResponse } from "next/server";
import { requireCronSecret, unauthorizedJson } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { materializeLineNotifications } from "@/lib/line-notification-materializer";
import { processDueLineDeliveries } from "@/lib/line-notification";

const SAFE_STATUSES = new Set([
  "queued",
  "duplicate",
  "not_linked",
  "sent",
  "failed",
  "exhausted",
  "suppressed",
  "claimed_elsewhere",
]);

function sanitizedStatusCounts(results: ReadonlyArray<{ status: string }>) {
  return results.reduce<Record<string, number>>((counts, result) => {
    const status = SAFE_STATUSES.has(result.status) ? result.status : "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

async function runLineNotificationCron() {
  try {
    const db = getDb();
    const now = new Date();
    const materialized = await materializeLineNotifications(db, now);
    const processed = await processDueLineDeliveries(db, undefined, now);
    return NextResponse.json({
      ok: true,
      materialized: materialized.length,
      materializedStatuses: sanitizedStatusCounts(materialized),
      processed: processed.length,
      processedStatuses: sanitizedStatusCounts(processed),
    });
  } catch {
    // Do not expose provider, recipient, or credential details from a worker.
    return NextResponse.json({ ok: false, materialized: 0, processed: 0 }, { status: 503 });
  }
}

/** Dedicated Vercel cron endpoint for the tenant-isolated LINE outbox. */
export async function GET(request: Request) {
  // requireCronSecret uses a length-checked timingSafeEqual comparison.
  if (!requireCronSecret(request)) return unauthorizedJson();
  return runLineNotificationCron();
}
