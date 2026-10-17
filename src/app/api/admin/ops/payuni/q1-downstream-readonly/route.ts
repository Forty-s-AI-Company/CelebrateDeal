import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { readQ1Downstream } from "@/lib/q1-downstream-readonly";

/** Exact deployed source and Sandbox runtime are checked before any database read. */
export async function GET(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    return NextResponse.json(await readQ1Downstream(getDb()), { headers: { "Cache-Control": "no-store" } });
  } catch { return wp4Unavailable(503); }
}
