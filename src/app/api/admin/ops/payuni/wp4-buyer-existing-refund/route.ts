import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { executeNextWp4PayUniSandboxRefund } from "@/lib/wp4-payuni-sandbox-refund-execution";
import { WP4_BUYER_CONTINUATION_SOURCE, readWp4ExistingBuyerState } from "@/lib/wp4-buyer-recovery";
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    const state = await readWp4ExistingBuyerState(getDb());
    if (state.status !== "VERIFIED" || state.paymentStatus !== "PAID") return NextResponse.json({ status: "REFUND_NOT_ELIGIBLE", providerWriteAttempted: false }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const result = await executeNextWp4PayUniSandboxRefund(getDb(), WP4_BUYER_CONTINUATION_SOURCE, new Date(), "buyer_order");
    return NextResponse.json({ status: result.status, providerWriteAttempted: result.providerWriteAttempted }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch { return wp4Unavailable(503); }
}
