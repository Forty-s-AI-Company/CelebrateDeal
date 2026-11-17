import { NextResponse } from "next/server";
import { readFirstSuccessRunId, readFirstSuccessStatus } from "@/lib/staging-first-success";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";

/**
 * Staging-only: fixed-category status of one first-success run's synthetic
 * merchant and buyer (registration, consent, verification and confirmation
 * emails read back from the provider). The run id header is the only input.
 */
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  const runId = readFirstSuccessRunId(request);
  if (!runId) return wp4Unavailable(404, "REQUEST_REJECTED");
  try {
    return NextResponse.json(await readFirstSuccessStatus(runId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return wp4Unavailable(503);
  }
}
