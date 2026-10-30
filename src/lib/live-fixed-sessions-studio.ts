import type { Prisma, PrismaClient } from "@prisma/client";
import { redirect } from "next/navigation";
import {
  FixedSessionValidationError,
  fixedSessionInvalidField,
  parseStudioFixedSessionSettings,
  type ParsedFixedSession,
  type StudioFixedSessionSettings,
} from "@/lib/live-fixed-sessions";
import { deleteUnusedLiveSessions, syncLiveSessions } from "@/lib/live-fixed-sessions-store";
import { supersedeFixedSessionDeliveries } from "@/lib/live-notification-delivery";
import { queueFixedSessionCancellationNotices } from "@/lib/live-fixed-session-notices";
import { scheduleImmediateEmailDispatch } from "@/lib/email-delivery-immediate";
import { captureOperationalError } from "@/lib/monitoring";
import type { LiveStudioDraftPayload } from "@/lib/live-studio-draft";
import { evergreenVideoDurationSeconds } from "@/lib/evergreen-activation";

/**
 * Live Studio side of 指定場次 (fixed sessions): validating the submitted
 * rows and writing them inside the studio transaction. Kept out of the
 * legacy root actions module (see scripts/architecture-boundaries.test.ts).
 */

/** A studio save that would orphan fixed-session registrations (see applyLiveSessionChanges). */
export class LiveSessionModeConflict extends Error {}

/**
 * Writes the 指定場次 rows inside the studio transaction, after the Live row
 * is locked by its update (so in-flight reminder materializations of this
 * Live have finished and later ones read the new sessions). A session with
 * registrations is cancelled instead of deleted and its unsent fixed-time
 * emails are superseded. Switching back to one shared start is refused while
 * any registration still points at a session.
 */
export async function applyLiveSessionChanges(
  tx: Prisma.TransactionClient,
  input: { vendorId: string; liveId: string; fixedSessions: ParsedFixedSession[] | null; previousSessionMode: string },
) {
  if (input.fixedSessions) {
    if (input.previousSessionMode !== "fixed_sessions") {
      // Registrations made before the switch have no session to follow.
      const unbound = await tx.formSubmission.count({
        where: { liveId: input.liveId, liveSessionId: null, form: { vendorId: input.vendorId } },
      });
      if (unbound > 0) throw new LiveSessionModeConflict();
    }
    const result = await syncLiveSessions(tx, { vendorId: input.vendorId, liveId: input.liveId, sessions: input.fixedSessions });
    await supersedeFixedSessionDeliveries(tx, { vendorId: input.vendorId, liveId: input.liveId, sessionIds: result.cancelledSessionIds });
    return;
  }
  if (input.previousSessionMode !== "fixed_sessions") return;
  const bound = await tx.formSubmission.count({
    where: { liveId: input.liveId, liveSessionId: { not: null }, form: { vendorId: input.vendorId } },
  });
  if (bound > 0) throw new LiveSessionModeConflict();
  await deleteUnusedLiveSessions(tx, { vendorId: input.vendorId, liveId: input.liveId });
}

/**
 * Validates the studio's 指定場次 settings for the Live as this save writes
 * it. Only a recorded (VOD) Live that is not evergreen can list fixed
 * sessions; new sessions must be in the future when the Live is published.
 */
export async function resolveSubmittedFixedSessions(input: {
  db: PrismaClient;
  vendorId: string;
  liveId: string | null;
  payload: LiveStudioDraftPayload;
  existingLive: { isEvergreen: boolean | null } | null;
  video: { durationSec: number | null } | null;
  requestedStatus: string;
  timeZone: string;
  invalidDraftPath: string;
}): Promise<StudioFixedSessionSettings | null> {
  if (input.payload.sessionMode !== "fixed_sessions") return null;
  const fieldPath = (field: string) => `${input.invalidDraftPath}&field=${encodeURIComponent(field)}`;
  if (input.payload.streamMode !== "vod" || input.existingLive?.isEvergreen === true) redirect(fieldPath("sessionMode"));
  const publishing = ["scheduled", "live"].includes(input.requestedStatus);
  // Each session plays the recording on its own; there is no shared "go live".
  if (input.requestedStatus === "live" && input.liveId) {
    redirect(`/lives/${encodeURIComponent(input.liveId)}/edit?error=fixed_sessions_manual_start`);
  }
  // Session end, replay window and follow-ups need the recording's length.
  if (publishing && !evergreenVideoDurationSeconds(input.video?.durationSec)) redirect(fieldPath("videoId"));
  const stored = input.liveId
    ? await input.db.liveSession.findMany({ where: { vendorId: input.vendorId, liveId: input.liveId }, select: { startAt: true } })
    : [];
  try {
    return parseStudioFixedSessionSettings(input.payload, {
      timeZone: input.timeZone,
      now: new Date(),
      requireFuture: publishing,
      existingStartTimes: new Set(stored.map((session) => session.startAt.getTime())),
    });
  } catch (error) {
    if (error instanceof FixedSessionValidationError) redirect(fieldPath(fixedSessionInvalidField(error)));
    if (error instanceof Error && (error.message === "cutoff" || error.message === "replay")) {
      redirect(fieldPath(fixedSessionInvalidField(error.message)));
    }
    throw error;
  }
}

/** The schedule this save writes: one shared start, or the 指定場次 and their latest start. */
export function submittedLiveSchedule(settings: StudioFixedSessionSettings | null, submittedScheduledAt: Date) {
  if (!settings) {
    return {
      scheduledAt: submittedScheduledAt,
      fixedSessions: null,
      fields: { sessionMode: "single", sessionRegistrationCutoffMinutes: 0, sessionReplayWindowHours: null },
    };
  }
  return {
    scheduledAt: settings.scheduledAt,
    fixedSessions: settings.sessions,
    fields: {
      sessionMode: "fixed_sessions",
      sessionRegistrationCutoffMinutes: settings.sessionRegistrationCutoffMinutes,
      sessionReplayWindowHours: settings.sessionReplayWindowHours,
    },
  };
}

/**
 * Right after a studio save: queue the cancellation notices of sessions it
 * cancelled and send the first ones now. Best effort; the email job queues
 * and sends whatever is left (live-fixed-session-notices.ts).
 */
export async function queueFixedSessionCancellationNoticesSafely(input: { vendorId: string; liveId: string; fixedSessions: boolean }) {
  if (!input.fixedSessions) return;
  try {
    const queued = await queueFixedSessionCancellationNotices({ vendorId: input.vendorId, liveId: input.liveId, limit: 20 });
    scheduleImmediateEmailDispatch(queued);
  } catch (error) {
    try {
      captureOperationalError(error, { source: "fixed_session", operation: "cancellation_notice_eager", status: "failed" });
    } catch {
      // The scheduled job repairs it.
    }
  }
}