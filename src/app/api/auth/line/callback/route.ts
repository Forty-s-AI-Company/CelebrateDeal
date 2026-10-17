import { NextResponse } from "next/server";
import { AUTH_COOKIE, createUserSession, getCurrentAuth, sessionCookieOptions } from "@/lib/auth";
import { cookies } from "next/headers";
import { LINE_LOGIN_BROWSER_COOKIE, lineLoginBrowserCookieOptions } from "@/lib/line-login-browser-binding";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { completeLineLogin, LineFetchLoginProvider } from "@/lib/line-login";
import { checkRateLimit } from "@/lib/trusted-entry-rate-limit";

function resultRedirect(path: string, status: "linked" | "authenticated" | "error") {
  const url = new URL(path, getCanonicalAppUrl());
  url.searchParams.set("line", status);
  const response=NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(LINE_LOGIN_BROWSER_COOKIE,"",{...lineLoginBrowserCookieOptions(),maxAge:0});
  return response;
}

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, "line-login-callback", 30, 60_000);
  if (limited) return limited;
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  try {
    const browserBinding=(await cookies()).get(LINE_LOGIN_BROWSER_COOKIE)?.value;
    const auth=await getCurrentAuth();
    const result = await completeLineLogin(getDb(), new LineFetchLoginProvider(), { state, code, browserBinding, currentUserId:auth?.user.id });
    if (result.identity.subjectType === "buyer_order" || result.identity.subjectType === "buyer_registration") {
      return resultRedirect(result.redirectPath, "linked");
    }

    const userId: string | null = result.identity.subjectType === "user" ? result.identity.subjectId : null;
    if (!userId) return resultRedirect("/login", "error");
    const session = await createUserSession({
      userId,
      vendorId: result.identity.vendorId,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    const response = resultRedirect(result.redirectPath, result.login ? "authenticated" : "linked");
    response.cookies.set(AUTH_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch {
    return resultRedirect("/login", "error");
  }
}
