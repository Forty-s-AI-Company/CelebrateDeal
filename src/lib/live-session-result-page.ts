import { cookies } from "next/headers";
import { confirmedLiveSessionFromCookies } from "@/lib/live-session-result";

/**
 * Server Component helper for the funnel webinar pages: the 指定場次 this
 * browser's registration holds, from the HttpOnly signed result cookie, only
 * for the page's own fixed-session Live. Null for any other Live.
 */
export async function confirmedWebinarSession(webinar: { live: { id: string }; liveSessions?: unknown } | undefined) {
  if (!webinar?.liveSessions) return null;
  const confirmed = confirmedLiveSessionFromCookies(await cookies(), webinar.live.id);
  return confirmed ? { startAt: confirmed.startAt, label: confirmed.label } : null;
}
