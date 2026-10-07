import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { reconcileWp4PayUniSandboxRefund } from "@/lib/wp4-payuni-sandbox-reconciliation";
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    const result = await reconcileWp4PayUniSandboxRefund(getDb(), authorization.sourceSha, "platform_subscription");
    return NextResponse.json({ status: result.status, reconciled: result.reconciled }, { status: result.reconciled ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch { return wp4Unavailable(503); }
}
