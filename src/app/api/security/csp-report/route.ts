import { NextResponse } from "next/server";
import { readTextBody } from "@/lib/api-security";
import { aggregateCspViolations, cspReportLocalLimit, parseCspReports } from "@/lib/csp-report";
import { checkRateLimit } from "@/lib/rate-limit";

/** Reporting API batches carry the original policy per report; 64 KiB fits a full batch. */
const MAX_CSP_REPORT_BYTES = 64 * 1024;

/**
 * F-156: receives `report-uri` and `report-to` CSP violation reports, keeps
 * only de-identified fields (see `@/lib/csp-report`) and writes one structured
 * `csp_violation` log line per distinct violation, so log search aggregates
 * them by directive, blocked origin and path. Always 204 for well-formed and
 * unknown bodies alike; nothing is stored.
 *
 * Limits: the shared limiter (120/min per IP; a no-op under
 * RATE_LIMIT_PROVIDER=cloudflare_waf), then a per-instance cap that always
 * applies (120/min per IP, 2000/min in total), both before the body is read.
 */
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, "csp-report", 120, 60_000);
  if (limited) return limited;
  const retryAfter = cspReportLocalLimit(request);
  if (retryAfter !== null) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const report = await readTextBody(request, MAX_CSP_REPORT_BYTES);
  if (report === null) {
    return NextResponse.json({ error: "CSP report payload too large" }, { status: 413 });
  }

  for (const violation of aggregateCspViolations(parseCspReports(report, request.headers.get("content-type")))) {
    console.warn("csp_violation", JSON.stringify(violation));
  }

  return new NextResponse(null, { status: 204 });
}
