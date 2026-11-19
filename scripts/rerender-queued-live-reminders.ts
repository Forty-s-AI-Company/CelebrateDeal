/**
 * PROPOSAL, NOT RUN (A2-13, #670 review MINOR-2). Re-renders the live reminder
 * and live notification e-mails (`live_reminder`, `before_live`,
 * `during_live`) one vendor queued before the recipient-name fix was deployed,
 * so they go out with the cleaned `{{name}}` instead of the stored snapshot.
 *
 * Why it is needed: these rows store their rendered subject and body when they
 * are queued, often days before they are sent. The fix only changes what is
 * rendered from then on, so a row queued earlier would still send the name as
 * it was typed.
 *
 * How it works: matching rows are marked `superseded` (the same thing a
 * template or schedule change does). Nothing is deleted. The ids are
 * deterministic, so regeneration brings back the SAME row with content
 * rendered now (both reactivation paths rewrite the encrypted payload):
 * - `live_reminder`: in the same transaction a reminder reconciliation job is
 *   queued for that Live (queueLiveReminderReconciliationForCurrentLive);
 *   the email job runs it and reactivates each row through
 *   ensureLiveReminderDelivery.
 * - `before_live` / `during_live`: the email job's notification repair pass
 *   (processDueLiveNotifications) re-materializes them; its rule window
 *   rotates, so this can take several rounds.
 * - `--rematerialize` does both right away in this process instead of waiting
 *   for the scheduled job (needs the deployment's own application settings,
 *   since it encrypts new payloads; those library calls use the application's
 *   own client, i.e. the same DATABASE_URL).
 *
 * Which rows (all conditions, every one bound to the vendor):
 * - `vendorId` = `--vendor-id` (required: never all tenants at once);
 * - trigger `live_reminder`, `before_live` or `during_live`, with a Live;
 * - status `queued` or `failed` (a failed row is retried by the dispatcher, so
 *   it would also send the old text); sent, sending and suppressed rows are
 *   never touched;
 * - created before `--queued-before` (the deploy time of the fix);
 * - due at least `--min-lead-minutes` (default 30) from now, so the job has
 *   time to bring it back. A before_live notice can only be re-created before
 *   the Live starts; rows due sooner are left as they are and only counted;
 * - not a before_live notice on a Live that still sends its own legacy
 *   reminder (`liveReminderTemplateId` set): the notification repair never
 *   re-creates those, so they are left as they are and only counted
 *   (`notRegenerableByTrigger`).
 * With `--rematerialize` the run then counts the rows it superseded that did
 * not come back (`notRestored`) and exits with status 1 if there are any.
 * Without it, regeneration is left to the scheduled job and is not checked:
 * prefer `--rematerialize` (fixed-session and evergreen Lives have their own
 * scheduling rules that this script does not re-check).
 * Each write is a compare-and-set on the row's id, status and updatedAt as
 * read, one transaction per Live; a rerun finds nothing left to change.
 *
 * Running it against staging or production needs the owner's separate,
 * explicit authorization for that run, the dry run included. The flags are a
 * guard against mistakes, not an access control.
 * - Dry run by default: prints counts only and writes nothing.
 * - Writing needs `--apply` AND RERENDER_CONFIRM=RERENDER_QUEUED_LIVE_REMINDERS.
 * - Target: a loopback `celebratedeal_*` database is always allowed. Staging
 *   needs `--target=staging` and a URL that is the staging database; anything
 *   else needs `--target=production`. Writing to either also needs
 *   RERENDER_REMOTE_APPROVAL=OWNER_APPROVED_LIVE_REMINDER_RERENDER.
 * - Prints ids and counts only, never names, addresses or e-mail content.
 *
 * Usage:
 *   DATABASE_URL=<url> node --import tsx scripts/rerender-queued-live-reminders.ts \
 *     --vendor-id <id> --queued-before 2026-11-20T00:00:00Z [--target=staging]
 *   RERENDER_CONFIRM=RERENDER_QUEUED_LIVE_REMINDERS DATABASE_URL=<url> \
 *     node --import tsx scripts/rerender-queued-live-reminders.ts --vendor-id <id> \
 *     --queued-before 2026-11-20T00:00:00Z --apply [--rematerialize] [--target=staging]
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { isStagingDatabaseUrl } from "../src/lib/database-identity";
import { LIVE_NOTIFICATION_DELIVERY_TRIGGERS, liveNotificationIdentityFromKey } from "../src/lib/live-notification-identity";
import { classifyLocalTestDatabase } from "./local-database-safety";

export const APPLY_CONFIRMATION = "RERENDER_QUEUED_LIVE_REMINDERS";
export const REMOTE_APPROVAL = "OWNER_APPROVED_LIVE_REMINDER_RERENDER";
export const RERENDER_TRIGGERS = ["live_reminder", ...LIVE_NOTIFICATION_DELIVERY_TRIGGERS] as const;
const DEFAULT_MIN_LEAD_MINUTES = 30;

type Environment = Readonly<Record<string, string | undefined>>;

export class LiveReminderRerenderRefusedError extends Error {
  constructor(public readonly category: string) {
    super("Live reminder re-render refused.");
    this.name = "LiveReminderRerenderRefusedError";
  }
}

export type LiveReminderRerenderOptions = {
  apply: boolean;
  rematerialize: boolean;
  target: "loopback" | "staging" | "production" | null;
  vendorId: string;
  queuedBefore: Date;
  minLeadMinutes: number;
};

function argumentValue(argv: readonly string[], index: number, category: string) {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--") || value.length > 191 || /[\s\p{Cc}]/u.test(value)) throw new LiveReminderRerenderRefusedError(category);
  return value;
}

export function parseLiveReminderRerenderArguments(argv: readonly string[]): LiveReminderRerenderOptions {
  let vendorId: string | null = null;
  let queuedBefore: Date | null = null;
  const options = { apply: false, rematerialize: false, target: null as LiveReminderRerenderOptions["target"], minLeadMinutes: DEFAULT_MIN_LEAD_MINUTES };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--apply") options.apply = true;
    else if (argument === "--rematerialize") options.rematerialize = true;
    else if (argument.startsWith("--target=")) {
      const target = argument.slice("--target=".length);
      if (target !== "loopback" && target !== "staging" && target !== "production") throw new LiveReminderRerenderRefusedError("invalid-target");
      options.target = target;
    } else if (argument === "--vendor-id") {
      vendorId = argumentValue(argv, index, "invalid-vendor-id");
      index += 1;
    } else if (argument === "--queued-before") {
      const value = argumentValue(argv, index, "invalid-queued-before");
      const parsed = new Date(value);
      if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || Number.isNaN(parsed.getTime())) throw new LiveReminderRerenderRefusedError("invalid-queued-before");
      queuedBefore = parsed;
      index += 1;
    } else if (argument === "--min-lead-minutes") {
      const value = Number(argumentValue(argv, index, "invalid-min-lead-minutes"));
      if (!Number.isInteger(value) || value < 5 || value > 10_080) throw new LiveReminderRerenderRefusedError("invalid-min-lead-minutes");
      options.minLeadMinutes = value;
      index += 1;
    } else {
      throw new LiveReminderRerenderRefusedError("unknown-argument");
    }
  }
  if (!vendorId) throw new LiveReminderRerenderRefusedError("vendor-id-required");
  if (!queuedBefore) throw new LiveReminderRerenderRefusedError("queued-before-required");
  if (options.rematerialize && !options.apply) throw new LiveReminderRerenderRefusedError("rematerialize-needs-apply");
  return { ...options, vendorId, queuedBefore };
}

/** Returns the database URL the tool may use, or throws a safe category. */
export function resolveLiveReminderRerenderTarget(env: Environment, options: Pick<LiveReminderRerenderOptions, "apply" | "target">) {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new LiveReminderRerenderRefusedError("missing");
  if (classifyLocalTestDatabase(url).safe) {
    if (options.target !== null && options.target !== "loopback") throw new LiveReminderRerenderRefusedError("target-mismatch");
    return { url, target: "loopback" as const };
  }
  let target: "staging" | "production";
  if (options.target === "staging") {
    if (!isStagingDatabaseUrl(url)) throw new LiveReminderRerenderRefusedError("not-staging");
    target = "staging";
  } else if (options.target === "production") {
    if (isStagingDatabaseUrl(url)) throw new LiveReminderRerenderRefusedError("target-mismatch");
    target = "production";
  } else {
    throw new LiveReminderRerenderRefusedError("remote-without-target");
  }
  if (options.apply && env.RERENDER_REMOTE_APPROVAL !== REMOTE_APPROVAL) throw new LiveReminderRerenderRefusedError("remote-not-approved");
  return { url, target };
}

type CandidateRow = { id: string; sourceLiveId: string | null; trigger: string; status: string; updatedAt: Date; idempotencyKey: string | null };

function candidateWhere(options: LiveReminderRerenderOptions): Prisma.EmailDeliveryWhereInput {
  return {
    vendorId: options.vendorId,
    trigger: { in: [...RERENDER_TRIGGERS] },
    status: { in: ["queued", "failed"] },
    sourceLiveId: { not: null },
    createdAt: { lt: options.queuedBefore },
    nextAttemptAt: { not: null },
  };
}

function countBy<T>(rows: readonly T[], key: (row: T) => string) {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[key(row)] = (counts[key(row)] ?? 0) + 1;
  return counts;
}

export async function planLiveReminderRerender(db: PrismaClient, options: LiveReminderRerenderOptions, now = new Date()) {
  const leadCutoff = new Date(now.getTime() + options.minLeadMinutes * 60_000);
  const rows = await db.emailDelivery.findMany({
    where: candidateWhere(options),
    select: { id: true, sourceLiveId: true, trigger: true, status: true, updatedAt: true, idempotencyKey: true, nextAttemptAt: true },
    orderBy: [{ sourceLiveId: "asc" }, { id: "asc" }],
  });
  // The notification repair never re-creates a before_live notice on a Live that
  // still sends its own legacy reminder (liveReminderTemplateId set): such a row,
  // once superseded, would never come back. Leave it as it is and count it.
  const liveIds = [...new Set(rows.map((row) => row.sourceLiveId!))];
  const legacyReminderLives = new Set((await db.live.findMany({
    where: { vendorId: options.vendorId, id: { in: liveIds }, liveReminderTemplateId: { not: null } },
    select: { id: true },
  })).map((live) => live.id));
  const notRegenerable = rows.filter((row) => row.trigger === "before_live" && legacyReminderLives.has(row.sourceLiveId!));
  const regenerable = rows.filter((row) => !notRegenerable.includes(row));
  const eligible = regenerable.filter((row) => row.nextAttemptAt! >= leadCutoff);
  const tooSoon = regenerable.filter((row) => row.nextAttemptAt! < leadCutoff);
  return {
    eligible: eligible as CandidateRow[],
    summary: {
      eligibleByTrigger: countBy(eligible, (row) => row.trigger),
      tooSoonByTrigger: countBy(tooSoon, (row) => row.trigger),
      notRegenerableByTrigger: countBy(notRegenerable, (row) => row.trigger),
      lives: new Set(eligible.map((row) => row.sourceLiveId)).size,
    },
  };
}

export async function runLiveReminderRerender(db: PrismaClient, options: LiveReminderRerenderOptions, env: Environment, now = new Date()) {
  const plan = await planLiveReminderRerender(db, options, now);
  if (!options.apply) return { mode: "plan" as const, ...plan.summary };
  if (env.RERENDER_CONFIRM !== APPLY_CONFIRMATION) throw new LiveReminderRerenderRefusedError("confirmation-missing");
  // Loaded only when writing: they pull in the application's e-mail modules.
  const { queueLiveReminderReconciliationForCurrentLive, processLiveReminderReconciliationJobs } = await import("../src/lib/live-reminder-reconciliation");
  const { materializeLiveNotificationRules } = await import("../src/lib/live-notification-delivery");

  const byLive = new Map<string, CandidateRow[]>();
  for (const row of plan.eligible) byLive.set(row.sourceLiveId!, [...(byLive.get(row.sourceLiveId!) ?? []), row]);
  let superseded = 0;
  let reconciliationsQueued = 0;
  const supersededIds: string[] = [];
  const notificationRulesByLive = new Map<string, Set<string>>();
  for (const [liveId, rows] of byLive) {
    const changed = await db.$transaction(async (tx) => {
      let count = 0;
      let reminders = 0;
      for (const row of rows) {
        // Compare-and-set on what was read: a row sent, re-rendered or changed meanwhile is left alone.
        const result = await tx.emailDelivery.updateMany({
          where: { id: row.id, vendorId: options.vendorId, sourceLiveId: liveId, status: row.status, updatedAt: row.updatedAt },
          data: { status: "superseded", nextAttemptAt: null, claimedAt: null, lastErrorCode: "config_superseded" },
        });
        count += result.count;
        if (result.count === 1) supersededIds.push(row.id);
        if (result.count === 1 && row.trigger === "live_reminder") reminders += 1;
        if (result.count === 1 && row.trigger !== "live_reminder") {
          const identity = row.idempotencyKey ? liveNotificationIdentityFromKey(row.idempotencyKey) : null;
          if (identity) notificationRulesByLive.set(liveId, (notificationRulesByLive.get(liveId) ?? new Set()).add(identity.ruleId));
        }
      }
      if (reminders > 0 && await queueLiveReminderReconciliationForCurrentLive(tx, { vendorId: options.vendorId, liveId, now })) reconciliationsQueued += 1;
      return count;
    }, { timeout: 30_000 });
    superseded += changed;
  }

  let rematerialized: { reminderJobs: number; notifications: number; notRestored: number } | null = null;
  if (options.rematerialize) {
    rematerialized = { reminderJobs: 0, notifications: 0, notRestored: 0 };
    for (const liveId of byLive.keys()) {
      rematerialized.reminderJobs += (await processLiveReminderReconciliationJobs({ vendorId: options.vendorId, liveId, now, limit: 25 })).length;
      const ruleIds = [...(notificationRulesByLive.get(liveId) ?? [])];
      if (ruleIds.length > 0) rematerialized.notifications += (await materializeLiveNotificationRules({ vendorId: options.vendorId, liveId, ruleIds, now })).length;
    }
    // Every row this run superseded must be back (queued again, or suppressed by
    // the recipient's own unsubscribe); anything left superseded is reported.
    rematerialized.notRestored = await db.emailDelivery.count({ where: { vendorId: options.vendorId, id: { in: supersededIds }, status: "superseded" } });
  }
  return { mode: "apply" as const, ...plan.summary, superseded, reconciliationsQueued, rematerialized };
}

async function main() {
  let category = "unexpected";
  try {
    const options = parseLiveReminderRerenderArguments(process.argv.slice(2));
    const { url, target } = resolveLiveReminderRerenderTarget(process.env, options);
    const db = new PrismaClient({ datasourceUrl: url, log: [] });
    try {
      category = "run";
      const outcome = await runLiveReminderRerender(db, options, process.env);
      const incomplete = outcome.mode === "apply" && (outcome.rematerialized?.notRestored ?? 0) > 0;
      console.log(JSON.stringify({ status: incomplete ? "incomplete" : "ok", target, vendorId: options.vendorId, ...outcome, secretDetailsEmitted: false }));
      if (incomplete) process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  } catch (error) {
    if (error instanceof LiveReminderRerenderRefusedError) category = error.category;
    console.error(JSON.stringify({ status: "failed", safeCategory: `live-reminder-rerender:${category}`, secretDetailsEmitted: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
