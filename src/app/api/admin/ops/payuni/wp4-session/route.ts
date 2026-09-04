import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { AUTH_COOKIE } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "@/lib/wp4-preview-runtime";
import { createWp4PreviewOwnerSession, WP4_OWNER_SESSION_TTL } from "@/lib/wp4-preview-owner-session";

function closed(status: number) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : status === 503 ? "Service unavailable" : "Not found" },
    { status, headers: { "Cache-Control": "no-store" } });
}

/** Protected fixed Sandbox identity; no caller-owned session parameters. */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return closed(401);
  if (process.env.VERCEL_ENV !== "preview" || process.env.PAYUNI_ENV !== "sandbox"
    || process.env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true") return closed(404);
  const source = resolveWp4ExpectedSourceSha();
  if (!source) return closed(503);
  if (!wp4SourceMatchesRequest(request, source) || await requestHasNonEmptyBody(request)) return closed(404);
  try {
    const { token, expiresAt } = await createWp4PreviewOwnerSession(getDb());
    const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    response.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/",
      maxAge: WP4_OWNER_SESSION_TTL, expires: expiresAt,
    });
    return response;
  } catch {
    return closed(503);
  }
}
