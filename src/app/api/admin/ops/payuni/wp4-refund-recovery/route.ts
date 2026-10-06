import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { reconcileWp4PayUniSandboxRefund } from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_REFUND_RECOVERY_SOURCE } from "@/lib/wp4-buyer-recovery";
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    const result = await reconcileWp4PayUniSandboxRefund(getDb(), WP4_REFUND_RECOVERY_SOURCE);
    // Match the fixed recovery runner contract; an unresolved refund is not success.
    const statuses = { RECONCILED: 200, FIXTURE_UNAVAILABLE: 404, CANDIDATE_AMBIGUOUS: 409,
      PENDING_RESERVATION_UNAVAILABLE: 409, REFUND_NOT_CONFIRMED: 409, PROJECTION_UNAVAILABLE: 503 } as const;
    return NextResponse.json(result, { status: statuses[result.status], headers: { "Cache-Control": "no-store" } });
  } catch { return wp4Unavailable(503); }
}
