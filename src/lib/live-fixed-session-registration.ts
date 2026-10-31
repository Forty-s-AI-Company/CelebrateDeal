import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { FORM_SUBMISSION_VERIFICATION_TTL_MS } from "@/lib/form-submission-verification";
import { isTransientTransactionConflict, withSerializableRetry } from "@/lib/serializable-retry";
import { ensureLiveReminderDelivery } from "@/lib/email-delivery";
import { verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { fixedSessionRegistrationState } from "@/lib/live-fixed-sessions";
import {
  FIXED_SESSION_SELECT,
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
 *   the seat again and refresh the verification window in the same
 *   transaction, so the new link and the seat stand or fall together.
 * - Another session: move only while the current session has not started
 *   (or was cancelled), and only when the request may change this record:
 *   the registration is unverified, its session was cancelled, or the
 *   browser holds the signed registration cookie of this very registration.
 *   Knowing an email address alone never moves a confirmed registrant; that
 *   request is answered `already_registered` with the session it holds.
 *
 * Seat changes run in one transaction behind the Live FOR SHARE lock
 * (lockFixedSessionLive), then the registration row, then the session rows.
 * A deadlock or serialization conflict is retried and, if it persists,
 * treated like a concurrent change: the registration keeps what it holds.
 */
export { holdsRegistrationCookie };

export async function resolveRepeatedFixedSessionRegistration(input: {
  request: Request;
  vendorId: string;
  liveId: string;
  submissionId: string;
  sessionId: string;
  sessionRegistrationCutoffMinutes: number;
  now: Date;
}): Promise<
  | { ok: true; moved: boolean }
  /**
   * The registration cannot move and the request does not come from its own
   * browser: answer exactly like a fresh registration (nothing about the
   * existing one) and tell the real registrant by email instead.
   */
  | { ok: true; moved: false; concealed: { sessionId: string; startAt: Date } }
  | { ok: false; reason: FixedSessionClaimFailure }
  /** The registration's own browser (signed cookie) is told which session it holds. */
  | { ok: false; reason: "already_registered"; session: { startAt: Date } }
  /** A concurrent change won the race: the visitor must retry, never see a success that did not happen. */
  | { ok: false; reason: "busy" }
> {
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
  if (!sameSession && !mayMove(input, current)) {
    if (!current.liveSession || !current.liveSessionId) return { ok: true, moved: false };
    // Knowing an email must not reveal that, or how, it is registered.
    if (!holdsRegistrationCookie(input.request, input.submissionId, input.now)) {
      // Answer exactly what a fresh registration for this session would get:
      // a full, closed or foreign session fails the same way, anything else succeeds.
      const unavailable = await targetSessionFailure(db, input);
      if (unavailable) return { ok: false, reason: unavailable };
      return { ok: true, moved: false, concealed: { sessionId: current.liveSessionId, startAt: current.liveSession.startAt } };
    }
    return { ok: false, reason: "already_registered", session: { startAt: current.liveSession.startAt } };
  }
  try {
    const failure = await withSerializableRetry(() => db.$transaction(async (tx) => {
      if (!await lockFixedSessionLive(tx, { vendorId: input.vendorId, liveId: input.liveId })) return "closed" as const;
      const claim = await switchFixedSessionSeat(tx, {
        vendorId: input.vendorId,
        liveId: input.liveId,
        submissionId: input.submissionId,
        fromSessionId: current.liveSessionId,
        toSessionId: input.sessionId,
        sessionRegistrationCutoffMinutes: input.sessionRegistrationCutoffMinutes,
        now: input.now,
      });
      if (!claim) await refreshExpiredVerificationWindow(tx, { submissionId: input.submissionId, now: input.now });
      return claim;
    }), { attempts: 3, retryOn: isTransientTransactionConflict });
    if (failure) return { ok: false, reason: failure };
  } catch (error) {
    // Another request changed this registration first (or the conflict
    // outlived the retries); keep what it holds and report that.
    if (error instanceof FixedSessionSwitchConflict || isTransientTransactionConflict(error)) return { ok: false, reason: "busy" };
    throw error;
  }
  if (!sameSession && current.verificationStatus === "VERIFIED") {
    await rescheduleFixedSessionRegistrant({ vendorId: input.vendorId, liveId: input.liveId, submissionId: input.submissionId, now: input.now });
  }
  return { ok: true, moved: !sameSession };
}

/**
 * Why a fresh registration for the requested session would fail right now
 * (the read-only form of claimFixedSessionSeat's checks), or null when it
 * would take a seat. Tenant- and Live-scoped like the claim itself.
 */
async function targetSessionFailure(
  db: Pick<Prisma.TransactionClient, "liveSession">,
  input: { vendorId: string; liveId: string; sessionId: string; sessionRegistrationCutoffMinutes: number; now: Date },
): Promise<FixedSessionClaimFailure | null> {
  const session = await db.liveSession.findFirst({
    where: { id: input.sessionId, vendorId: input.vendorId, liveId: input.liveId },
    select: FIXED_SESSION_SELECT,
  });
  if (!session) return "not_found";
  const state = fixedSessionRegistrationState(session, { sessionRegistrationCutoffMinutes: input.sessionRegistrationCutoffMinutes }, input.now);
  return state === "open" ? null : state;
}

/**
 * Opens a new verification window for an unverified registration whose
 * window has passed (the same update refreshExpiredVerification makes), in
 * the caller's seat transaction. A verified or still valid one is untouched.
 */
async function refreshExpiredVerificationWindow(tx: Prisma.TransactionClient, input: { submissionId: string; now: Date }) {
  await tx.formSubmission.updateMany({
    where: {
      id: input.submissionId,
      verificationStatus: "UNVERIFIED",
      OR: [{ verificationExpiresAt: null }, { verificationExpiresAt: { lte: input.now } }],
    },
    data: {
      verificationVersion: { increment: 1 },
      verificationExpiresAt: new Date(input.now.getTime() + FORM_SUBMISSION_VERIFICATION_TTL_MS),
    },
  });
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
  return holdsRegistrationCookie(input.request, input.submissionId, input.now);
}

/** The browser holds the signed registration cookie of this very registration (set when its email was confirmed). */
function holdsRegistrationCookie(request: Request, submissionId: string, now: Date) {
  const token = registrationSessionTokenFromRequest(request);
  const claim = token ? verifyFormSubmissionChatSessionToken(token, now) : null;
  return claim?.submissionId === submissionId;
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
