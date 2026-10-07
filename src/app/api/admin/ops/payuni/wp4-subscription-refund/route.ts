import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { executeNextWp4PayUniSandboxRefund } from "@/lib/wp4-payuni-sandbox-refund-execution";
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    const result = await executeNextWp4PayUniSandboxRefund(getDb(), authorization.sourceSha, new Date(), "platform_subscription");
    return NextResponse.json(result, { status: result.status === "RECONCILIATION_REQUIRED" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch { return wp4Unavailable(503); }
}
