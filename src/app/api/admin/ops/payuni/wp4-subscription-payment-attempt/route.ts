import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import { reserveWp4PayUniSubscriptionPaymentAttempt } from "@/lib/wp4-payuni-sandbox-payment-attempt";
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
    const result = await reserveWp4PayUniSubscriptionPaymentAttempt(getDb(), sourceCommit);
    const status = result.status === "SUBMIT_ALLOWED" || result.status === "ALREADY_PAID"
      ? 200
      : result.status === "FIXTURE_UNAVAILABLE"
        ? 404
        : 409;
    return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable(503);
  }
}
