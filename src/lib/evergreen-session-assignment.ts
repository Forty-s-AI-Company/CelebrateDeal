import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import {
  evergreenScheduleFingerprint,
  type EvergreenViewerSession,
} from "@/lib/evergreen-viewer-session";
import { verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { registrationSessionTokenFromRequest } from "@/lib/live-fixed-sessions-store";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * 常青場 per-registrant session record (EvergreenSessionAssignment).
 *
 * An evergreen visitor's session lives only in a signed httpOnly cookie. The
 * post-live follow-up job needs to know when a registrant's own session ends,
 * so the server records the session it assigned, but only for a VERIFIED
 * registration identified by the signed registration cookie
 * (FORM_SUBMISSION_CHAT_SESSION_COOKIE). Visitors without that cookie never
 * cause a write here.
 *
 * Every value written comes from the server: the submission id from a cookie
 * whose signature was verified, the session start and schedule fingerprint
 * from resolveEvergreenViewerSession. Nothing comes from the request body.
 */

type RawClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type EvergreenSessionAssignmentInput = {
  vendorId: string;
  liveId: string;
  /** From a verified registration cookie, never from request input. */
  formSubmissionId: string;
  /** Resolved on the server from the Live's schedule and the server clock. */
  sessionStartAt: Date;
  scheduleFingerprint: string;
  now?: Date;
};

export type EvergreenSessionAssignmentResult = "recorded" | "skipped";

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const FINGERPRINT = /^[0-9a-f]{32}$/u;

/**
 * Records (or moves) the registrant's evergreen session in one statement.
 *
 * The eligibility check is part of the write itself: the row is inserted only
 * from a FormSubmission of this Live that is VERIFIED and whose form belongs
 * to this vendor, so a submission id of another Live, another tenant or an
 * unverified registration writes nothing. The composite FKs repeat the
 * binding: (vendorId, liveId) -> Live and (liveId, formSubmissionId) ->
 * FormSubmission(liveId, id).
 *
 * An existing row is replaced when the schedule changed (different
 * fingerprint); under the same schedule it only moves to a later start, so two
 * browsers holding different sessions settle on the later one instead of
 * flipping back and forth. INSERT ... ON CONFLICT is atomic against the
 * (vendorId, formSubmissionId) unique key, so concurrent calls need no retry:
 * the losing insert re-evaluates the update condition on the committed row.
 */
export async function recordEvergreenSessionAssignment(
  input: EvergreenSessionAssignmentInput,
  db: RawClient = getDb(),
): Promise<EvergreenSessionAssignmentResult> {
  const startMs = input.sessionStartAt.getTime();
  if (
    !IDENTIFIER.test(input.vendorId)
    || !IDENTIFIER.test(input.liveId)
    || !IDENTIFIER.test(input.formSubmissionId)
    || !FINGERPRINT.test(input.scheduleFingerprint)
    || !Number.isSafeInteger(startMs)
  ) return "skipped";
  const sessionStartAt = new Date(startMs).toISOString();
  const now = (input.now ?? new Date()).toISOString();
  // Prisma stores DateTime as UTC timestamp(3); convert explicitly so the
  // session TimeZone setting can never shift the stored instant.
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "EvergreenSessionAssignment" AS assignment
      ("id", "vendorId", "liveId", "formSubmissionId", "sessionStartAt", "scheduleFingerprint", "assignedAt", "updatedAt")
    SELECT
      ${randomUUID()},
      ${input.vendorId},
      ${input.liveId},
      submission."id",
      (${sessionStartAt}::timestamptz AT TIME ZONE 'UTC'),
      ${input.scheduleFingerprint},
      (${now}::timestamptz AT TIME ZONE 'UTC'),
      (${now}::timestamptz AT TIME ZONE 'UTC')
    FROM "FormSubmission" AS submission
    INNER JOIN "RegistrationForm" AS form ON form."id" = submission."formId"
    WHERE submission."id" = ${input.formSubmissionId}
      AND submission."liveId" = ${input.liveId}
      AND submission."verificationStatus" = 'VERIFIED'
      AND form."vendorId" = ${input.vendorId}
    ON CONFLICT ("vendorId", "formSubmissionId") DO UPDATE SET
      "sessionStartAt" = EXCLUDED."sessionStartAt",
      "scheduleFingerprint" = EXCLUDED."scheduleFingerprint",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE assignment."liveId" = EXCLUDED."liveId"
      AND (
        assignment."scheduleFingerprint" <> EXCLUDED."scheduleFingerprint"
        OR assignment."sessionStartAt" < EXCLUDED."sessionStartAt"
      )
    RETURNING assignment."id"`;
  return rows.length === 1 ? "recorded" : "skipped";
}

/** The submission id of an authentic, unexpired registration cookie, or null. */
export function registrationSubmissionIdFromRequest(request: Request, now: Date) {
  const token = registrationSessionTokenFromRequest(request);
  if (!token) return null;
  return verifyFormSubmissionChatSessionToken(token, now)?.submissionId ?? null;
}

/**
 * Best-effort recording for a Route Handler that already resolved the
 * visitor's session. It never throws: a failure is reported and the caller
 * answers exactly as it would without this table (the follow-up for this
 * registrant is then missing, not the page).
 */
export async function recordEvergreenSessionForRegistrant(input: {
  live: { id: string; vendorId: string };
  session: Pick<EvergreenViewerSession, "assigned" | "sessionStartAt" | "schedule"> | null;
  /**
   * Where the registration comes from: the request's signed registration
   * cookie, or a submission the caller has just verified on the server.
   */
  registration: { request: Request } | { submissionId: string };
  now: Date;
  operation: "viewer_session" | "verification";
}): Promise<EvergreenSessionAssignmentResult> {
  if (!input.session?.assigned) return "skipped";
  try {
    const formSubmissionId = "request" in input.registration
      ? registrationSubmissionIdFromRequest(input.registration.request, input.now)
      : input.registration.submissionId;
    // No registration cookie: an anonymous visitor never touches this table.
    if (!formSubmissionId) return "skipped";
    return await recordEvergreenSessionAssignment({
      vendorId: input.live.vendorId,
      liveId: input.live.id,
      formSubmissionId,
      sessionStartAt: input.session.sessionStartAt,
      scheduleFingerprint: evergreenScheduleFingerprint(input.session.schedule),
      now: input.now,
    });
  } catch (error) {
    try {
      captureOperationalError(error, {
        source: "evergreen_session_assignment",
        operation: input.operation,
        status: "failed",
      });
    } catch {
      // Monitoring cannot change the response.
    }
    return "skipped";
  }
}
