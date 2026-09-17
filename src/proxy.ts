import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { LINEAGE_PAYLOAD } from "@/lib/preview-lineage";
import { FUNNEL_VISITOR_COOKIE, isFunnelVisitorId } from "@/lib/funnel-runtime-visitor";

const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
});

function markerResponse(method: string): Response {
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  return new Response(method === "HEAD" ? null : JSON.stringify(LINEAGE_PAYLOAD), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

export function proxy(request: NextRequest): Response {
  // The App Router treats folders beginning with `_` as private; this exact
  // proxy matcher keeps the public marker contract available at its URL.
  if (request.nextUrl.pathname === MARKER_PATH) return markerResponse(request.method);
  if (!request.nextUrl.pathname.startsWith("/lp/")) return NextResponse.next();

  const existingVisitorId = cookieValue(request.headers.get("cookie"), FUNNEL_VISITOR_COOKIE);
  if (isFunnelVisitorId(existingVisitorId)) return NextResponse.next();

  // Server Components cannot set cookies. Inject the generated pseudonym into
  // this request as well as the response so the first SSR decision and the
  // browser's next request use the same non-authorizing identifier.
  const visitorId = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("cookie", replaceCookie(request.headers.get("cookie"), FUNNEL_VISITOR_COOKIE, visitorId));
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(FUNNEL_VISITOR_COOKIE, visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

function cookieValue(header: string | null, name: string) {
  const prefix = `${name}=`;
  const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return null; }
}

function replaceCookie(header: string | null, name: string, value: string) {
  const prefix = `${name}=`;
  const replacement = `${prefix}${encodeURIComponent(value)}`;
  const values = header?.split(";").map((part) => part.trim()).filter(Boolean) ?? [];
  const retained = values.filter((part) => !part.startsWith(prefix));
  return [...retained, replacement].join("; ");
}

export const config = {
  matcher: ["/__celebratedeal_wp187_fingerprint\\.json", "/lp/:path*"],
};
