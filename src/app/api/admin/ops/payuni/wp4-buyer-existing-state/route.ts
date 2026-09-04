import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import { readWp4BuyerContinuationState } from "@/lib/wp4-payuni-buyer-continuation-state";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "@/lib/wp4-preview-runtime";

const unavailable = (status = 404) => NextResponse.json({ error: status === 503 ? "Service unavailable" : "Not found" }, { status, headers: { "Cache-Control": "no-store" } });
const enabled = () => process.env.VERCEL_ENV === "preview" && process.env.PAYUNI_ENV === "sandbox" && process.env.WP4_SANDBOX_EXECUTOR_ENABLED === "true";
/** Returns only fixed, read-only buyer state evidence; notification queued is not delivery confirmation. */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!enabled()) return unavailable();
  const source = resolveWp4ExpectedSourceSha();
  if (!source) return unavailable(503);
  if (!wp4SourceMatchesRequest(request, source) || await requestHasNonEmptyBody(request)) return unavailable();
  try { return NextResponse.json(await readWp4BuyerContinuationState(getDb()), { status: 200, headers: { "Cache-Control": "no-store" } }); } catch { return unavailable(503); }
}
