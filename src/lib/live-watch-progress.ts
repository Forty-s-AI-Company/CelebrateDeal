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
 * recordAttendanceForAdmission), the server adds the wall-clock time since the
 * registration's previous credit:
 *
 * - at most once per LIVE_WATCH_PROGRESS_CREDIT_INTERVAL_MS (renewals inside
 *   it only read, like the attendance throttle), so one registration costs at
 *   most one row version a minute;
 * - nothing across a gap longer than LIVE_WATCH_PROGRESS_MAX_GAP_MS (the
 *   viewer left, the tab slept, the renewals stopped): the count restarts
 *   from that renewal, so time away is never credited;
 * - one clock per registration: two devices (or tabs) of the same person
 *   renewing together still add at most the wall-clock time, never twice.
 *
 * The browser sends no number at all. A client that keeps renewing without
 * watching is indistinguishable from a tab left open, but it gains at most
 * one second per second per registration, only during its own playing
 * session, and only for a registration whose signed cookie it holds (each
 * needs a confirmed e-mail). The automation pass
 * (src/lib/watch-progress-automation.ts) divides this by the session length.
 */

/** A registration gets credit at most this often (renewals come every 30 s). */
export const LIVE_WATCH_PROGRESS_CREDIT_INTERVAL_MS = 60_000;
/**
 * A gap since the previous credit longer than this credits nothing (the count
 * restarts at this renewal). Two missed 30 s renewals still count; time away
 * from the page is lost instead of credited.
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
 * that is VERIFIED and whose form belongs to this vendor, so another Live's,
 * another tenant's or an unverified registration writes nothing; the
 * composite FKs repeat the binding. INSERT ... ON CONFLICT is atomic on
 * (vendorId, formSubmissionId): the first renewal inserts a row with 0
 * seconds; a later one, once the stored `lastCreditedAt` is at least the
 * credit interval old, adds the time since it when it is within the maximum
 * gap (otherwise nothing) and moves `lastCreditedAt` to now. Inside the
 * interval the SELECT already finds the fresh row and inserts nothing, so the
 * statement only reads (no conflict path, no row lock). Concurrent renewals of
 * the same registration serialize on the row; the second one finds the moved
 * `lastCreditedAt` and changes nothing.
 */
export async function creditLiveWatchProgress(
  input: { vendorId: string; liveId: string; formSubmissionId: string; fallbackFormSubmissionId?: string | null; now?: Date },
  db: RawClient = getDb(),
): Promise<LiveWatchProgressResult> {
  if (!IDENTIFIER.test(input.vendorId) || !IDENTIFIER.test(input.liveId) || !IDENTIFIER.test(input.formSubmissionId)) return "skipped";
  const fallback = input.fallbackFormSubmissionId && IDENTIFIER.test(input.fallbackFormSubmissionId)
    ? input.fallbackFormSubmissionId
    : input.formSubmissionId;
  const nowMs = (input.now ?? new Date()).getTime();
  if (!Number.isSafeInteger(nowMs)) return "skipped";
  const now = new Date(nowMs).toISOString();
  const creditBefore = new Date(nowMs - LIVE_WATCH_PROGRESS_CREDIT_INTERVAL_MS).toISOString();
  const gapFrom = new Date(nowMs - LIVE_WATCH_PROGRESS_MAX_GAP_MS).toISOString();
  // Prisma stores DateTime as UTC timestamp(3); convert explicitly so the
  // session TimeZone setting can never shift the stored instant.
  const rows = await db.$queryRaw<Array<{ watchedSeconds: number }>>`
    WITH chosen AS (
      SELECT submission."id"
      FROM "FormSubmission" AS submission
      INNER JOIN "RegistrationForm" AS form ON form."id" = submission."formId"
      WHERE submission."id" IN (${input.formSubmissionId}, ${fallback})
        AND submission."liveId" = ${input.liveId}
        AND submission."verificationStatus" = 'VERIFIED'
        AND form."vendorId" = ${input.vendorId}
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
      (${now}::timestamptz AT TIME ZONE 'UTC'),
      (${now}::timestamptz AT TIME ZONE 'UTC')
    FROM chosen
    -- Inside the credit interval nothing is inserted, so the statement only
    -- reads (no conflict path, no row lock, no new version).
    WHERE NOT EXISTS (
      SELECT 1 FROM "LiveWatchProgress" AS fresh
      WHERE fresh."vendorId" = ${input.vendorId}
        AND fresh."formSubmissionId" = chosen."id"
        AND fresh."lastCreditedAt" > (${creditBefore}::timestamptz AT TIME ZONE 'UTC')
    )
    ON CONFLICT ("vendorId", "formSubmissionId") DO UPDATE SET
      "watchedSeconds" = LEAST(
        ${LIVE_WATCH_PROGRESS_MAX_SECONDS}::int,
        progress."watchedSeconds" + CASE
          WHEN progress."lastCreditedAt" >= (${gapFrom}::timestamptz AT TIME ZONE 'UTC')
            THEN floor(extract(epoch FROM (EXCLUDED."lastCreditedAt" - progress."lastCreditedAt")))::int
          ELSE 0
        END
      ),
      "lastCreditedAt" = EXCLUDED."lastCreditedAt"
    WHERE progress."liveId" = EXCLUDED."liveId"
      AND progress."lastCreditedAt" <= (${creditBefore}::timestamptz AT TIME ZONE 'UTC')
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
 *   ended it (`endedAt` minus its start, as the no-show job counts it), so
 *   progress on it is only judged after it ended.
 */
export function watchProgressLengthSeconds(live: WatchProgressLive): number | null {
  if (live.streamMode === "vod") {
    const duration = live.video?.vendorId === live.vendorId ? live.video.durationSec : null;
    return typeof duration === "number" && Number.isInteger(duration) && duration > 0 ? duration : null;
  }
  if (live.streamMode === "live") {
    if (live.status !== "ended" || !live.endedAt) return null;
    const startMs = Math.min(live.startedAt?.getTime() ?? live.scheduledAt.getTime(), live.scheduledAt.getTime());
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
