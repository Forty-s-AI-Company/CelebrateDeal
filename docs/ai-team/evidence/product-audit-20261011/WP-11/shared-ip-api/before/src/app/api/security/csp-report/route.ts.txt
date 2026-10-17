import { NextResponse } from "next/server";
import { readTextBody } from "@/lib/api-security";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_CSP_REPORT_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, "csp-report", 120, 60_000);
  if (limited) return limited;

  const report = await readTextBody(request, MAX_CSP_REPORT_BYTES);
  if (report === null) {
    return NextResponse.json({ error: "CSP report payload too large" }, { status: 413 });
  }

  return new NextResponse(null, { status: 204 });
}
