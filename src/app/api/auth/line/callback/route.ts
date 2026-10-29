import { NextResponse } from "next/server";
import { AUTH_COOKIE, createUserSessionForLineIdentity, getCurrentAuth, sessionCookieOptions } from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { completeLineLogin, LineFetchLoginProvider } from "@/lib/line-login";
import { checkRateLimit } from "@/lib/rate-limit";

function resultRedirect(path: string, status: "linked" | "authenticated" | "error") {
  const url = new URL(path, getCanonicalAppUrl());
  url.searchParams.set("line", status);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * LINE callback. Buyer links return to their page. A user identity either
 * signs in (login mode: the session is created under the User row lock while
 * the identity is still linked and the account active) or, in link mode,
 * only links to the account already signed in on this browser and creates no
 * session.
 */
export async function GET(request: Request) {
  const limited = await checkRateLimit(request, "line-login-callback", 30, 60_000);
  if (limited) return limited;
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  try {
    // Link mode binds only to the account signed in here (a valid session cookie).
    const current = await getCurrentAuth();
    const result = await completeLineLogin(getDb(), new LineFetchLoginProvider(), { state, code, linkingUserId: current?.user.id ?? null });
    // No identity: suspended or held account, or a link without the matching session (the state is consumed anyway).
    if (!result.identity) return resultRedirect("/login", "error");
    if (result.identity.subjectType === "buyer_order" || result.identity.subjectType === "buyer_registration") {
      return resultRedirect(result.redirectPath, "linked");
    }

    const userId: string | null = result.identity.subjectType === "user" ? result.identity.subjectId : null;
    if (!userId) return resultRedirect("/login", "error");
    if (!result.login) return resultRedirect(result.redirectPath, "linked");
    const session = await createUserSessionForLineIdentity({
      identityId: result.identity.id,
      userId,
      vendorId: result.identity.vendorId,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    if (!session) return resultRedirect("/login", "error");
    const response = resultRedirect(result.redirectPath, "authenticated");
    response.cookies.set(AUTH_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch {
    return resultRedirect("/login", "error");
  }
}