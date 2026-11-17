import { NextResponse } from "next/server";
import { readFirstSuccessCleanupMode, runFirstSuccessCleanup } from "@/lib/staging-first-success-cleanup";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";

/**
 * Staging-only (R-10): deactivate, or after the retention window delete, the
 * synthetic merchants the O-13 first-success runner created. The only input is
 * the `x-celebratedeal-first-success-cleanup-mode` header, which must be
 * `deactivate` or `delete` (missing = 404); vendors are found by the runner's own owner mailbox
 * and workspace slug, never by caller-supplied ids. The answer is a receipt of
 * counts, status and 8-hex run id prefixes.
 */
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  const mode = readFirstSuccessCleanupMode(request);
  if (!mode) return wp4Unavailable(404, "REQUEST_REJECTED");
  try {
    const receipt = await runFirstSuccessCleanup({ mode });
    if (receipt.result === "REFUSED") return wp4Unavailable(404, "RUNTIME_REJECTED");
    return NextResponse.json(receipt, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return wp4Unavailable(503);
  }
}
