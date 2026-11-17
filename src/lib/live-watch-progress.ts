import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

/**
 * Q-11 `viewer_watch_progress`: how long one registration watched a Live
 * (LiveWatchProgress), counted by the server.
 *
 * The viewer page renews its playback admission (/api/live-admission) when it
 * opens and then every 30 seconds; the server grants one only while the
 * viewer's own session is playing or in replay (admitLiveViewer). When a
 * renewal is granted while that session is *playing* (not the replay) and
 * the request identifies a VERIFIED registration of this Live (the same two
 * signed cookies as LiveRegistrationAttendance, resolved by
 * recordAttendanceForAdmission), the server adds the time since the
 * registration's previous credit, read from the database clock:
 *
 * - at most once per LIVE_WATCH_PROGRESS_CREDIT_INTERVAL_MS, a little under
 *   the 30 s renewal period, so every renewal of a steady viewer is credited
 *   even when it arrives a little early (review MINOR-B) and at most the tail
 *   since the last renewal is lost (renewals inside it only read, like the
 *   attendance throttle);
 * - nothing across a gap longer than LIVE_WATCH_PROGRESS_MAX_GAP_MS (the
 *   viewer left, the tab slept, the renewals stopped): the count restarts
 *   from that renewal, so time away is never credited;
 * - one clock per registration: two devices (or tabs) of the same person
 *   renewing together still add at most the elapsed time, never twice;
 * - on a fixed-session Live (指定場次), only while the registration's own
 *   session is the one playing for this viewer (review MINOR-1): a device that
 *   entered through the attendance-only cookie follows the public schedule,
 *   and another session's playing time never counts for the registrant.
 *
 * The browser sends no number at all. A client that keeps renewing without
 * watching is indistinguishable from a tab left open, but it gains at most
 * one second per second per registration, only during its own playing
 * session, and only for a registration whose signed cookie it holds (each
 * needs a confirmed e-mail). The automation pass
 * (src/lib/watch-progress-automation.ts) divides this by the session length.
 */

/**
 * A registration gets credit at most this often. Renewals come every 30 s;
 * 5 s of slack keeps a renewal that arrives early (timer or network jitter,
 * e.g. after 29.9 s) from being skipped (review MINOR-B).
 */
export const LIVE_WATCH_PROGRESS_CREDIT_INTERVAL_MS = 25_000;
/**
 * A gap since the previous credit longer than this credits nothing (the count
 * restarts at this renewal). Three missed 30 s renewals still count; time
 * away from the page is lost instead of credited.
 */
export const LIVE_WATCH_PROGRESS_MAX_GAP_MS = 120_000;
/** Ceiling of the stored count (CHECK in 20261118090000_live_watch_progress): 30 days. */
export const LIVE_WATCH_PROGRESS_MAX_SECONDS = 2_592_000;

type RawClient = Pick<Prisma.TransactionClient, "$queryRaw">;

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;

export type LiveWatchProgressResult = "recorded" | "unchanged" | "skipped";

/**
 * Credits one registration's watch time in one statement.
 *
 * `formSubmissionId` is preferred; `fallbackFormSubmissionId` (optional) is
 * used only when the preferred one is not an eligible registration (the same
 * choice as recordLiveRegistrationAttendance). The eligibility check is part
 * of the write: the `chosen` CTE picks at most one FormSubmission of this Live
 * that is VERIFIED and whose form belongs to this vendor (and, with
 * `liveSessionId`, that chose the fixed session playing now), so another
 * Live's, another tenant's, another session's or an unverified registration
 * writes nothing; the composite FKs repeat the binding. INSERT ... ON CONFLICT
 * is atomic on (vendorId, formSubmissionId): the first renewal inserts a row
 * with 0 seconds; a later one, once the stored `lastCreditedAt` is at least
 * the credit interval old, adds the time since it when it is within the
 * maximum gap (otherwise nothing) and moves `lastCreditedAt` to now. Inside
 * the interval the SELECT already finds the fresh row and inserts nothing, so
 * the statement only reads (no conflict path, no row lock). Concurrent
 * renewals of the same registration serialize on the row; the second one
 * finds the moved `lastCreditedAt` and changes nothing.
 *
 * "Now" is the database's `statement_timestamp()` (review MINOR-5), so app
 * servers with skewed clocks share one clock. `now` overrides it for tests
 * only; production callers never pass it.
 */
export async function creditLiveWatchProgress(
  input: { vendorId: string; liveId: string; formSubmissionId: string; fallbackFormSubmissionId?: string | null; liveSessionId?: string | null; now?: Date },
  db: RawClient = getDb(),
): Promise<LiveWatchProgressResult> {
  if (!IDENTIFIER.test(input.vendorId) || !IDENTIFIER.test(input.liveId) || !IDENTIFIER.test(input.formSubmissionId)) return "skipped";
  if (input.liveSessionId != null && !IDENTIFIER.test(input.liveSessionId)) return "skipped";
  const fallback = input.fallbackFormSubmissionId && IDENTIFIER.test(input.fallbackFormSubmissionId)
    ? input.fallbackFormSubmissionId
    : input.formSubmissionId;
  let override: string | null = null;
  if (input.now) {
    const nowMs = input.now.getTime();
    if (!Number.isSafeInteger(nowMs)) return "skipped";
    override = new Date(nowMs).toISOString();
  }
  const liveSessionId = input.liveSessionId ?? null;
  // Prisma stores DateTime as UTC timestamp(3); convert explicitly so the
  // session TimeZone setting can never shift the stored instant. EXCLUDED's
  // lastCreditedAt is this statement's "now" in the conflict path.
  const rows = await db.$queryRaw<Array<{ watchedSeconds: number }>>`
    WITH clock AS (
      SELECT (COALESCE(${override}::timestamptz, statement_timestamp()) AT TIME ZONE 'UTC')::timestamp(3) AS "now"
    ),
    chosen AS (
      SELECT submission."id"
      FROM "FormSubmission" AS submission
      INNER JOIN "RegistrationForm" AS form ON form."id" = submission."formId"
      WHERE submission."id" IN (${input.formSubmissionId}, ${fallback})
        AND submission."liveId" = ${input.liveId}
        AND submission."verificationStatus" = 'VERIFIED'
        AND form."vendorId" = ${input.vendorId}
        AND (${liveSessionId}::text IS NULL OR submission."liveSessionId" = ${liveSessionId}::text)
      ORDER BY (submission."id" = ${input.formSubmissionId}) DESC
      LIMIT 1
    )
    INSERT INTO "LiveWatchProgress" AS progress
      ("id", "vendorId", "liveId", "formSubmissionId", "watchedSeconds", "firstCreditedAt", "lastCreditedAt")
    SELECT
      ${randomUUID()},
      ${input.vendorId},
      ${input.liveId},
      chosen."id",
      0,
      clock."now",
      clock."now"
    FROM chosen CROSS JOIN clock
    -- Inside the credit interval nothing is inserted, so the statement only
    -- reads (no conflict path, no row lock, no new version).
    WHERE NOT EXISTS (
      SELECT 1 FROM "LiveWatchProgress" AS fresh
      WHERE fresh."vendorId" = ${input.vendorId}
        AND fresh."formSubmissionId" = chosen."id"
        AND fresh."lastCreditedAt" > clock."now" - (${LIVE_WATCH_PROGRESS_CREDIT_INTERVAL_MS}::int * interval '1 millisecond')
    )
    ON CONFLICT ("vendorId", "formSubmissionId") DO UPDATE SET
      "watchedSeconds" = LEAST(
        ${LIVE_WATCH_PROGRESS_MAX_SECONDS}::int,
        progress."watchedSeconds" + CASE
          WHEN progress."lastCreditedAt" >= EXCLUDED."lastCreditedAt" - (${LIVE_WATCH_PROGRESS_MAX_GAP_MS}::int * interval '1 millisecond')
            THEN floor(extract(epoch FROM (EXCLUDED."lastCreditedAt" - progress."lastCreditedAt")))::int
          ELSE 0
        END
      ),
      "lastCreditedAt" = EXCLUDED."lastCreditedAt"
    WHERE progress."liveId" = EXCLUDED."liveId"
      AND progress."lastCreditedAt" <= EXCLUDED."lastCreditedAt" - (${LIVE_WATCH_PROGRESS_CREDIT_INTERVAL_MS}::int * interval '1 millisecond')
    RETURNING progress."watchedSeconds"`;
  return rows.length === 1 ? "recorded" : "unchanged";
}

/** The Live fields watchProgressLengthSeconds reads. */
export const WATCH_PROGRESS_LIVE_SELECT = {
  id: true,
  vendorId: true,
  streamMode: true,
  status: true,
  scheduledAt: true,
  startedAt: true,
  endedAt: true,
  video: { select: { vendorId: true, durationSec: true } },
} as const;

export type WatchProgressLive = {
  vendorId: string;
  streamMode: string;
  status: string;
  scheduledAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  video: { vendorId: string; durationSec: number | null } | null;
};

/**
 * The length one session of this Live lasts, in seconds: the denominator of
 * the watch progress, or null when it is not known (yet).
 *
 * - A VOD-based Live (single start, fixed sessions or evergreen, which all
 *   play the Live's own video) lasts the video's length.
 * - A real live stream has no planned length; it is known once the merchant
 *   ended it: the time it actually played, `endedAt` minus `startedAt`
 *   (`scheduledAt` when it never recorded a start). A stream started late is
 *   not measured from its scheduled time (review MAJOR-1), so a viewer who
 *   watched all of it reaches 100 %. Progress on it is only judged after it
 *   ended.
 */
export function watchProgressLengthSeconds(live: WatchProgressLive): number | null {
  if (live.streamMode === "vod") {
    const duration = live.video?.vendorId === live.vendorId ? live.video.durationSec : null;
    return typeof duration === "number" && Number.isInteger(duration) && duration > 0 ? duration : null;
  }
  if (live.streamMode === "live") {
    if (live.status !== "ended" || !live.endedAt) return null;
    const startMs = (live.startedAt ?? live.scheduledAt).getTime();
    const seconds = Math.floor((live.endedAt.getTime() - startMs) / 1_000);
    return seconds > 0 ? seconds : null;
  }
  return null;
}

/** Whole percent watched, 0 to 100 (floor: 49.9 % is 49). */
export function watchProgressPercent(watchedSeconds: number, lengthSeconds: number) {
  if (!Number.isFinite(watchedSeconds) || !Number.isFinite(lengthSeconds) || lengthSeconds <= 0 || watchedSeconds <= 0) return 0;
  return Math.min(100, Math.floor((watchedSeconds * 100) / lengthSeconds));
}
