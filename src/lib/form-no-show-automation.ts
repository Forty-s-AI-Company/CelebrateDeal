import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  AUTOMATION_EXECUTION_RECLAIM_AFTER_MS,
  AUTOMATION_FORM_NO_SHOW_FEATURE,
  AUTOMATION_REPLAY_VIDEO_SELECT,
  automationCustomerKeyHash,
  automationReplayOpen,
  automationWebinarUrl,
  dispatchAutomationEvent,
  parseAutomationRule,
} from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { utcTimestamp } from "@/lib/delayed-step-runs";
import {
  EVERGREEN_ACTIVATION_SELECT,
  EVERGREEN_MAX_DURATION_SECONDS,
  evergreenScheduleForLive,
} from "@/lib/evergreen-activation";
import { isFixedSessionLive } from "@/lib/live-fixed-sessions";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * Q-11: the `form_no_show` automation trigger, 「報名後未出席直播」
 * (docs/domain-workflows.md「自動化規則」→「報名後未出席直播」).
 *
 * The e-mail job (/api/jobs/email-deliveries, every 5 minutes) calls
 * `runFormNoShowAutomation` right after the post-live follow-ups: both are
 * driven by "a registrant's session ended", and the automation e-mails it
 * queues are sent by the same round's dispatch.
 *
 * Closed beta (review M-1): only vendors holding the platform grant
 * `automation_form_no_show` are scanned. Attendance is known only for the
 * browser that verified the registration (LiveRegistrationAttendance), so a
 * registrant who watched on another device counts as a no-show.
 *
 * A registration is a no-show for one session when all of these hold (every
 * condition bound to the vendor of the rule):
 * - it is VERIFIED, of this Live, through a form of this vendor, and was
 *   created before the session ended;
 * - its session ended at least FORM_NO_SHOW_GRACE_MS ago (time for the last
 *   admission renewals to be written) and at most FORM_NO_SHOW_LOOKBACK_MS
 *   before that. The session is, by the Live's mode:
 *   - single start (`scheduledAt`): a VOD from `scheduledAt` for the video's
 *     length (cut short at `endedAt` when the merchant ended it, nothing when
 *     it was ended before it started); a real live stream from its start
 *     (`startedAt`, or `scheduledAt` if earlier) to `endedAt` once ended;
 *   - fixed sessions (指定場次): the registrant's own `LiveSession`, not
 *     cancelled, fully played (a Live the merchant ended only counts the
 *     sessions that finished by `endedAt`);
 *   - active evergreen with a merchant anchor: the current shared start;
 *   - active evergreen per visitor: the registrant's recorded
 *     EvergreenSessionAssignment (registrants who never opened the viewer
 *     page have no session and are never no-shows, as with the F-2 follow-up);
 * - it has no LiveRegistrationAttendance whose `lastAdmittedAt` is at or after
 *   the session's start (it was never admitted to play this session or its
 *   replay before the job looked);
 * - for a session every registrant shares (single start, evergreen anchor:
 *   the Live keeps only its current time, so earlier runs leave no record),
 *   review m-4: it was verified (or, without a verification time, created) at
 *   most FORM_NO_SHOW_SHARED_SESSION_REGISTRATION_WINDOW_MS before the session
 *   started, and it has no attendance at all (a registrant who watched an
 *   earlier run of this Live belongs to that run). Fixed and per-visitor
 *   sessions name the registrant's own session and need neither;
 * - the vendor (not suspended, holding the grant) has an active, vendor-wide,
 *   parseable `form_no_show` rule that has not changed since the session
 *   ended (`updatedAt` at or before the end: a rule created, edited or
 *   switched on later never runs for an earlier session) and whose execution
 *   log for this event is missing, a `running` one older than the reclaim
 *   threshold, or a first attempt that ended `failed / action_failed` at
 *   least FORM_NO_SHOW_FAILED_RETRY_AFTER_MS ago (retried once, as the
 *   `payment_paid` catch-up does).
 *
 * The event id is `form-no-show:{submissionId}:{sessionKey}`; the session key
 * names the session by its start (and the fixed session's id), so one
 * registration runs a rule at most once per session (the execution log's
 * idempotency key is built from this id). `{{webinar_url}}` is the Live's
 * viewer page only while its replay is open; otherwise the replay e-mail is
 * skipped as `replay_unavailable` (review m-5).
 *
 * Each run dispatches at most FORM_NO_SHOW_EVENT_LIMIT events, round-robin
 * across vendors (each vendor's earliest-ended no-show first), scans at most
 * FORM_NO_SHOW_VENDOR_LIMIT vendors (starting at a different one every
 * minute). The scan stops at two thirds of the deadline so the rest is left
 * for dispatching; no event starts after the deadline. Events still due near
 * the end of the look-back window are reported once per run (review m-3).
 */

/** A session ended at least this long ago before its registrants can count as no-shows. */
export const FORM_NO_SHOW_GRACE_MS = 30 * 60_000;
/** Sessions that ended (plus the grace) longer ago than this are not run any more. */
export const FORM_NO_SHOW_LOOKBACK_MS = 24 * 60 * 60_000;
/**
 * Review m-4: a session every registrant shares (single start, evergreen
 * anchor) counts registrations verified at most this long before it started.
 * Registration for a webinar typically opens one to two weeks ahead; a Live
 * run again more than 14 days later never mails the earlier run's registrants.
 */
export const FORM_NO_SHOW_SHARED_SESSION_REGISTRATION_WINDOW_MS = 14 * 24 * 60 * 60_000;
/** Events dispatched per run, shared fairly across vendors. */
export const FORM_NO_SHOW_EVENT_LIMIT = 50;
/** Vendors scanned per run; the starting vendor rotates every minute. */
export const FORM_NO_SHOW_VENDOR_LIMIT = 50;
/** Lives looked at per vendor and run (only those that can have a session ending in the window are read). */
const LIVE_SCAN_LIMIT = 200;
/** The pass never runs longer than this. */
export const FORM_NO_SHOW_DEADLINE_MS = 30_000;
/**
 * The pass ends at most this far into the e-mail job round (re-review
 * MINOR-1), so the steps after it (this round's e-mail dispatch, LINE,
 * learner notifications, then the sequence work and its 60 s start cutoff)
 * keep most of the round.
 */
export const FORM_NO_SHOW_ROUTE_BUDGET_MS = 35_000;
/** A deadline shorter than this is not worth starting the pass for. */
export const FORM_NO_SHOW_MIN_DEADLINE_MS = 5_000;
/** The scan may use this share of the deadline; the rest is left for dispatching. */
const SCAN_SHARE_OF_DEADLINE = 2 / 3;
/** Due events whose session ended within this of the look-back limit are reported when a run leaves them. */
export const FORM_NO_SHOW_BACKLOG_ALERT_MS = 2 * 60 * 60_000;
/** A first-attempt `failed` execution is retried once, this long after it ended. */
export const FORM_NO_SHOW_FAILED_RETRY_AFTER_MS = 10 * 60_000;
/** Failure codes worth one retry: an action threw (transient database or outbox errors). */
export const FORM_NO_SHOW_RETRYABLE_ERROR_CODES = ["action_failed"] as const;

const ACTIVE_LIVE_STATUSES = ["scheduled", "live", "ended"];
const EVENT_PREFIX = "form-no-show:";

/**
 * The pass's own deadline for an e-mail job round that has already used
 * `routeElapsedMs` (review m-2, re-review MINOR-1): min(30 s, 35 s −
 * elapsed), or null to skip the pass this round when less than 5 s are left.
 * The pass thus ends by 35 s into the round; it does not by itself guarantee
 * that the later steps finish before the sequence work's start cutoff.
 */
export function formNoShowDeadline(routeElapsedMs: number): number | null {
  if (!Number.isFinite(routeElapsedMs)) return null;
  const left = FORM_NO_SHOW_ROUTE_BUDGET_MS - Math.max(0, routeElapsedMs);
  const deadline = Math.min(FORM_NO_SHOW_DEADLINE_MS, left);
  return deadline >= FORM_NO_SHOW_MIN_DEADLINE_MS ? deadline : null;
}

/** The event id of one registration missing one session (also built in SQL for per-visitor evergreen sessions). */
export function formNoShowEventId(submissionId: string, sessionKey: string) {
  return `${EVENT_PREFIX}${submissionId}:${sessionKey}`;
}

/** Session keys: the session's start in epoch milliseconds, and a fixed session's id. */
export const formNoShowSessionKey = {
  single: (scheduledAt: Date) => `live-${scheduledAt.getTime()}`,
  shared: (startAt: Date) => `shared-${startAt.getTime()}`,
  fixed: (sessionId: string, startAt: Date) => `session-${sessionId}-${startAt.getTime()}`,
  evergreen: (startAt: Date) => `evergreen-${startAt.getTime()}`,
};

export type FormNoShowSummary = {
  /** Vendors with an active rule that this run scanned. */
  vendors: number;
  /** No-show events the run will dispatch (at most FORM_NO_SHOW_EVENT_LIMIT). */
  candidates: number;
  /** Events dispatched this run (the rest hit the deadline). */
  examined: number;
  /** Rule results across the dispatched events. */
  completed: number;
  skipped: number;
  failed: number;
  duplicate: number;
  /** Vendor scans or dispatches that threw (reported; the next run tries again). */
  errors: number;
  /** The scan stopped at its share of the deadline before every vendor or Live was read. */
  scanCutShort: boolean;
  /** Due events left for a later run although their session is close to leaving the look-back window. */
  backlogNearLookback: boolean;
};

type Db = ReturnType<typeof getDb>;

/** One session the registrants of a Live (or of one fixed session) share. */
type SharedSessionSpec = {
  kind: "shared";
  liveId: string;
  liveSlug: string;
  sessionKey: string;
  /** Admissions at or after this instant count as having watched it. */
  attendFrom: Date;
  endAt: Date;
  liveSessionId?: string;
  /** Review m-4: only registrations verified from here on, and any attendance excludes (shared sessions only). */
  registeredFrom?: Date;
  replayOpen: boolean;
};

/** Per-visitor evergreen sessions whose end lies in the window. */
type EvergreenSessionSpec = {
  kind: "evergreen";
  liveId: string;
  liveSlug: string;
  durationSec: number;
  startAfter: Date;
  startUntil: Date;
  replayOpen: boolean;
};

type SessionSpec = SharedSessionSpec | EvergreenSessionSpec;

type Candidate = {
  vendorId: string;
  submissionId: string;
  email: string;
  endAt: Date;
  eventId: string;
  ruleIds: string[];
  /** The replay link, only while the replay is open. */
  webinarUrl?: string;
};

type Window = { dueBefore: Date; dueAfter: Date };

/** Session ends in (dueAfter, dueBefore] are due now. */
function windowFor(now: Date): Window {
  const dueBefore = new Date(now.getTime() - FORM_NO_SHOW_GRACE_MS);
  return { dueBefore, dueAfter: new Date(dueBefore.getTime() - FORM_NO_SHOW_LOOKBACK_MS) };
}

function inWindow(endAt: Date, window: Window) {
  return endAt.getTime() <= window.dueBefore.getTime() && endAt.getTime() > window.dueAfter.getTime();
}

function videoSeconds(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

const LIVE_SELECT = {
  id: true,
  vendorId: true,
  slug: true,
  scheduledAt: true,
  startedAt: true,
  endedAt: true,
  replayEnabled: true,
  replayAvailableUntil: true,
  sessionReplayWindowHours: true,
  ...EVERGREEN_ACTIVATION_SELECT,
  video: { select: AUTOMATION_REPLAY_VIDEO_SELECT },
} as const;

type ScannedLive = Prisma.LiveGetPayload<{ select: typeof LIVE_SELECT }> & { sessions: Array<{ id: string; startAt: Date }> };

function registeredFrom(startAt: Date) {
  return new Date(startAt.getTime() - FORM_NO_SHOW_SHARED_SESSION_REGISTRATION_WINDOW_MS);
}

/** The sessions of one Live whose no-show is due now (see the module comment). */
export function formNoShowSessionsForLive(live: ScannedLive, vendorTimezone: string | null | undefined, now: Date): SessionSpec[] {
  if (!ACTIVE_LIVE_STATUSES.includes(live.status)) return [];
  const window = windowFor(now);
  const base = { liveId: live.id, liveSlug: live.slug };
  const liveReplayOpen = automationReplayOpen(live, null, now);
  const evergreen = evergreenScheduleForLive(live, vendorTimezone, now);
  if (evergreen) {
    const durationSec = evergreen.durationSeconds;
    if (evergreen.sharedStartAt) {
      const endAt = new Date(evergreen.sharedStartAt.getTime() + durationSec * 1_000);
      return inWindow(endAt, window)
        ? [{
          kind: "shared", ...base,
          sessionKey: formNoShowSessionKey.shared(evergreen.sharedStartAt),
          attendFrom: evergreen.sharedStartAt, endAt,
          registeredFrom: registeredFrom(evergreen.sharedStartAt),
          replayOpen: liveReplayOpen,
        }]
        : [];
    }
    return [{
      kind: "evergreen",
      ...base,
      durationSec,
      startAfter: new Date(window.dueAfter.getTime() - durationSec * 1_000),
      startUntil: new Date(window.dueBefore.getTime() - durationSec * 1_000),
      replayOpen: liveReplayOpen,
    }];
  }
  if (isFixedSessionLive(live)) {
    const durationSec = videoSeconds(live.video?.durationSec);
    if (!durationSec) return [];
    // Only sessions that played to their end: all of them while the Live
    // runs, those that finished by `endedAt` once the merchant ended it.
    const playedUntil = live.status === "ended"
      ? live.endedAt ? live.endedAt.getTime() - durationSec * 1_000 : null
      : Number.POSITIVE_INFINITY;
    if (playedUntil === null) return [];
    return live.sessions.flatMap((session) => {
      const endAt = new Date(session.startAt.getTime() + durationSec * 1_000);
      if (session.startAt.getTime() > playedUntil || !inWindow(endAt, window)) return [];
      return [{
        kind: "shared" as const,
        ...base,
        sessionKey: formNoShowSessionKey.fixed(session.id, session.startAt),
        attendFrom: session.startAt,
        endAt,
        liveSessionId: session.id,
        replayOpen: automationReplayOpen(live, session, now),
      }];
    });
  }
  const single = {
    kind: "shared" as const,
    ...base,
    sessionKey: formNoShowSessionKey.single(live.scheduledAt),
    replayOpen: liveReplayOpen,
  };
  if (live.streamMode === "vod") {
    const durationSec = videoSeconds(live.video?.durationSec);
    if (!durationSec) return [];
    const start = live.scheduledAt.getTime();
    let end = start + durationSec * 1_000;
    if (live.status === "ended") {
      // Ended by the merchant before it started: nobody could have watched.
      if (!live.endedAt || live.endedAt.getTime() <= start) return [];
      end = Math.min(end, live.endedAt.getTime());
    }
    const endAt = new Date(end);
    return inWindow(endAt, window)
      ? [{ ...single, attendFrom: live.scheduledAt, endAt, registeredFrom: registeredFrom(live.scheduledAt) }]
      : [];
  }
  if (live.streamMode === "live") {
    if (live.status !== "ended" || !live.endedAt) return [];
    const startMs = Math.min(live.startedAt?.getTime() ?? live.scheduledAt.getTime(), live.scheduledAt.getTime());
    if (live.endedAt.getTime() <= startMs || !inWindow(live.endedAt, window)) return [];
    const attendFrom = new Date(startMs);
    return [{ ...single, attendFrom, endAt: live.endedAt, registeredFrom: registeredFrom(attendFrom) }];
  }
  return [];
}

/** The registrants of one session spec, as rows of (submission, email, attendFrom, endAt, eventId). */
function registrantsSql(vendorId: string, spec: SessionSpec) {
  if (spec.kind === "shared") {
    return Prisma.sql`
      SELECT s."id" AS "submissionId", s."email",
             ${utcTimestamp(spec.attendFrom)} AS "attendFrom",
             ${utcTimestamp(spec.endAt)} AS "endAt",
             ${EVENT_PREFIX} || s."id" || ':' || ${spec.sessionKey} AS "eventId"
      FROM "FormSubmission" s
      JOIN "RegistrationForm" f ON f."id" = s."formId"
      WHERE s."liveId" = ${spec.liveId}
        AND f."vendorId" = ${vendorId}
        AND s."verificationStatus" = 'VERIFIED'
        AND s."createdAt" < ${utcTimestamp(spec.endAt)}
        ${spec.liveSessionId ? Prisma.sql`AND s."liveSessionId" = ${spec.liveSessionId}` : Prisma.empty}
        ${spec.registeredFrom ? Prisma.sql`AND COALESCE(s."verifiedAt", s."createdAt") >= ${utcTimestamp(spec.registeredFrom)}` : Prisma.empty}
    `;
  }
  // The key is formNoShowSessionKey.evergreen(sessionStartAt), in SQL.
  return Prisma.sql`
    SELECT s."id" AS "submissionId", s."email",
           a."sessionStartAt" AS "attendFrom",
           a."sessionStartAt" + (${spec.durationSec}::int * interval '1 second') AS "endAt",
           ${EVENT_PREFIX} || s."id" || ':evergreen-' || (round(extract(epoch FROM a."sessionStartAt") * 1000))::bigint::text AS "eventId"
    FROM "EvergreenSessionAssignment" a
    JOIN "FormSubmission" s ON s."id" = a."formSubmissionId" AND s."liveId" = a."liveId"
    JOIN "RegistrationForm" f ON f."id" = s."formId"
    WHERE a."vendorId" = ${vendorId}
      AND a."liveId" = ${spec.liveId}
      AND a."sessionStartAt" > ${utcTimestamp(spec.startAfter)}
      AND a."sessionStartAt" <= ${utcTimestamp(spec.startUntil)}
      AND f."vendorId" = ${vendorId}
      AND s."verificationStatus" = 'VERIFIED'
      AND s."createdAt" < a."sessionStartAt" + (${spec.durationSec}::int * interval '1 second')
  `;
}

/**
 * The no-shows of one session spec still owed a rule, earliest-ended first.
 * Attendance and execution logs are read through their (vendorId,
 * formSubmissionId) and (vendorId, eventId) indexes.
 */
function scanSession(db: Db, vendorId: string, spec: SessionSpec, ruleIds: string[], now: Date, limit: number) {
  const staleRunningBefore = new Date(now.getTime() - AUTOMATION_EXECUTION_RECLAIM_AFTER_MS);
  const failedRetryBefore = new Date(now.getTime() - FORM_NO_SHOW_FAILED_RETRY_AFTER_MS);
  const retryableCodes = [...FORM_NO_SHOW_RETRYABLE_ERROR_CODES];
  // m-4: in a shared session any attendance (also of an earlier run) excludes.
  const watchedSince = spec.kind === "shared" && spec.registeredFrom ? Prisma.empty : Prisma.sql`AND att."lastAdmittedAt" >= reg."attendFrom"`;
  return db.$queryRaw<Array<Omit<Candidate, "vendorId" | "webinarUrl">>>(Prisma.sql`
    WITH "registrant" AS (${registrantsSql(vendorId, spec)})
    SELECT reg."submissionId", reg."email", reg."endAt", reg."eventId", rr."ruleIds"
    FROM "registrant" reg
    JOIN LATERAL (
      SELECT array_agg(r."id" ORDER BY r."createdAt" ASC, r."id" ASC) AS "ruleIds"
      FROM "AutomationRule" r
      WHERE r."vendorId" = ${vendorId}
        AND r."trigger" = 'form_no_show'
        AND r."isActive" = true
        AND r."funnelPageId" IS NULL
        AND r."id" = ANY(${ruleIds}::text[])
        AND r."updatedAt" <= reg."endAt"
        AND NOT EXISTS (
          SELECT 1 FROM "AutomationExecutionLog" l
          WHERE l."vendorId" = ${vendorId}
            AND l."eventId" = reg."eventId"
            AND l."ruleId" = r."id"
            AND NOT (l."status" = 'running' AND l."startedAt" < ${utcTimestamp(staleRunningBefore)})
            AND NOT (
              l."status" = 'failed'
              AND l."errorCode" = ANY(${retryableCodes}::text[])
              AND l."startedAt" = l."createdAt"
              AND l."completedAt" < ${utcTimestamp(failedRetryBefore)}
            )
        )
    ) rr ON rr."ruleIds" IS NOT NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM "LiveRegistrationAttendance" att
      WHERE att."vendorId" = ${vendorId}
        AND att."formSubmissionId" = reg."submissionId"
        ${watchedSince}
    )
    ORDER BY reg."endAt" ASC, reg."submissionId" ASC
    LIMIT ${limit}
  `);
}

/** One vendor's due no-shows, earliest-ended first, at most `limit` + 1; `stop()` cuts the scan short between sessions. */
async function scanVendor(db: Db, vendorId: string, ruleIds: string[], now: Date, limit: number, stop: () => boolean) {
  const window = windowFor(now);
  // A session can last at most a day (the evergreen and fixed-session video
  // ceiling), so one that ends in the window started after this.
  const earliestStart = new Date(window.dueAfter.getTime() - EVERGREEN_MAX_DURATION_SECONDS * 1_000);
  const sessionWhere = {
    vendorId,
    status: { not: "cancelled" },
    startAt: { gt: earliestStart, lte: window.dueBefore },
  } satisfies Prisma.LiveSessionWhereInput;
  const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: { timezone: true } });
  const lives = await db.live.findMany({
    where: {
      vendorId,
      status: { in: ACTIVE_LIVE_STATUSES },
      OR: [
        { isEvergreen: true, status: { in: ["scheduled", "live"] } },
        { sessionMode: "fixed_sessions", sessions: { some: sessionWhere } },
        { scheduledAt: { gt: earliestStart, lte: window.dueBefore } },
        { endedAt: { gt: window.dueAfter } },
      ],
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: LIVE_SCAN_LIMIT,
    select: { ...LIVE_SELECT, sessions: { where: sessionWhere, orderBy: { startAt: "asc" }, select: { id: true, startAt: true } } },
  });
  const found: Candidate[] = [];
  let cutShort = false;
  scan: for (const live of lives) {
    for (const spec of formNoShowSessionsForLive(live, vendor?.timezone, now)) {
      if (stop()) {
        cutShort = true;
        break scan;
      }
      const webinarUrl = spec.replayOpen ? automationWebinarUrl(spec.liveSlug) : undefined;
      // One row more than the run can take, so a left-over event is seen (m-3).
      const rows = await scanSession(db, vendorId, spec, ruleIds, now, limit + 1);
      found.push(...rows.map((row) => ({ ...row, vendorId, ...(webinarUrl ? { webinarUrl } : {}) })));
    }
  }
  return {
    candidates: found
      .sort((left, right) => left.endAt.getTime() - right.endAt.getTime() || left.submissionId.localeCompare(right.submissionId))
      .slice(0, limit + 1),
    cutShort,
  };
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

/** Vendors holding the grant with a runnable rule, and those rules' ids, in a rotating order. */
async function vendorsWithRules(db: Db, now: Date, onlyVendorIds: string[] | undefined) {
  const rules = await db.automationRule.findMany({
    where: {
      trigger: "form_no_show",
      isActive: true,
      funnelPageId: null,
      // Closed beta (review M-1): a vendor without the grant is never scanned.
      vendor: { suspendedAt: null, betaFeatureGrants: { has: AUTOMATION_FORM_NO_SHOW_FEATURE } },
      ...(onlyVendorIds ? { vendorId: { in: onlyVendorIds } } : {}),
    },
    orderBy: [{ vendorId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, vendorId: true, version: true, condition: true, actions: true },
  });
  const byVendor = new Map<string, string[]>();
  for (const rule of rules) {
    // An unparseable rule never writes a log, so it would be chosen again
    // every run: leave it out (the dispatch would answer invalid_rule).
    if (!parseAutomationRule(rule)) continue;
    byVendor.set(rule.vendorId, [...byVendor.get(rule.vendorId) ?? [], rule.id]);
  }
  const vendors = [...byVendor.keys()];
  const offset = vendors.length ? Math.floor(now.getTime() / 60_000) % vendors.length : 0;
  return [...vendors.slice(offset), ...vendors.slice(0, offset)]
    .slice(0, FORM_NO_SHOW_VENDOR_LIMIT)
    .map((vendorId) => ({ vendorId, ruleIds: byVendor.get(vendorId) ?? [] }));
}

export type FormNoShowReport = "vendor_scan" | "dispatch" | "rule_failed" | "backlog_near_lookback";

function report(error: unknown, operation: FormNoShowReport, fingerprint?: string[]) {
  try {
    captureOperationalError(error, { source: "form_no_show_automation", operation }, fingerprint ? { fingerprint } : undefined);
  } catch {
    // Monitoring must never stop the job.
  }
}

/** Groups repeated reports of one failing event: an opaque digest (no ids reach Sentry) plus the error kind. */
function dispatchFingerprint(candidate: Candidate, error: unknown) {
  const digest = createHash("sha256").update(`${candidate.vendorId}:${candidate.eventId}`).digest("hex").slice(0, 16);
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const kind = /^P\d{4}$/.test(code) ? code : error instanceof Error && /^[A-Za-z]{1,60}$/.test(error.name) ? error.name : "unknown";
  return ["form-no-show-dispatch", digest, kind];
}

/**
 * One no-show pass. A thrown rule read rejects (the job reports it); a vendor
 * scan or dispatch that throws is reported and the pass goes on.
 */
export async function runFormNoShowAutomation(options: {
  db?: Db;
  now?: Date;
  limit?: number;
  deadlineMs?: number;
  clock?: () => number;
  /** Scopes one run to these tenants (tests, operations); the job runs unscoped. */
  vendorIds?: string[];
} = {}): Promise<FormNoShowSummary> {
  const db = options.db ?? getDb();
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const now = options.now ?? new Date(startedAt);
  const limit = Math.max(0, Math.min(options.limit ?? FORM_NO_SHOW_EVENT_LIMIT, FORM_NO_SHOW_EVENT_LIMIT));
  const deadlineMs = Math.min(options.deadlineMs ?? FORM_NO_SHOW_DEADLINE_MS, FORM_NO_SHOW_DEADLINE_MS);
  const summary: FormNoShowSummary = {
    vendors: 0, candidates: 0, examined: 0, completed: 0, skipped: 0, failed: 0, duplicate: 0, errors: 0,
    scanCutShort: false, backlogNearLookback: false,
  };
  if (limit === 0 || deadlineMs <= 0) return summary;
  // Review m-2: the scan leaves a third of the deadline for dispatching.
  const scanStop = () => clock() - startedAt >= deadlineMs * SCAN_SHARE_OF_DEADLINE;

  const vendors = await vendorsWithRules(db, now, options.vendorIds);
  const perVendor: Candidate[][] = [];
  for (const { vendorId, ruleIds } of vendors) {
    if (scanStop()) {
      summary.scanCutShort = true;
      break;
    }
    summary.vendors += 1;
    try {
      const scanned = await scanVendor(db, vendorId, ruleIds, now, limit, scanStop);
      perVendor.push(scanned.candidates);
      if (scanned.cutShort) summary.scanCutShort = true;
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
        eventId: candidate.eventId,
        trigger: "form_no_show",
        subjectType: "buyer_registration",
        subjectId: candidate.submissionId,
        subjectKeyHash: automationCustomerKeyHash(candidate.vendorId, candidate.email),
        recipientEmail: candidate.email,
        ...(candidate.webinarUrl ? { webinarUrl: candidate.webinarUrl } : {}),
      }, {
        // The scan's rule choice, re-checked by the dispatch's own rule read.
        rulesUnchangedSince: candidate.endAt,
        onlyRuleIds: candidate.ruleIds,
        failedReclaim: { errorCodes: FORM_NO_SHOW_RETRYABLE_ERROR_CODES },
      });
      for (const result of results) {
        if (result.status === "completed") summary.completed += 1;
        else if (result.status === "skipped") summary.skipped += 1;
        else if (result.status === "failed") summary.failed += 1;
        else if (result.status === "duplicate") summary.duplicate += 1;
      }
      // Which rule and why stays on its execution log, visible to the merchant.
      if (results.some((result) => result.status === "failed")) {
        report(new Error("Form no-show automation rule failed."), "rule_failed");
      }
    } catch (error) {
      summary.errors += 1;
      report(error, "dispatch", dispatchFingerprint(candidate, error));
    }
  }

  // Review m-3: events this run found but left (cap or deadline) whose
  // session will soon leave the look-back window would be lost for good.
  const alertBefore = windowFor(now).dueAfter.getTime() + FORM_NO_SHOW_BACKLOG_ALERT_MS;
  summary.backlogNearLookback = perVendor.some((rows) => rows.some((row) => !dispatched.has(row) && row.endAt.getTime() <= alertBefore));
  if (summary.backlogNearLookback) {
    report(new Error("Form no-show events near the end of the look-back window were left for a later run."), "backlog_near_lookback", ["form-no-show-backlog-near-lookback"]);
  }
  return summary;
}
