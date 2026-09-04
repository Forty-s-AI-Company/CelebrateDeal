import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import { retryWp4PayUniBuyerCallback } from "@/lib/wp4-payuni-buyer-callback-retry";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "@/lib/wp4-preview-runtime";
function unavailable(status = 404) {
  const error = status === 401 ? "Unauthorized" : status === 503 ? "Service unavailable" : "Not found";
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function enabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.PAYUNI_ENV === "sandbox"
    && process.env.WP4_SANDBOX_EXECUTOR_ENABLED === "true";
}

/** The server selects one stored synthetic callback; callers cannot supply an event ID. */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unavailable(401);
  if (!enabled()) return unavailable();
  const source = resolveWp4ExpectedSourceSha();
  if (!source) return unavailable(503);
  if (!wp4SourceMatchesRequest(request, source) || await requestHasNonEmptyBody(request)) return unavailable();
  try {
    const result = await retryWp4PayUniBuyerCallback(getDb());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable(503);
  }
}
