import type { PrismaClient } from "@prisma/client";

import { dispatchLiveStartedLineNotifications } from "@/lib/line-live-started";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * Best-effort eager delivery after a Live transition commits. The durable
 * cron worker owns recovery, so notification outages never roll back Live.
 */
export async function dispatchLiveStartedLineNotificationsSafely(
  db: PrismaClient,
  vendorId: string,
  committed: { id: string; liveStartedAt: Date | null },
) {
  if (!committed.liveStartedAt) return;
  try {
    await dispatchLiveStartedLineNotifications(db, {
      vendorId,
      liveId: committed.id,
      startedAt: committed.liveStartedAt,
    });
  } catch (error) {
    try {
      captureOperationalError(error, {
        source: "line_notification",
        operation: "live_started_dispatch",
        status: "failed",
      });
    } catch {
      // Monitoring must not replace the already handled notification error.
    }
  }
}
