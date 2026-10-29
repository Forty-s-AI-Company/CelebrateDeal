import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { retryWp4HistoricalBuyerCallback } from "@/lib/wp4-buyer-callback-retry";

// The callback retry reprocesses the payment webhook, which can schedule
// the paid receipt email with `after()` within this limit
// (see IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS).
export const maxDuration = 60;

export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try { return NextResponse.json(await retryWp4HistoricalBuyerCallback(getDb()), { headers: { "Cache-Control": "no-store" } }); }
  catch { return wp4Unavailable(503); }
}
