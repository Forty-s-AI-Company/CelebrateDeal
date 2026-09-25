import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import { readWp4PayUniBuyerOrderProof } from "@/lib/wp4-payuni-buyer-order-proof";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "@/lib/wp4-preview-runtime";

function unavailable(status = 404) {
  return NextResponse.json({ error: status === 503 ? "Service unavailable" : "Not found" }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

/** A body-free, read-only snapshot for the exact Preview Sandbox fixture. */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unavailable(401);
  if (process.env.VERCEL_ENV !== "preview" || process.env.PAYUNI_ENV !== "sandbox"
    || process.env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true") return unavailable();
  const sourceSha = resolveWp4ExpectedSourceSha();
  if (!sourceSha) return unavailable(503);
  if (!wp4SourceMatchesRequest(request, sourceSha) || await requestHasNonEmptyBody(request)) return unavailable();
  try {
    const proof = await readWp4PayUniBuyerOrderProof(getDb(), sourceSha);
    return NextResponse.json(proof, {
      status: proof.status === "VERIFIED" ? 200 : proof.status === "FIXTURE_UNAVAILABLE" ? 404 : 409,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return unavailable(503);
  }
}
