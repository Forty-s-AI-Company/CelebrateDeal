import { NextResponse } from "next/server";
import { getBrowserReturnAppUrl } from "@/lib/app-url";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE, formSubmissionChatSessionCookieOptions } from "@/lib/form-submission-chat-session";
import { registrationSessionTokenFromRequest } from "@/lib/live-fixed-sessions-store";
import { resolveLiveWatchLink } from "@/lib/live-watch-link";
import { LIVE_WATCH_LINK_MAX_TOKEN_LENGTH } from "@/lib/live-watch-link-token";
import { captureOperationalError } from "@/lib/monitoring";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Never cached, and the token in this URL never leaves in a Referer: the
 * redirect's own Referrer-Policy also applies to the request it leads to.
 */
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, getBrowserReturnAppUrl(request)), { status: 303, headers: RESPONSE_HEADERS });
}

function viewerPath(slug: string | null) {
  return slug ? `/live/${encodeURIComponent(slug)}` : "/";
}

/**
 * Personal watch link (Q-17) from a live reminder or live-start notice.
 *
 * GET on purpose: the link must work from any mail app or LINE. It only reads
 * (src/lib/live-watch-link.ts), so a mail scanner or link preview fetching it
 * records nothing; the most it does is give that client the registration
 * cookie. A genuine link of a VERIFIED registration of an unsuspended vendor
 * sets the same signed registration cookie as confirming the e-mail and
 * redirects to the plain viewer page, so the token stays out of the address
 * bar. Every refusal (forged, altered, expired, another Live or vendor, not
 * verified, suspended vendor) redirects without a cookie to the viewer page
 * the genuine link names, or to the home page when there is none, and never
 * says why.
 */
export async function GET(request: Request) {
  const limited = await checkRateLimit(request, "live-watch-link", 60, 60_000);
  if (limited) {
    for (const [name, value] of Object.entries(RESPONSE_HEADERS)) limited.headers.set(name, value);
    return limited;
  }

  const raw = new URL(request.url).searchParams.get("token");
  const token = raw && raw.length <= LIVE_WATCH_LINK_MAX_TOKEN_LENGTH ? raw : null;

  let resolution;
  try {
    resolution = await resolveLiveWatchLink({
      token,
      existingRegistrationToken: registrationSessionTokenFromRequest(request),
    });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "live_watch_link", operation: "resolve", status: "failed" });
    } catch {
      // Monitoring cannot change the fail-closed redirect.
    }
    return redirectTo(request, "/");
  }

  const response = redirectTo(request, viewerPath(resolution.liveSlug));
  if (resolution.kind === "admit") {
    response.cookies.set(
      FORM_SUBMISSION_CHAT_SESSION_COOKIE,
      resolution.registrationCookie,
      formSubmissionChatSessionCookieOptions(new URL(request.url).protocol === "https:"),
    );
  }
  return response;
}
