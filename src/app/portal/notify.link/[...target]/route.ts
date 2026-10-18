import { NextResponse } from "next/server";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { parseLearnerNotificationLink } from "@/lib/learner-notification-links";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ target: string[] }> };
const FALLBACK = "/portal/start.html";

function redirectPrivate(path: string) {
  // Same-origin, canonical redirect; the request Host never selects the target.
  const response = NextResponse.redirect(new URL(path, getCanonicalAppUrl()), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** Stored notification links carry only opaque vendor/course/post/live IDs.
 * Resolve the tenant's current portal URL when the link is opened; the target
 * pages still enforce the learner session, tenant and purchase rights. Unknown
 * or malformed targets fall back to the public portal entry without detail. */
export async function GET(_request: Request, { params }: Context) {
  const target = parseLearnerNotificationLink((await params).target);
  if (!target) return redirectPrivate(FALLBACK);
  try {
    const vendor = await getDb().vendor.findUnique({ where: { id: target.vendorId }, select: { slug: true } });
    if (!vendor) return redirectPrivate(FALLBACK);
    const portal = `/portal/${encodeURIComponent(vendor.slug)}`;
    if (target.kind === "notifications") return redirectPrivate(`${portal}/notifications`);
    if (target.kind === "course") return redirectPrivate(`${portal}/learn/${target.courseId}${target.suffix}`);
    const live = await getDb().live.findFirst({
      where: { id: target.liveId, vendorId: target.vendorId, status: { in: ["scheduled", "live", "ended"] } },
      select: { slug: true },
    });
    return redirectPrivate(live ? `/live/${encodeURIComponent(live.slug)}` : portal);
  } catch {
    return redirectPrivate(FALLBACK);
  }
}
