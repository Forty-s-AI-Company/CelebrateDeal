import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import { checkWp4PayUniBuyerPayment } from "@/lib/wp4-payuni-buyer-payment-check";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "@/lib/wp4-preview-runtime";

function unavailable(status = 404) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : status === 503 ? "Service unavailable" : "Not found" }, { status, headers: { "Cache-Control": "no-store" } });
}

function enabled() {
  return process.env.VERCEL_ENV === "preview" && process.env.PAYUNI_ENV === "sandbox" && process.env.WP4_SANDBOX_EXECUTOR_ENABLED === "true";
}

export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unavailable(401);
  if (!enabled()) return unavailable();
  const expectedSha = resolveWp4ExpectedSourceSha();
  if (!expectedSha) return unavailable(503);
  if (!wp4SourceMatchesRequest(request, expectedSha) || await requestHasNonEmptyBody(request)) return unavailable();
  try {
    const result = await checkWp4PayUniBuyerPayment(getDb());
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable(503);
  }
}
