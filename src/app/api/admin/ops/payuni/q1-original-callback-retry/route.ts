import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { retryQ1OriginalBuyerCallback } from "@/lib/wp4-buyer-callback-retry";

/** Current deployment authorization and original transaction identity are separate. */
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    return NextResponse.json(await retryQ1OriginalBuyerCallback(getDb()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return wp4Unavailable(503);
  }
}
