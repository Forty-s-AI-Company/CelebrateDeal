import { NextResponse } from "next/server";
import { getBrowserReturnAppUrl } from "@/lib/app-url";
import { liveAttendanceCookieOptions, liveSessionHintCookieOptions } from "@/lib/live-attendance-cookie";
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
 * records nothing. A genuine link of a VERIFIED registration of an
 * unsuspended vendor sets only the attendance-only cookie of that Live
 * (src/lib/live-attendance-cookie.ts, Path=/api/live-admission): it lets the
 * admission record this browser's viewing under that registration and grants
 * no chat, private chat, LINE or checkout identity. The registration cookie is
 * neither read nor replaced. On a fixed-session Live it also sets the
 * session-hint cookie (A2-10, Path=/), read only to pick which fixed session
 * this browser follows: the registration's own one, from the database.
 * It then redirects to the plain viewer page, so the
 * token stays out of the address bar. Every refusal (forged, altered, expired,
 * another Live or vendor, not verified, suspended vendor) redirects without a
 * cookie to the viewer page the genuine link names, or to the home page when
 * there is none, and never says why.
 */
export async function GET(request: Request) {
  const limited = await checkRateLimit(request, "live-watch-link", 60, 60_000);
  if (limited) {
    for (const [name, value] of Object.entries(RESPONSE_HEADERS)) limited.headers.set(name, value);
    return limited;
  }

  const raw = new URL(request.url).searchParams.get("token");
  const token = raw && raw.length <= LIVE_WATCH_LINK_MAX_TOKEN_LENGTH ? raw : null;
  const now = new Date();

  let resolution;
  try {
    resolution = await resolveLiveWatchLink({ token, now });
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
    const secure = new URL(request.url).protocol === "https:";
    const cookie = resolution.attendanceCookie;
    response.cookies.set(cookie.name, cookie.value, liveAttendanceCookieOptions(secure, cookie.expiresAt, now));
    const hint = resolution.sessionHintCookie;
    if (hint) response.cookies.set(hint.name, hint.value, liveSessionHintCookieOptions(secure, hint.expiresAt, now));
  }
  return response;
}
