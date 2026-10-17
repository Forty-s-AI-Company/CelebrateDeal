import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  PLATFORM_REFERRAL_COOKIE,
  platformReferralCookieOptions,
  recordPlatformReferralClick,
} from "@/lib/platform-referral";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalizedCode = code.trim();
  if (!normalizedCode || normalizedCode.length > 100) {
    const response = NextResponse.redirect(new URL("/billing/plans?error=invalid_referral", request.url));
    response.cookies.set(PLATFORM_REFERRAL_COOKIE, "", { ...platformReferralCookieOptions(request), maxAge: 0 });
    return response;
  }

  const click = await recordPlatformReferralClick(getDb(), {
    code: normalizedCode,
    visitorId: crypto.randomUUID(),
    landingPath: "/billing/plans",
  });
  const response = NextResponse.redirect(new URL("/billing/plans?referral=1", request.url));
  if (click) {
    response.cookies.set(PLATFORM_REFERRAL_COOKIE, click.id, platformReferralCookieOptions(request));
  } else {
    response.cookies.set(PLATFORM_REFERRAL_COOKIE, "", { ...platformReferralCookieOptions(request), maxAge: 0 });
  }
  return response;
}
