import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { getStagingPreviewBuildIdentityCheck } from "@/lib/database-identity";
import { PAYUNI_REFUND_STAGING_HOST, readPendingRefundProof } from "@/lib/payuni-pending-refund-proof";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "@/lib/wp4-preview-runtime";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
function unavailable(status = 404) {
  return NextResponse.json({ error: status === 503 ? "Service unavailable" : "Not found" }, { status, headers });
}

/** Read-only evidence for a precisely named synthetic payment, never a latest order. */
export async function GET(request: Request) {
  if (!requireJobSecret(request)) return unavailable(401);
  const url = new URL(request.url);
  if (process.env.VERCEL_ENV !== "preview" || process.env.PAYUNI_ENV !== "sandbox"
    || process.env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true"
    || url.origin !== `https://${PAYUNI_REFUND_STAGING_HOST}`) return unavailable();
  const databaseBinding = getStagingPreviewBuildIdentityCheck();
  if (!databaseBinding.applicable || !databaseBinding.passed) return unavailable();
  const sourceCommit = resolveWp4ExpectedSourceSha();
  if (!sourceCommit || !wp4SourceMatchesRequest(request, sourceCommit)) return unavailable();
  const ids = url.searchParams.getAll("transactionId");
  if (ids.length !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(ids[0]!)) return unavailable();
  try {
    const proof = await readPendingRefundProof(getDb(), ids[0]!, sourceCommit);
    return proof ? NextResponse.json({ ...proof, databaseBound: true, nonProductionScope: "fixed-staging-project" }, { headers }) : unavailable();
  } catch {
    return unavailable(503);
  }
}
