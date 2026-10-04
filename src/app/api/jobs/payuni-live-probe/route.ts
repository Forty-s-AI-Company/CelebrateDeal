import { NextResponse } from "next/server";
import { isAuthorizedBearer, unauthorizedJson } from "@/lib/api-security";
import { runPayUniLiveProbeJob } from "@/lib/payuni-live-probe-job";

/** Dedicated one-time live test key; never share a broad scheduler secret. */
export async function POST(request: Request) {
  if (!isAuthorizedBearer(request, process.env.PAYUNI_LIVE_PROBE_JOB_SECRET)) return unauthorizedJson();
  try {
    const result = await runPayUniLiveProbeJob();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ outcome: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
