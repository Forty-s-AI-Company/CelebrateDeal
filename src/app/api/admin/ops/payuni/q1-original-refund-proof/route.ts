import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { readQ1OriginalPendingRefundProof } from "@/lib/payuni-pending-refund-proof";

/** Read only the fixed original. Existing Preview/Sandbox/JOB/source gates
 * reject Production, foreign databases, query selectors and request bodies. */
export async function GET(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    const proof = await readQ1OriginalPendingRefundProof(getDb(), authorization.sourceSha);
    return proof ? NextResponse.json({ ...proof, databaseBound: true, nonProductionScope: "fixed-staging-project" }, {
      headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
    }) : wp4Unavailable();
  } catch {
    return wp4Unavailable(503);
  }
}
