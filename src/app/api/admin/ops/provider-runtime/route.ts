import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { getProviderRuntimeIdentity } from "@/lib/provider-runtime-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read only the deployed Preview process bindings after JOB_SECRET authorization. */
export function GET(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();

  const headers = { "Cache-Control": "no-store" };
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Preview runtime required" }, { status: 403, headers });
  }

  return NextResponse.json(getProviderRuntimeIdentity(), { headers });
}
