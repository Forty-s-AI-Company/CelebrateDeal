import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/trusted-entry-rate-limit";
import { getDb } from "@/lib/db";
import {
  PLATFORM_REFERRAL_COOKIE,
  platformReferralCookieOptions,
  recordPlatformReferralClick,
} from "@/lib/platform-referral";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  // 先限流，避免匿名 referral 點擊無上限寫入。
  const limited = await checkRateLimit(request, "platform-referral-entry", 60, 60_000);
  if (limited) {
    // 只記錄固定事件，不附帶推薦碼、來源 IP 或 request/credential。
    if (limited.status === 503) console.warn("platform_referral_source_unavailable");
    // 限制歸屬寫入，但讓訪客仍能查看方案；不改動既有歸屬資訊。
    const response = NextResponse.redirect(new URL("/billing/plans", request.url));
    response.headers.set("Cache-Control", "no-store");
    const retryAfter = limited.headers.get("Retry-After");
    if (retryAfter) response.headers.set("Retry-After", retryAfter);
    return response;
  }
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
