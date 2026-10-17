import { NextResponse } from "next/server";
import { requireSameOriginRequest } from "@/lib/api-security";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  ATTRIBUTION_COOKIE,
  attributionCookieOptions,
} from "@/lib/team-funnel-attribution";
import { PLATFORM_REFERRAL_COOKIE, platformReferralCookieOptions } from "@/lib/platform-referral";

/**
 * A direct public entry starts a new attribution context. Clearing only the
 * server-issued attribution cookie prevents an old referral from leaking into
 * a later checkout without touching the visitor identity used for analytics.
 */
export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "affiliate-attribution-direct-entry", 60, 60_000);
  if (limited) return limited;

  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(ATTRIBUTION_COOKIE, "", {
    ...attributionCookieOptions(request),
    maxAge: 0,
  });
  response.cookies.set(PLATFORM_REFERRAL_COOKIE, "", {
    ...platformReferralCookieOptions(request),
    maxAge: 0,
  });
  return response;
}
