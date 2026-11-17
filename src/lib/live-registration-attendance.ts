import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { registrationSubmissionIdFromRequest } from "@/lib/evergreen-session-assignment";
import { liveAttendanceSubmissionIdFromRequest } from "@/lib/live-attendance-cookie";
import { creditLiveWatchProgress } from "@/lib/live-watch-progress";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * Q-11 `form_no_show`: which registrant was admitted to play a Live
 * (LiveRegistrationAttendance).
 *
 * The viewer page asks /api/live-admission for a playback admission when it
 * opens and then every 30 seconds; the server only grants one while the
 * viewer's own session is playing or in replay (admitLiveViewer). When such a
 * request also identifies a VERIFIED registration of that Live, the server
 * records when that registration was first and last admitted. Two signed
 * cookies identify one, each verified with its own key:
 *
 * - the registration cookie (FORM_SUBMISSION_CHAT_SESSION_COOKIE), set where
 *   the e-mail was confirmed;
 * - the attendance-only cookie of this Live (live-attendance-cookie.ts), set
 *   by a personal watch link from a reminder or live-start notice (Q-17). It
 *   is read here and nowhere else.
 *
 * When both name an eligible registration of this Live, the registration
 * cookie wins. The no-show job (src/lib/form-no-show-automation.ts) treats a
 * registration whose `lastAdmittedAt` is at or after its session's start as
 * having watched that session.
 *
 * Every value written comes from the server: the submission id from a cookie
 * whose signature was verified, the Live and vendor from an admission that
 * was just granted, the time from the server clock. Visitors with neither
 * cookie are never recorded; they count as not having watched
 * (docs/domain-workflows.md「報名後未出席直播」).
 */

/**
 * `lastAdmittedAt` moves forward at most this often, so a viewer's 30-second
 * admission renewals write at most one row version every 5 minutes. A session
 * that starts less than this after the registrant's previous admission is the
 * only case it can blur, and the viewer's next renewals in that session move
 * it past the start anyway.
 */
export const LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS = 5 * 60_000;

type RawClient = Pick<Prisma.TransactionClient, "$queryRaw">;

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;

export type LiveRegistrationAttendanceResult = "recorded" | "unchanged" | "skipped";

/**
 * Records (or refreshes) one registration's admission in one statement.
 *
 * `formSubmissionId` is preferred; `fallbackFormSubmissionId` (optional) is
 * used only when the preferred one is not an eligible registration. The
 * eligibility check is part of the write: the `chosen` CTE picks at most one
 * FormSubmission of this Live that is VERIFIED and whose form belongs to this
 * vendor, so another Live's, another tenant's or an unverified registration
 * writes nothing. The composite FKs repeat the binding. INSERT ... ON CONFLICT
 * is atomic on (vendorId, formSubmissionId); a conflicting call only moves
 * `lastAdmittedAt` forward, and only once the stored value is at least
 * LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS old. Inside that interval the
 * SELECT already finds the fresh row and inserts nothing, so the 30-second
 * renewals neither lock nor rewrite the row (review m-1). The freshness check
 * applies to the chosen registration only, so a fresh preferred registration
 * never hands the write to the fallback.
 */
export async function recordLiveRegistrationAttendance(
  input: { vendorId: string; liveId: string; formSubmissionId: string; fallbackFormSubmissionId?: string | null; now?: Date },
  db: RawClient = getDb(),
): Promise<LiveRegistrationAttendanceResult> {
  if (!IDENTIFIER.test(input.vendorId) || !IDENTIFIER.test(input.liveId) || !IDENTIFIER.test(input.formSubmissionId)) return "skipped";
  const fallback = input.fallbackFormSubmissionId && IDENTIFIER.test(input.fallbackFormSubmissionId)
    ? input.fallbackFormSubmissionId
    : input.formSubmissionId;
  const nowMs = (input.now ?? new Date()).getTime();
  if (!Number.isSafeInteger(nowMs)) return "skipped";
  const now = new Date(nowMs).toISOString();
  const refreshBefore = new Date(nowMs - LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS).toISOString();
  // Prisma stores DateTime as UTC timestamp(3); convert explicitly so the
  // session TimeZone setting can never shift the stored instant.
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    WITH chosen AS (
      SELECT submission."id"
      FROM "FormSubmission" AS submission
      INNER JOIN "RegistrationForm" AS form ON form."id" = submission."formId"
      WHERE submission."id" IN (${input.formSubmissionId}, ${fallback})
        AND submission."liveId" = ${input.liveId}
        AND submission."verificationStatus" = 'VERIFIED'
        AND form."vendorId" = ${input.vendorId}
      -- The registration cookie's registration first (Q-17).
      ORDER BY (submission."id" = ${input.formSubmissionId}) DESC
      LIMIT 1
    )
    INSERT INTO "LiveRegistrationAttendance" AS attendance
      ("id", "vendorId", "liveId", "formSubmissionId", "firstAdmittedAt", "lastAdmittedAt")
    SELECT
      ${randomUUID()},
      ${input.vendorId},
      ${input.liveId},
      chosen."id",
      (${now}::timestamptz AT TIME ZONE 'UTC'),
      (${now}::timestamptz AT TIME ZONE 'UTC')
    FROM chosen
    -- Review m-1: inside the refresh interval nothing is inserted, so the
    -- statement only reads (no conflict path, no row lock, no new version).
    WHERE NOT EXISTS (
      SELECT 1 FROM "LiveRegistrationAttendance" AS fresh
      WHERE fresh."vendorId" = ${input.vendorId}
        AND fresh."formSubmissionId" = chosen."id"
        AND fresh."lastAdmittedAt" > (${refreshBefore}::timestamptz AT TIME ZONE 'UTC')
    )
    ON CONFLICT ("vendorId", "formSubmissionId") DO UPDATE SET
      "lastAdmittedAt" = EXCLUDED."lastAdmittedAt"
    WHERE attendance."liveId" = EXCLUDED."liveId"
      AND attendance."lastAdmittedAt" <= (${refreshBefore}::timestamptz AT TIME ZONE 'UTC')
    RETURNING attendance."id"`;
  return rows.length === 1 ? "recorded" : "unchanged";
}

function reportFailure(error: unknown, operation: "record" | "watch_progress") {
  try {
    captureOperationalError(error, { source: "live_registration_attendance", operation, status: "failed" });
  } catch {
    // Monitoring cannot change the response.
  }
}

/**
 * Best-effort recording for /api/live-admission after it granted an
 * admission. It never throws: a failure is reported and the admission answers
 * exactly as it would without this table (that registrant may then count as
 * not having watched, which only affects the no-show automation).
 *
 * `creditWatchTime` (Q-11 viewer_watch_progress): the admission was granted
 * while the viewer's own session is playing (not its replay). The same
 * registration then also gets its watch time credited
 * (creditLiveWatchProgress), chosen from the same verified cookies; that write
 * is independent of the attendance write and just as best-effort.
 * `playingFixedSessionId`: on a fixed-session Live, the session the viewer was
 * admitted to; only a registration that chose it gets time (review MINOR-1).
 *
 * `now` is for tests: the cookies are checked against it and the watch-time
 * credit uses it instead of the database clock. Production callers omit it.
 */
export async function recordAttendanceForAdmission(input: {
  request: Request;
  vendorId: string;
  liveId: string;
  creditWatchTime?: boolean;
  playingFixedSessionId?: string | null;
  now?: Date;
}): Promise<LiveRegistrationAttendanceResult> {
  let ids: { formSubmissionId: string; fallbackFormSubmissionId: string | null } | null;
  const now = input.now ?? new Date();
  try {
    const registrationId = registrationSubmissionIdFromRequest(input.request, now);
    const attendanceId = liveAttendanceSubmissionIdFromRequest(input.request, { vendorId: input.vendorId, liveId: input.liveId, now });
    const preferred = registrationId ?? attendanceId;
    ids = preferred ? { formSubmissionId: preferred, fallbackFormSubmissionId: registrationId ? attendanceId : null } : null;
  } catch (error) {
    reportFailure(error, "record");
    return "skipped";
  }
  // Neither cookie: an anonymous viewer never touches these tables.
  if (!ids) return "skipped";
  const target = { vendorId: input.vendorId, liveId: input.liveId, ...ids, now };
  // One after the other: the admission never holds two pool connections at once.
  const attendance = await recordLiveRegistrationAttendance(target).catch((error: unknown) => {
    reportFailure(error, "record");
    return "skipped" as const;
  });
  if (input.creditWatchTime) {
    await creditLiveWatchProgress({
      vendorId: input.vendorId,
      liveId: input.liveId,
      ...ids,
      liveSessionId: input.playingFixedSessionId ?? null,
      // Only an explicit test clock overrides the database's (review MINOR-5).
      ...(input.now ? { now: input.now } : {}),
    }).catch((error: unknown) => {
      reportFailure(error, "watch_progress");
    });
  }
  return attendance;
}
