import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import { verifyWp4PayUniSubscriptionState } from "@/lib/wp4-payuni-subscription-state";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "@/lib/wp4-preview-runtime";

function unavailable(status = 404) {
  return NextResponse.json(
    { error: status === 503 ? "Service unavailable" : "Not found" },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function enabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.PAYUNI_ENV === "sandbox"
    && process.env.WP4_SANDBOX_EXECUTOR_ENABLED === "true";
}

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!enabled()) return unavailable();
  const sourceCommit = resolveWp4ExpectedSourceSha();
  if (!sourceCommit) return unavailable(503);
  if (!wp4SourceMatchesRequest(request, sourceCommit) || await requestHasNonEmptyBody(request)) return unavailable();
  try {
    const status = await verifyWp4PayUniSubscriptionState(getDb(), sourceCommit);
    return NextResponse.json({ status }, { status: status === "STATE_UNVERIFIED" ? 409 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable(503);
  }
}
