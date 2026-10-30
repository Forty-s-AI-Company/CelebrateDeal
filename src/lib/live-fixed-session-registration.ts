import { getDb } from "@/lib/db";
import { ensureLiveReminderDelivery } from "@/lib/email-delivery";
import { verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import {
  FixedSessionSwitchConflict,
  lockFixedSessionLive,
  registrationSessionTokenFromRequest,
  switchFixedSessionSeat,
  type FixedSessionClaimFailure,
} from "@/lib/live-fixed-sessions-store";
import {
  materializeLiveNotificationsForSubmission,
  supersedeRegistrantFixedTimeDeliveries,
} from "@/lib/live-notification-delivery";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * A repeated registration (same form, Live and email) on a fixed-session
 * Live (指定場次). It may take a seat again or move to another session:
 *
 * - Same session, seat released (the verification window had passed): take
 *   the seat again before the verification link is refreshed.
 * - Another session: move only while the current session has not started
 *   (or was cancelled), and only when the request may change this record:
 *   the registration is unverified, its session was cancelled, or the
 *   browser holds the signed registration cookie of this very registration.
 *   Knowing an email address alone never moves a confirmed registrant.
 *
 * Everything that touches seats runs in one transaction behind the Live
 * FOR SHARE lock (lockFixedSessionLive). Returns the failure that should be
 * answered, or whether the registration moved.
 */
export async function resolveRepeatedFixedSessionRegistration(input: {
  request: Request;
  vendorId: string;
  liveId: string;
  submissionId: string;
  sessionId: string;
  sessionRegistrationCutoffMinutes: number;
  now: Date;
}): Promise<{ ok: true; moved: boolean } | { ok: false; reason: FixedSessionClaimFailure }> {
  const db = getDb();
  const current = await db.formSubmission.findFirst({
    where: { id: input.submissionId, liveId: input.liveId, form: { vendorId: input.vendorId } },
    select: {
      liveSessionId: true,
      liveSessionSeatReleasedAt: true,
      verificationStatus: true,
      liveSession: { select: { vendorId: true, liveId: true, startAt: true, status: true } },
    },
  });
  if (!current) return { ok: true, moved: false };
  const sameSession = current.liveSessionId === input.sessionId;
  if (sameSession && current.liveSessionSeatReleasedAt === null) return { ok: true, moved: false };
  if (!sameSession && !mayMove(input, current)) return { ok: true, moved: false };
  try {
    const failure = await db.$transaction(async (tx) => {
      if (!await lockFixedSessionLive(tx, { vendorId: input.vendorId, liveId: input.liveId })) return "closed" as const;
      return switchFixedSessionSeat(tx, {
        vendorId: input.vendorId,
        liveId: input.liveId,
        submissionId: input.submissionId,
        fromSessionId: current.liveSessionId,
        toSessionId: input.sessionId,
        sessionRegistrationCutoffMinutes: input.sessionRegistrationCutoffMinutes,
        now: input.now,
      });
    });
    if (failure) return { ok: false, reason: failure };
  } catch (error) {
    // Another request changed this registration first; keep what it wrote.
    if (error instanceof FixedSessionSwitchConflict) return { ok: true, moved: false };
    throw error;
  }
  if (!sameSession && current.verificationStatus === "VERIFIED") {
    await rescheduleFixedSessionRegistrant({ vendorId: input.vendorId, liveId: input.liveId, submissionId: input.submissionId, now: input.now });
  }
  return { ok: true, moved: !sameSession };
}

function mayMove(
  input: { request: Request; vendorId: string; liveId: string; submissionId: string; now: Date },
  current: {
    verificationStatus: string;
    liveSession: { vendorId: string; liveId: string; startAt: Date; status: string } | null;
  },
) {
  const session = current.liveSession;
  const cancelled = !session || session.status === "cancelled" || session.vendorId !== input.vendorId || session.liveId !== input.liveId;
  if (!cancelled && session.startAt.getTime() <= input.now.getTime()) return false;
  if (cancelled || current.verificationStatus !== "VERIFIED") return true;
  const token = registrationSessionTokenFromRequest(input.request);
  const claim = token ? verifyFormSubmissionChatSessionToken(token, input.now) : null;
  return claim?.submissionId === input.submissionId;
}

/**
 * After a verified registrant moved session: cancel the old session's unsent
 * reminders (Email and LINE) and schedule the new session's ones. Best
 * effort: a failure is reported and the scheduled jobs repair it, and the
 * send-time guards reject anything still anchored on the old session.
 */
export async function rescheduleFixedSessionRegistrant(input: { vendorId: string; liveId: string; submissionId: string; now?: Date }) {
  const db = getDb();
  try {
    await db.$transaction((tx) => supersedeRegistrantFixedTimeDeliveries(tx, {
      vendorId: input.vendorId,
      liveId: input.liveId,
      submissionIds: [input.submissionId],
      reason: "session_changed",
    }));
    const submission = await db.formSubmission.findFirst({
      where: { id: input.submissionId, liveId: input.liveId, verificationStatus: "VERIFIED", form: { vendorId: input.vendorId } },
      select: {
        id: true,
        name: true,
        email: true,
        liveSession: { select: { vendorId: true, liveId: true, startAt: true, status: true } },
        live: {
          select: {
            id: true,
            vendorId: true,
            slug: true,
            title: true,
            liveReminderOffsetMinutes: true,
            liveReminderTemplate: { select: { id: true, vendorId: true, channel: true, trigger: true, subject: true, body: true, isActive: true } },
            vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true } },
          },
        },
      },
    });
    const session = submission?.liveSession;
    const live = submission?.live;
    if (!submission || !live || live.vendorId !== input.vendorId || !session || session.vendorId !== input.vendorId || session.status === "cancelled") return;
    await ensureLiveReminderDelivery({
      vendorId: input.vendorId,
      vendorName: live.vendor.name,
      liveId: live.id,
      liveSlug: live.slug,
      liveTitle: live.title,
      formSubmissionId: submission.id,
      recipientName: submission.name,
      recipientEmail: submission.email,
      liveScheduledAt: session.startAt,
      reminderOffsetMinutes: live.liveReminderOffsetMinutes,
      template: live.liveReminderTemplate,
      emailBrand: { senderName: live.vendor.senderName, supportEmail: live.vendor.supportEmail, contactUrl: live.vendor.contactUrl },
    }, input.now ?? new Date());
    await materializeLiveNotificationsForSubmission({ vendorId: input.vendorId, liveId: live.id, submissionId: submission.id, now: input.now });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "fixed_session", operation: "reschedule_registrant", status: "failed" });
    } catch {
      // Monitoring must never change the registration result.
    }
  }
}
