import { after } from "next/server";
import { getDb } from "@/lib/db";
import { materializeLiveNotificationRules } from "@/lib/live-notification-delivery";
import { processLiveReminderReconciliationJobs } from "@/lib/live-reminder-reconciliation";
import { captureOperationalError } from "@/lib/monitoring";

/** At most this many before_live / during_live rules are re-materialized per save. */
const MAX_RULES_PER_LIVE = 50;

function report(error: unknown, operation: string) {
  try {
    captureOperationalError(error, { source: "evergreen_rematerialization", operation, status: "failed" });
  } catch {
    // Monitoring must never change the outcome of a saved setting.
  }
}

/**
 * Brings this Live's before-live outbound messages in line with the
 * just-saved evergreen state without waiting for the scheduled job:
 *
 * 1. works off the legacy reminder reconciliation job the save queued, and
 * 2. re-materializes the Live's active before_live / during_live rules.
 *
 * Both steps are tenant-bound (vendorId + liveId) and idempotent with the
 * scheduled job: jobs are claimed by compare-and-set, deliveries use
 * deterministic ids, and an active evergreen Live is skipped by the
 * materializer, so a repeat run or a concurrent cron tick converges instead of
 * duplicating. Each step is contained; a failure is reported and the
 * scheduled job remains the safety net.
 */
export async function rematerializeEvergreenLiveNow(input: { vendorId: string; liveId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const outcome = { reminderJobs: 0, notificationRules: 0, failed: [] as string[] };

  try {
    const jobs = await processLiveReminderReconciliationJobs({ vendorId: input.vendorId, liveId: input.liveId, now });
    outcome.reminderJobs = jobs.length;
  } catch (error) {
    outcome.failed.push("reminder_reconciliation");
    report(error, "reminder_reconciliation");
  }

  try {
    const rules = await getDb().liveNotificationRule.findMany({
      where: {
        vendorId: input.vendorId,
        liveId: input.liveId,
        isActive: true,
        trigger: { in: ["before_live", "during_live"] },
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: MAX_RULES_PER_LIVE,
      select: { id: true },
    });
    if (rules.length > 0) {
      await materializeLiveNotificationRules({
        vendorId: input.vendorId,
        liveId: input.liveId,
        ruleIds: rules.map((rule) => rule.id),
        now,
      });
    }
    outcome.notificationRules = rules.length;
  } catch (error) {
    outcome.failed.push("notification_rules");
    report(error, "notification_rules");
  }

  return outcome;
}

/**
 * Runs `rematerializeEvergreenLiveNow` after the response, like the immediate
 * email dispatch. Call it only after the saving transaction has committed.
 * Outside a request scope (scripts, tests) `after` cannot register: nothing
 * runs, nothing throws, and the scheduled job does the work later.
 */
export function scheduleEvergreenRematerialization(input: { vendorId: string; liveId: string }) {
  try {
    after(async () => {
      await rematerializeEvergreenLiveNow(input);
    });
    return true;
  } catch {
    return false;
  }
}
