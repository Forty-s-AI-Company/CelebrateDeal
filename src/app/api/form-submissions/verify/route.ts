import { NextResponse } from "next/server";
import { z } from "zod";
import { readFormDataBody, requireSameOriginRequest } from "@/lib/api-security";
import { getBrowserReturnAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import {
  ensureLiveReminderDelivery,
  ensureRegistrationConfirmationDelivery,
} from "@/lib/email-delivery";
import { isImmediateEmailDelivery, scheduleImmediateEmailDispatch } from "@/lib/email-delivery-immediate";
import {
  createFormSubmissionChatSessionToken,
  FORM_SUBMISSION_CHAT_SESSION_COOKIE,
  formSubmissionChatSessionCookieOptions,
} from "@/lib/form-submission-chat-session";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";
import { captureTrackingBrowserContext } from "@/lib/tracking-browser-context";
import { captureOperationalError } from "@/lib/monitoring";
import { checkRateLimit } from "@/lib/rate-limit";

const VerificationForm = z.object({
  token: z.string().min(1).max(320),
}).strict();

function redirectResult(
  request: Request,
  status: "verified" | "invalid",
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
    result = await verifyFormSubmission(getDb(), parsed.data.token, new Date(), captureTrackingBrowserContext(request.headers, "/verify-registration"));
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
    return redirectResult(request, "invalid");
  }
  if (result.status === "invalid") return redirectResult(request, "invalid");

  if (result.status === "verified" && result.confirmation) {
    const sendNow: string[] = [];
    try {
      const confirmation = await ensureRegistrationConfirmationDelivery(result.confirmation);
      // A repeated verification may find its confirmation still queued; the
      // shared claim lets that row be sent at most once.
      if (confirmation.status === "queued" || confirmation.status === "duplicate") sendNow.push(confirmation.deliveryId);
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
        ...result.confirmation,
        template: result.confirmation.reminderTemplate,
        reminderOffsetMinutes: result.confirmation.liveReminderOffsetMinutes,
      });
      // A reminder is normally scheduled for later and left to the job. Only a
      // registration made inside the reminder window is already due now.
      if ((reminder.status === "scheduled" || reminder.status === "reactivated") && isImmediateEmailDelivery(reminder.nextAttemptAt)) {
        sendNow.push(reminder.deliveryId);
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
