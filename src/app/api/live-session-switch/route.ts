import { NextResponse } from "next/server";
import { z } from "zod";
import { readFormDataBody, trustedRequestOrigin } from "@/lib/api-security";
import { getBrowserReturnAppUrl } from "@/lib/app-url";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE, formSubmissionChatSessionCookieOptions } from "@/lib/form-submission-chat-session";
import { redeemLiveSessionSwitchToken } from "@/lib/live-session-switch";
import { LIVE_SESSION_SWITCH_MAX_TOKEN_LENGTH } from "@/lib/live-session-switch-token";
import { captureOperationalError } from "@/lib/monitoring";
import { checkRateLimit } from "@/lib/rate-limit";
import { isTransientTransactionConflict } from "@/lib/serializable-retry";

const SwitchForm = z.object({
  token: z.string().min(1).max(LIVE_SESSION_SWITCH_MAX_TOKEN_LENGTH),
}).strict();

const NO_STORE = { "Cache-Control": "private, no-store" };

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, getBrowserReturnAppUrl(request)), { status: 303, headers: NO_STORE });
}

/**
 * The confirmation button of a 「更換場次」 link (指定場次). Only this POST
 * redeems the link; the page a mail scanner fetches with GET does not. On
 * success this browser receives the registration's signed cookie (the same
 * one confirming the email sets) and lands on the public registration page,
 * where choosing another session with the same email now moves the
 * registration. Forged, expired, used and stale links share one answer.
 */
export async function POST(request: Request) {
  // An exact same-origin Origin header, never "null" or a Referer: a page
  // elsewhere cannot plant someone else's registration cookie here (the
  // confirmation page uses Referrer-Policy: same-origin, so its own POST sends one).
  if (!trustedRequestOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const limited = await checkRateLimit(request, "live-session-switch", 20, 60_000);
  if (limited) return limited;

  const formData = await readFormDataBody(request);
  const parsed = SwitchForm.safeParse({ token: formData?.get("token") });
  if (!parsed.success) return redirectTo(request, "/live-session-switch?status=invalid");

  let result;
  try {
    result = await redeemLiveSessionSwitchToken(parsed.data.token, new Date());
  } catch (error) {
    try {
      captureOperationalError(error, { source: "live_session_switch", operation: "redeem", status: "failed" });
    } catch {
      // Monitoring cannot change the fail-closed response.
    }
    // Nothing was recorded, so the link still works: ask for another press.
    return redirectTo(request, `/live-session-switch?status=${isTransientTransactionConflict(error) ? "retry" : "invalid"}`);
  }
  if (!result.ok) return redirectTo(request, "/live-session-switch?status=invalid");

  const response = redirectTo(request, result.rechoosePath);
  response.cookies.set(
    FORM_SUBMISSION_CHAT_SESSION_COOKIE,
    result.registrationCookie,
    formSubmissionChatSessionCookieOptions(new URL(request.url).protocol === "https:"),
  );
  return response;
}
