import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  AUTOMATION_EXECUTION_RECLAIM_AFTER_MS,
  AUTOMATION_WATCH_PROGRESS_FEATURE,
  automationCustomerKeyHash,
  dispatchAutomationEvent,
  parseAutomationRule,
  watchProgressRulePercent,
} from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { utcTimestamp } from "@/lib/delayed-step-runs";
import { WATCH_PROGRESS_LIVE_SELECT, watchProgressLengthSeconds, watchProgressPercent } from "@/lib/live-watch-progress";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * Q-11: the `viewer_watch_progress` automation trigger, 「觀看直播達到指定進度」
 * (docs/domain-workflows.md「自動化規則」→「觀看直播達到指定進度」).
 *
 * The e-mail job (/api/jobs/email-deliveries, every 5 minutes) calls
 * `runWatchProgressAutomation` right after the no-show pass. A rule's
 * condition is `watch_percent_gte` (a whole percent, 1 to 100).
 *
 * Closed beta: only vendors holding the platform grant
 * `automation_watch_progress` are scanned (default off).
 *
 * The progress of one registration is its server-counted watch time
 * (LiveWatchProgress.watchedSeconds, src/lib/live-watch-progress.ts: wall-clock
 * time admitted while its own session played, never a number the browser
 * sent) divided by the session length (watchProgressLengthSeconds: the
 * video's length for a VOD-based Live, the broadcast's length once a real live
 * stream ended). A registration reaches a rule's threshold when all of these
 * hold, every condition bound to the vendor of the rule:
 * - its LiveWatchProgress row is of this vendor, was credited within the last
 *   WATCH_PROGRESS_LOOKBACK_MS, and its registration is VERIFIED, of the same
 *   Live and through a form of this vendor;
 * - the Live is this vendor's and its length is known;
 * - `watchedSeconds × 100 ≥ percent × length`;
 * - the rule is active, vendor-wide, parseable, has a percentage condition, and
 *   had not changed after the registration's last credit (`updatedAt` at or
 *   before `lastCreditedAt`: a rule created, edited or switched on later only
 *   runs for someone still watching after it, never for viewing that ended
 *   before it existed);
 * - its execution log for this event is missing, a `running` one older than
 *   the reclaim threshold, or a first attempt that ended `failed /
 *   action_failed` at least WATCH_PROGRESS_FAILED_RETRY_AFTER_MS ago (retried
 *   once, as the no-show pass does).
 *
 * The event id is `watch-progress:{submissionId}:{percent}` and the execution
 * log's idempotency key is built from it and the rule, so one registration
 * runs one rule at most once per threshold: refreshing, a second device, a
 * replayed job round or two concurrent rounds cannot repeat it. The time is
 * cumulative per registration across the Live's sessions (each threshold
 * still fires once), and an evergreen or fixed-session Live is judged against
 * its video length.
 *
 * Each run dispatches at most WATCH_PROGRESS_EVENT_LIMIT events,
 * round-robin across vendors (each vendor's earliest-credited first), scans
 * at most WATCH_PROGRESS_VENDOR_LIMIT vendors (starting at a different one
 * every minute). The scan stops at two thirds of the deadline; no event starts
 * after the deadline.
 */

/** Progress rows credited longer ago than this are not looked at any more. */
export const WATCH_PROGRESS_LOOKBACK_MS = 24 * 60 * 60_000;
/** Events dispatched per run, shared fairly across vendors. */
export const WATCH_PROGRESS_EVENT_LIMIT = 50;
/** Vendors scanned per run; the starting vendor rotates every minute. */
export const WATCH_PROGRESS_VENDOR_LIMIT = 50;
/** Lives looked at per vendor and run (those with progress credited in the look-back window). */
const LIVE_SCAN_LIMIT = 200;
/** The pass never runs longer than this. */
export const WATCH_PROGRESS_DEADLINE_MS = 15_000;
/**
 * The pass ends at most this far into the e-mail job round. It runs right
 * after the no-show pass (which ends by 35 s), so the round's dispatch, LINE,
 * learner notifications and the sequence work keep the rest.
 */
export const WATCH_PROGRESS_ROUTE_BUDGET_MS = 45_000;
/** A deadline shorter than this is not worth starting the pass for. */
export const WATCH_PROGRESS_MIN_DEADLINE_MS = 3_000;
const SCAN_SHARE_OF_DEADLINE = 2 / 3;
/** Due events whose last credit is within this of the look-back limit are reported when a run leaves them. */
export const WATCH_PROGRESS_BACKLOG_ALERT_MS = 2 * 60 * 60_000;
/** A first-attempt `failed` execution is retried once, this long after it ended. */
export const WATCH_PROGRESS_FAILED_RETRY_AFTER_MS = 10 * 60_000;
/** Failure codes worth one retry: an action threw (transient database or outbox errors). */
export const WATCH_PROGRESS_RETRYABLE_ERROR_CODES = ["action_failed"] as const;

const EVENT_PREFIX = "watch-progress:";

/** min(15 s, 45 s − elapsed), or null to skip the pass this round when less than 3 s are left. */
export function watchProgressDeadline(routeElapsedMs: number): number | null {
  if (!Number.isFinite(routeElapsedMs)) return null;
  const left = WATCH_PROGRESS_ROUTE_BUDGET_MS - Math.max(0, routeElapsedMs);
  const deadline = Math.min(WATCH_PROGRESS_DEADLINE_MS, left);
  return deadline >= WATCH_PROGRESS_MIN_DEADLINE_MS ? deadline : null;
}

/** The event id of one registration reaching one threshold. */
export function watchProgressEventId(submissionId: string, percent: number) {
  return `${EVENT_PREFIX}${submissionId}:${percent}`;
}

export type WatchProgressSummary = {
  /** Vendors with a runnable rule that this run scanned. */
  vendors: number;
  /** Events the run will dispatch (at most WATCH_PROGRESS_EVENT_LIMIT). */
  candidates: number;
  /** Events dispatched this run (the rest hit the deadline). */
  examined: number;
  completed: number;
  skipped: number;
  failed: number;
  duplicate: number;
  /** Vendor scans or dispatches that threw (reported; the next run tries again). */
  errors: number;
  scanCutShort: boolean;
  backlogNearLookback: boolean;
};

type Db = ReturnType<typeof getDb>;

type RunnableRule = { id: string; percent: number };

type Candidate = {
  vendorId: string;
  submissionId: string;
  email: string;
  liveId: string;
  watchedSeconds: number;
  lengthSec: number;
  lastCreditedAt: Date;
  percent: number;
  ruleIds: string[];
};

/** Vendors holding the grant with a runnable rule, and those rules, in a rotating order. */
async function vendorsWithRules(db: Db, now: Date, onlyVendorIds: string[] | undefined) {
  const rules = await db.automationRule.findMany({
    where: {
      trigger: "viewer_watch_progress",
      isActive: true,
      funnelPageId: null,
      // Closed beta: a vendor without the grant is never scanned.
      vendor: { suspendedAt: null, betaFeatureGrants: { has: AUTOMATION_WATCH_PROGRESS_FEATURE } },
      ...(onlyVendorIds ? { vendorId: { in: onlyVendorIds } } : {}),
    },
    orderBy: [{ vendorId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, vendorId: true, version: true, condition: true, actions: true },
  });
  const byVendor = new Map<string, RunnableRule[]>();
  for (const rule of rules) {
    // An unparseable rule, or one with the old watch-seconds condition, never
    // writes a log, so it would be chosen again every run: leave it out.
    const percent = watchProgressRulePercent(rule.condition);
    if (percent === null || !parseAutomationRule(rule)) continue;
    byVendor.set(rule.vendorId, [...byVendor.get(rule.vendorId) ?? [], { id: rule.id, percent }]);
  }
  const vendors = [...byVendor.keys()];
  const offset = vendors.length ? Math.floor(now.getTime() / 60_000) % vendors.length : 0;
  return [...vendors.slice(offset), ...vendors.slice(0, offset)]
    .slice(0, WATCH_PROGRESS_VENDOR_LIMIT)
    .map((vendorId) => ({ vendorId, rules: byVendor.get(vendorId) ?? [] }));
}

/** One vendor's registrations past a rule's threshold that still owe it, earliest-credited first, at most `limit` rows. */
async function scanVendor(db: Db, vendorId: string, rules: RunnableRule[], now: Date, limit: number): Promise<Candidate[]> {
  const lookbackFrom = new Date(now.getTime() - WATCH_PROGRESS_LOOKBACK_MS);
  const liveRows = await db.$queryRaw<Array<{ liveId: string }>>`
    SELECT DISTINCT p."liveId"
    FROM "LiveWatchProgress" p
    WHERE p."vendorId" = ${vendorId}
      AND p."lastCreditedAt" > ${utcTimestamp(lookbackFrom)}
    LIMIT ${LIVE_SCAN_LIMIT}
  `;
  if (liveRows.length === 0) return [];
  const lives = await db.live.findMany({
    where: { vendorId, id: { in: liveRows.map((row) => row.liveId) } },
    select: WATCH_PROGRESS_LIVE_SELECT,
  });
  const lengths = lives.flatMap((live) => {
    const seconds = watchProgressLengthSeconds(live);
    return seconds ? [{ liveId: live.id, seconds }] : [];
  });
  if (lengths.length === 0) return [];
  const staleRunningBefore = new Date(now.getTime() - AUTOMATION_EXECUTION_RECLAIM_AFTER_MS);
  const failedRetryBefore = new Date(now.getTime() - WATCH_PROGRESS_FAILED_RETRY_AFTER_MS);
  const retryableCodes = [...WATCH_PROGRESS_RETRYABLE_ERROR_CODES];
  const rows = await db.$queryRaw<Array<Omit<Candidate, "vendorId">>>(Prisma.sql`
    WITH "length" AS (
      SELECT * FROM unnest(${lengths.map((entry) => entry.liveId)}::text[], ${lengths.map((entry) => entry.seconds)}::int[]) AS t("liveId", "seconds")
    ),
    "threshold" AS (
      SELECT * FROM unnest(${rules.map((rule) => rule.id)}::text[], ${rules.map((rule) => rule.percent)}::int[]) AS t("ruleId", "percent")
    )
    SELECT p."formSubmissionId" AS "submissionId", s."email", p."liveId", p."watchedSeconds",
           len."seconds" AS "lengthSec", p."lastCreditedAt", th."percent",
           array_agg(r."id" ORDER BY r."createdAt" ASC, r."id" ASC) AS "ruleIds"
    FROM "LiveWatchProgress" p
    JOIN "length" len ON len."liveId" = p."liveId"
    JOIN "FormSubmission" s ON s."id" = p."formSubmissionId" AND s."liveId" = p."liveId"
    JOIN "RegistrationForm" f ON f."id" = s."formId"
    JOIN "threshold" th ON p."watchedSeconds"::bigint * 100 >= th."percent"::bigint * len."seconds"
    JOIN "AutomationRule" r ON r."id" = th."ruleId"
      AND r."vendorId" = ${vendorId}
      AND r."trigger" = 'viewer_watch_progress'
      AND r."isActive" = true
      AND r."funnelPageId" IS NULL
      AND r."updatedAt" <= p."lastCreditedAt"
    WHERE p."vendorId" = ${vendorId}
      AND f."vendorId" = ${vendorId}
      AND s."verificationStatus" = 'VERIFIED'
      AND p."lastCreditedAt" > ${utcTimestamp(lookbackFrom)}
      AND NOT EXISTS (
        SELECT 1 FROM "AutomationExecutionLog" l
        WHERE l."vendorId" = ${vendorId}
          AND l."eventId" = ${EVENT_PREFIX} || p."formSubmissionId" || ':' || th."percent"::text
          AND l."ruleId" = r."id"
          AND NOT (l."status" = 'running' AND l."startedAt" < ${utcTimestamp(staleRunningBefore)})
          AND NOT (
            l."status" = 'failed'
            AND l."errorCode" = ANY(${retryableCodes}::text[])
            AND l."startedAt" = l."createdAt"
            AND l."completedAt" < ${utcTimestamp(failedRetryBefore)}
          )
      )
    GROUP BY p."formSubmissionId", s."email", p."liveId", p."watchedSeconds", len."seconds", p."lastCreditedAt", th."percent"
    ORDER BY p."lastCreditedAt" ASC, p."formSubmissionId" ASC, th."percent" ASC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({ ...row, vendorId }));
}

/** Each vendor's first candidate, then each vendor's second, ... */
function roundRobin(perVendor: Candidate[][], limit: number) {
  const merged: Candidate[] = [];
  for (let index = 0; merged.length < limit; index += 1) {
    const round = perVendor.flatMap((candidates) => {
      const candidate = candidates[index];
      return candidate ? [candidate] : [];
    });
    if (round.length === 0) break;
    merged.push(...round.slice(0, limit - merged.length));
  }
  return merged;
}

export type WatchProgressReport = "vendor_scan" | "dispatch" | "rule_failed" | "backlog_near_lookback";

function report(error: unknown, operation: WatchProgressReport, fingerprint?: string[]) {
  try {
    captureOperationalError(error, { source: "watch_progress_automation", operation }, fingerprint ? { fingerprint } : undefined);
  } catch {
    // Monitoring must never stop the job.
  }
}

/** Groups repeated reports of one failing event: an opaque digest (no ids reach Sentry) plus the error kind. */
function dispatchFingerprint(candidate: Candidate, error: unknown) {
  const digest = createHash("sha256").update(`${candidate.vendorId}:${watchProgressEventId(candidate.submissionId, candidate.percent)}`).digest("hex").slice(0, 16);
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const kind = /^P\d{4}$/.test(code) ? code : error instanceof Error && /^[A-Za-z]{1,60}$/.test(error.name) ? error.name : "unknown";
  return ["watch-progress-dispatch", digest, kind];
}

/**
 * One watch-progress pass. A thrown rule read rejects (the job reports it); a
 * vendor scan or dispatch that throws is reported and the pass goes on.
 */
export async function runWatchProgressAutomation(options: {
  db?: Db;
  now?: Date;
  limit?: number;
  deadlineMs?: number;
  clock?: () => number;
  /** Scopes one run to these tenants (tests, operations); the job runs unscoped. */
  vendorIds?: string[];
} = {}): Promise<WatchProgressSummary> {
  const db = options.db ?? getDb();
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const now = options.now ?? new Date(startedAt);
  const limit = Math.max(0, Math.min(options.limit ?? WATCH_PROGRESS_EVENT_LIMIT, WATCH_PROGRESS_EVENT_LIMIT));
  const deadlineMs = Math.min(options.deadlineMs ?? WATCH_PROGRESS_DEADLINE_MS, WATCH_PROGRESS_DEADLINE_MS);
  const summary: WatchProgressSummary = {
    vendors: 0, candidates: 0, examined: 0, completed: 0, skipped: 0, failed: 0, duplicate: 0, errors: 0,
    scanCutShort: false, backlogNearLookback: false,
  };
  if (limit === 0 || deadlineMs <= 0) return summary;
  const scanStop = () => clock() - startedAt >= deadlineMs * SCAN_SHARE_OF_DEADLINE;

  const vendors = await vendorsWithRules(db, now, options.vendorIds);
  const perVendor: Candidate[][] = [];
  for (const { vendorId, rules } of vendors) {
    if (scanStop()) {
      summary.scanCutShort = true;
      break;
    }
    summary.vendors += 1;
    try {
      // One row more than the run can take, so a left-over event is seen.
      perVendor.push(await scanVendor(db, vendorId, rules, now, limit + 1));
    } catch (error) {
      summary.errors += 1;
      report(error, "vendor_scan");
    }
  }
  const candidates = roundRobin(perVendor, limit);
  summary.candidates = candidates.length;

  const dispatched = new Set<Candidate>();
  for (const candidate of candidates) {
    if (clock() - startedAt >= deadlineMs) break;
    summary.examined += 1;
    dispatched.add(candidate);
    try {
      const results = await dispatchAutomationEvent(db, {
        vendorId: candidate.vendorId,
        eventId: watchProgressEventId(candidate.submissionId, candidate.percent),
        trigger: "viewer_watch_progress",
        liveId: candidate.liveId,
        subjectType: "buyer_registration",
        subjectId: candidate.submissionId,
        subjectKeyHash: automationCustomerKeyHash(candidate.vendorId, candidate.email),
        recipientEmail: candidate.email,
        watchSecondsTotal: candidate.watchedSeconds,
        watchPercent: watchProgressPercent(candidate.watchedSeconds, candidate.lengthSec),
      }, {
        // The scan's rule choice, re-checked by the dispatch's own rule read.
        rulesUnchangedSince: candidate.lastCreditedAt,
        onlyRuleIds: candidate.ruleIds,
        failedReclaim: { errorCodes: WATCH_PROGRESS_RETRYABLE_ERROR_CODES },
      });
      for (const result of results) {
        if (result.status === "completed") summary.completed += 1;
        else if (result.status === "skipped") summary.skipped += 1;
        else if (result.status === "failed") summary.failed += 1;
        else if (result.status === "duplicate") summary.duplicate += 1;
      }
      if (results.some((result) => result.status === "failed")) {
        report(new Error("Watch progress automation rule failed."), "rule_failed");
      }
    } catch (error) {
      summary.errors += 1;
      report(error, "dispatch", dispatchFingerprint(candidate, error));
    }
  }

  // Events this run found but left (cap or deadline) whose last credit will
  // soon leave the look-back window would be lost for good.
  const alertBefore = now.getTime() - WATCH_PROGRESS_LOOKBACK_MS + WATCH_PROGRESS_BACKLOG_ALERT_MS;
  summary.backlogNearLookback = perVendor.some((rows) => rows.some((row) => !dispatched.has(row) && row.lastCreditedAt.getTime() <= alertBefore));
  if (summary.backlogNearLookback) {
    report(new Error("Watch progress events near the end of the look-back window were left for a later run."), "backlog_near_lookback", ["watch-progress-backlog-near-lookback"]);
  }
  return summary;
}
