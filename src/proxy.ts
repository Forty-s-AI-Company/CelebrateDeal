import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { LINEAGE_PAYLOAD } from "@/lib/preview-lineage";

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
  return NextResponse.next();
}

export const config = {
  matcher: "/__celebratedeal_wp187_fingerprint\\.json",
};
