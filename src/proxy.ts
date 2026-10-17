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
  const visitorId = isFunnelVisitorId(existingVisitorId) ? existingVisitorId : crypto.randomUUID();
  // 僅檢查公開文件；checkout／play 子路由保留各自的解析與安全檢查。
  const isDocumentPath = request.nextUrl.pathname.split("/").filter(Boolean).length <= 3;
  if (isDocumentPath && (request.method === "GET" || request.method === "HEAD")) {
    try {
      // 限 /lp；在根 loading 開始串流前決定 HTTP 狀態。其他入口不載入 DB 模組。
      const { publicLandingPageStatus } = await import("@/lib/public-landing-page-status");
      if (await publicLandingPageStatus(request.nextUrl.pathname, visitorId) === 404) return publicUnavailable(request.method, 404);
    } catch {
      return publicUnavailable(request.method, 503);
    }
  }
  if (isFunnelVisitorId(existingVisitorId)) return NextResponse.next();

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

/** 靜態匿名錯誤頁；不得插入 path、商家原因或資料庫錯誤。 */
function publicUnavailable(method: string, status: 404 | 503) {
  const title = status === 404 ? "404" : "暫時無法開啟頁面";
  const message = status === 404 ? "找不到此頁面。" : "請稍後再試。";
  return new Response(method === "HEAD" ? null : `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex", ...(status === 503 ? { "Retry-After": "30" } : {}) },
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
