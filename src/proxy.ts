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

export async function proxy(request: NextRequest): Promise<Response> {
  // The App Router treats folders beginning with `_` as private; this exact
  // proxy matcher keeps the public marker contract available at its URL.
  if (request.nextUrl.pathname === MARKER_PATH) return markerResponse(request.method);
  if (!request.nextUrl.pathname.startsWith("/lp/")) return NextResponse.next();

  const existingVisitorId = cookieValue(request.headers.get("cookie"), FUNNEL_VISITOR_COOKIE);
  const hasVisitorId = isFunnelVisitorId(existingVisitorId);
  const visitorId = hasVisitorId ? existingVisitorId : crypto.randomUUID();
  if (isPublicDocumentRequest(request)) {
    // The root loading boundary starts streaming with HTTP 200 before a page
    // can call notFound(), so availability is decided here instead.
    try {
      const { publicLandingPageStatus } = await import("@/lib/public-landing-page-status");
      if (await publicLandingPageStatus(request.nextUrl.pathname, visitorId) === 404) return publicUnavailable(request.method, 404);
    } catch (error) {
      await reportStatusReadFailure(error);
      return publicUnavailable(request.method, 503);
    }
  }
  if (hasVisitorId) return NextResponse.next();

  // Server Components cannot set cookies. Inject the generated pseudonym into
  // this request as well as the response so the first SSR decision and the
  // browser's next request use the same non-authorizing identifier.
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

/**
 * GET/HEAD requests for `/lp/{slug}` and `/lp/{slug}/{stepPath}`.
 * Checkout/play subroutes keep their own checks and Server Action POSTs are
 * untouched. Next strips Flight headers (`rsc`, `next-router-prefetch`)
 * before Proxy runs, so client-router RSC navigations and prefetches are
 * checked exactly like HTML document requests.
 */
function isPublicDocumentRequest(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  return segments.length >= 2 && segments.length <= 3;
}

/**
 * Makes a 503 storm diagnosable without PII: only a fixed category/code
 * reaches Sentry or the log, never the slug, visitor or connection details.
 * Reporting must never turn the 503 into an unhandled proxy error.
 */
async function reportStatusReadFailure(error: unknown) {
  try {
    const { captureOperationalError } = await import("@/lib/monitoring");
    captureOperationalError(error, { source: "public_landing_page", operation: "pre_stream_status", status: "failed" });
  } catch {
    // Monitoring is best effort here.
  }
}

/** Static anonymous error page: never include the path, a merchant reason or a database error. */
function publicUnavailable(method: string, status: 404 | 503): Response {
  // Same "404" heading as the framework not-found page that this replaces.
  const title = status === 404 ? "404" : "暫時無法開啟頁面";
  const message = status === 404 ? "找不到此頁面。此頁面不存在或目前未公開。" : "請稍後再試。";
  const body = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      ...(status === 503 ? { "Retry-After": "30" } : {}),
    },
  });
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
