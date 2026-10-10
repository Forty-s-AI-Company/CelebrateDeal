import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { retryQ1OriginalAfterSchemaRepair } from "@/lib/wp4-buyer-callback-retry";

/** Fixed original Sandbox transaction only; authorization rejects Production,
 * mismatched deployment source, caller selectors and non-empty bodies. */
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    return NextResponse.json(await retryQ1OriginalAfterSchemaRepair(getDb()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return wp4Unavailable(503);
  }
}
