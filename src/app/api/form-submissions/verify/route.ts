import { NextResponse } from "next/server";
import { z } from "zod";
import { readFormDataBody, requireSameOriginRequest } from "@/lib/api-security";
import { getBrowserReturnAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import {
  ensureLiveReminderDelivery,
  ensureRegistrationConfirmationDelivery,
} from "@/lib/email-delivery";
import {
  createFormSubmissionChatSessionToken,
  FORM_SUBMISSION_CHAT_SESSION_COOKIE,
  formSubmissionChatSessionCookieOptions,
} from "@/lib/form-submission-chat-session";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";
import {
  EVERGREEN_NEUTRAL_START_TEXT,
  evergreenRegistrationStartText,
  evergreenSessionTokenFromRequest,
} from "@/lib/evergreen-viewer-session";
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
    const { evergreen, ...confirmation } = result.confirmation;
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
    try {
      await ensureRegistrationConfirmationDelivery({ ...confirmation, ...(liveStartAtText ? { liveStartAtText } : {}) });
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
      await ensureLiveReminderDelivery({
        ...confirmation,
        template: confirmation.reminderTemplate,
        reminderOffsetMinutes: confirmation.liveReminderOffsetMinutes,
        evergreenActive: Boolean(evergreen),
      });
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
  }
  return redirectResult(request, "verified", result.chatSession);
}
