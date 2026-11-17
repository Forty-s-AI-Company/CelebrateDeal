import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { registrationSubmissionIdFromRequest } from "@/lib/evergreen-session-assignment";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * Q-11 `form_no_show`: which registrant was admitted to play a Live
 * (LiveRegistrationAttendance).
 *
 * The viewer page asks /api/live-admission for a playback admission when it
 * opens and then every 30 seconds; the server only grants one while the
 * viewer's own session is playing or in replay (admitLiveViewer). When such a
 * request also carries the signed registration cookie
 * (FORM_SUBMISSION_CHAT_SESSION_COOKIE) of a VERIFIED registration of that
 * Live, the server records when that registration was first and last
 * admitted. The no-show job (src/lib/form-no-show-automation.ts) treats a
 * registration whose `lastAdmittedAt` is at or after its session's start as
 * having watched that session.
 *
 * Every value written comes from the server: the submission id from a cookie
 * whose signature was verified, the Live and vendor from an admission that
 * was just granted, the time from the server clock. Visitors without the
 * cookie (another device, a cleared browser) are never recorded; they count as
 * not having watched (docs/domain-workflows.md「報名後未出席直播」).
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
 * The eligibility check is part of the write: the row is inserted only from a
 * FormSubmission of this Live that is VERIFIED and whose form belongs to this
 * vendor, so another Live's, another tenant's or an unverified registration
 * writes nothing. The composite FKs repeat the binding. INSERT ... ON CONFLICT
 * is atomic on (vendorId, formSubmissionId); a conflicting call only moves
 * `lastAdmittedAt` forward, and only once the stored value is at least
 * LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS old.
 */
export async function recordLiveRegistrationAttendance(
  input: { vendorId: string; liveId: string; formSubmissionId: string; now?: Date },
  db: RawClient = getDb(),
): Promise<LiveRegistrationAttendanceResult> {
  if (!IDENTIFIER.test(input.vendorId) || !IDENTIFIER.test(input.liveId) || !IDENTIFIER.test(input.formSubmissionId)) return "skipped";
  const nowMs = (input.now ?? new Date()).getTime();
  if (!Number.isSafeInteger(nowMs)) return "skipped";
  const now = new Date(nowMs).toISOString();
  const refreshBefore = new Date(nowMs - LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS).toISOString();
  // Prisma stores DateTime as UTC timestamp(3); convert explicitly so the
  // session TimeZone setting can never shift the stored instant.
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "LiveRegistrationAttendance" AS attendance
      ("id", "vendorId", "liveId", "formSubmissionId", "firstAdmittedAt", "lastAdmittedAt")
    SELECT
      ${randomUUID()},
      ${input.vendorId},
      ${input.liveId},
      submission."id",
      (${now}::timestamptz AT TIME ZONE 'UTC'),
      (${now}::timestamptz AT TIME ZONE 'UTC')
    FROM "FormSubmission" AS submission
    INNER JOIN "RegistrationForm" AS form ON form."id" = submission."formId"
    WHERE submission."id" = ${input.formSubmissionId}
      AND submission."liveId" = ${input.liveId}
      AND submission."verificationStatus" = 'VERIFIED'
      AND form."vendorId" = ${input.vendorId}
    ON CONFLICT ("vendorId", "formSubmissionId") DO UPDATE SET
      "lastAdmittedAt" = EXCLUDED."lastAdmittedAt"
    WHERE attendance."liveId" = EXCLUDED."liveId"
      AND attendance."lastAdmittedAt" <= (${refreshBefore}::timestamptz AT TIME ZONE 'UTC')
    RETURNING attendance."id"`;
  return rows.length === 1 ? "recorded" : "unchanged";
}

/**
 * Best-effort recording for /api/live-admission after it granted an
 * admission. It never throws: a failure is reported and the admission answers
 * exactly as it would without this table (that registrant may then count as
 * not having watched, which only affects the no-show automation).
 */
export async function recordAttendanceForAdmission(input: {
  request: Request;
  vendorId: string;
  liveId: string;
  now?: Date;
}): Promise<LiveRegistrationAttendanceResult> {
  try {
    const now = input.now ?? new Date();
    const formSubmissionId = registrationSubmissionIdFromRequest(input.request, now);
    // No registration cookie: an anonymous viewer never touches this table.
    if (!formSubmissionId) return "skipped";
    return await recordLiveRegistrationAttendance({ vendorId: input.vendorId, liveId: input.liveId, formSubmissionId, now });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "live_registration_attendance", operation: "record", status: "failed" });
    } catch {
      // Monitoring cannot change the response.
    }
    return "skipped";
  }
}
