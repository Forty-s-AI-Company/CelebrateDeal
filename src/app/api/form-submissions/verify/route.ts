import { NextResponse } from "next/server";
import { z } from "zod";
import { readFormDataBody, requireSameOriginRequest } from "@/lib/api-security";
import { getBrowserReturnAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import {
  ensureLiveReminderDelivery,
  ensureRegistrationConfirmationDelivery,
} from "@/lib/email-delivery";
import { deliveryIdForStatuses, isImmediateEmailDelivery, scheduleImmediateEmailDispatch } from "@/lib/email-delivery-immediate";
import {
  createFormSubmissionChatSessionToken,
  FORM_SUBMISSION_CHAT_SESSION_COOKIE,
  formSubmissionChatSessionCookieOptions,
} from "@/lib/form-submission-chat-session";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";
import { expiredFormSubmissionVerificationSubject } from "@/lib/form-submission-verification";
import { releaseFixedSessionSeatIfExpired } from "@/lib/live-fixed-sessions-store";
import {
  EVERGREEN_NEUTRAL_START_TEXT,
  evergreenRegistrationStartText,
  evergreenSessionTokenFromRequest,
} from "@/lib/evergreen-viewer-session";
import { captureTrackingBrowserContext } from "@/lib/tracking-browser-context";
import { captureOperationalError } from "@/lib/monitoring";
import { checkRateLimit } from "@/lib/rate-limit";
import { isTransientTransactionConflict, withSerializableRetry } from "@/lib/serializable-retry";

const VerificationForm = z.object({
  token: z.string().min(1).max(320),
}).strict();

function redirectResult(
  request: Request,
  status: "verified" | "invalid" | "retry",
  chatSession?: { submissionId: string },
) {
  const url = new URL("/verify-registration", getBrowserReturnAppUrl(request));
  url.searchParams.set("status", status);
  const response = NextResponse.redirect(url, {
    status: 303,
    headers: { "Cache-Control": "private, no-store" },
  });
  if (chatSession) {
    response.cookies.set(
      FORM_SUBMISSION_CHAT_SESSION_COOKIE,
      createFormSubmissionChatSessionToken({ submissionId: chatSession.submissionId }),
      formSubmissionChatSessionCookieOptions(new URL(request.url).protocol === "https:"),
    );
  }
  return response;
}

/** An expired link gives its fixed-session seat back now instead of at the next job run. */
async function releaseSeatOfExpiredLink(token: string) {
  const now = new Date();
  const submissionId = expiredFormSubmissionVerificationSubject(token, now);
  if (!submissionId) return;
  try {
    await releaseFixedSessionSeatIfExpired(getDb(), { submissionId, now });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "form_submission_verification", operation: "release_fixed_session_seat", status: "failed" });
    } catch {
      // The scheduled job releases it later.
    }
  }
}

// Confirmation and due reminder emails are sent by `after()` within this
// limit (see IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS).
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!request.headers.get("origin")) {
    return NextResponse.json({ error: "Missing request origin" }, { status: 403 });
  }
  const sameOrigin = requireSameOriginRequest(request);
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "form-submission-verification", 20, 60_000);
  if (limited) return limited;

  const formData = await readFormDataBody(request);
  const parsed = VerificationForm.safeParse({ token: formData?.get("token") });
  if (!parsed.success) return redirectResult(request, "invalid");

  let result;
  try {
    // The verification transaction is all-or-nothing and re-checks the token
    // state, so re-running it after a Serializable conflict cannot double-apply.
    const trackingContext = captureTrackingBrowserContext(request.headers, "/verify-registration");
    result = await withSerializableRetry(
      () => verifyFormSubmission(getDb(), parsed.data.token, new Date(), trackingContext),
      { attempts: 3, retryOn: isTransientTransactionConflict },
    );
  } catch (error) {
    try {
      captureOperationalError(error, {
        source: "form_submission_verification",
        operation: "verify",
        status: "failed",
      });
    } catch {
      // Monitoring cannot change the fail-closed response.
    }
    // Still conflicting after the bounded retries: the link itself is fine, so
    // ask the visitor to press it again instead of calling it invalid.
    return redirectResult(request, isTransientTransactionConflict(error) ? "retry" : "invalid");
  }
  if (result.status === "invalid") {
    await releaseSeatOfExpiredLink(parsed.data.token);
    return redirectResult(request, "invalid");
  }

  if (result.status === "verified" && result.confirmation) {
    const { evergreen, fixedSession, ...confirmation } = result.confirmation;
    // An evergreen Live has no shared start: use this visitor's own session
    // (from their signed cookie) or a neutral phrase, never scheduledAt.
    // The submission is already VERIFIED here, so a session-key failure must
    // never turn into a 500 that drops the confirmation, reminders and cookie.
    let liveStartAtText: string | undefined;
    if (evergreen) {
      try {
        liveStartAtText = evergreenRegistrationStartText({
          live: evergreen.live,
          vendorTimezone: evergreen.vendorTimezone,
          token: evergreenSessionTokenFromRequest(request, evergreen.live.id),
        });
      } catch (error) {
        liveStartAtText = EVERGREEN_NEUTRAL_START_TEXT;
        try {
          captureOperationalError(error, {
            source: "form_submission_verification",
            operation: "evergreen_start_text",
            status: "failed",
          });
        } catch {
          // Monitoring cannot change the verified result.
        }
      }
    }
    const sendNow: string[] = [];
    try {
      const confirmationResult = await ensureRegistrationConfirmationDelivery({
        ...confirmation,
        ...(liveStartAtText ? { liveStartAtText } : {}),
      });
      // A repeated verification may find its confirmation still queued; the
      // shared claim lets that row be sent at most once.
      const confirmationId = deliveryIdForStatuses(confirmationResult, ["queued", "duplicate"]);
      if (confirmationId) sendNow.push(confirmationId);
    } catch (error) {
      try {
        captureOperationalError(error, {
          source: "form_submission_verification",
          operation: "confirmation_email_enqueue",
          status: "failed",
        });
      } catch {
        // Verification remains valid even if an optional confirmation email fails.
      }
    }
    try {
      const reminder = await ensureLiveReminderDelivery({
        ...confirmation,
        template: confirmation.reminderTemplate,
        reminderOffsetMinutes: confirmation.liveReminderOffsetMinutes,
        // No fixed-time reminder for an evergreen visitor, or for a fixed
        // session that was cancelled (its registration is kept, nothing plays).
        evergreenActive: Boolean(evergreen) || fixedSession?.status === "cancelled",
      });
      // A reminder is normally scheduled for later and left to the job. Only a
      // registration made inside the reminder window is already due now.
      const reminderId = deliveryIdForStatuses(reminder, ["scheduled", "reactivated"]);
      if (reminderId && "nextAttemptAt" in reminder &&isImmediateEmailDelivery(reminder.nextAttemptAt)) {
        sendNow.push(reminderId);
      }
    } catch (error) {
      try {
        captureOperationalError(error, {
          source: "form_submission_verification",
          operation: "live_reminder_email_schedule",
          status: "failed",
        });
      } catch {
        // Verification and confirmation remain valid if reminder scheduling fails.
      }
    }
    scheduleImmediateEmailDispatch(sendNow);
  }
  return redirectResult(request, "verified", result.chatSession);
}
