import { NextResponse } from "next/server";
import { readTextBody } from "@/lib/api-security";
import { aggregateCspViolations, parseCspReports } from "@/lib/csp-report";
import { checkRateLimit } from "@/lib/rate-limit";

/** Reporting API batches carry the original policy per report; 64 KiB fits a full batch. */
const MAX_CSP_REPORT_BYTES = 64 * 1024;

/**
 * F-156: receives `report-uri` and `report-to` CSP violation reports, keeps
 * only de-identified fields (see `@/lib/csp-report`) and writes one structured
 * `csp_violation` log line per distinct violation, so log search aggregates
 * them by directive, blocked origin and path. Always 204 for well-formed and
 * unknown bodies alike; nothing is stored.
 */
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, "csp-report", 120, 60_000);
  if (limited) return limited;

  const report = await readTextBody(request, MAX_CSP_REPORT_BYTES);
  if (report === null) {
    return NextResponse.json({ error: "CSP report payload too large" }, { status: 413 });
  }

  for (const violation of aggregateCspViolations(parseCspReports(report, request.headers.get("content-type")))) {
    console.warn("csp_violation", JSON.stringify(violation));
  }

  return new NextResponse(null, { status: 204 });
}
