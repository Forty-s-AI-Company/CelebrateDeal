import { NextResponse } from "next/server";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";
import { getDb } from "@/lib/db";
import { readWp4ExistingBuyerState } from "@/lib/wp4-buyer-recovery";
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    const result = await readWp4ExistingBuyerState(getDb());
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch { return wp4Unavailable(503); }
}
