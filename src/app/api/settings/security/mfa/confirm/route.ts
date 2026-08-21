import { NextResponse } from "next/server";
import { completeMfaEnrollment } from "@/lib/mfa-enrollment";

/**
 * Uses a native POST redirect for the nested owner settings flow. This keeps
 * the browser navigation independent from Next 16's Server Action reducer.
 */
export async function POST(request: Request) {
  const result = await completeMfaEnrollment(await request.formData());
  const query = result.ok ? "updated=mfa_enabled" : "error=mfa_code";
  // Next's internal request URL may use the configured canonical host while
  // the browser is using a loopback alias. The origin was already validated by
  // completeMfaEnrollment, so preserve that browser origin for the redirect
  // and keep the session cookie on the same host.
  const browserOrigin = request.headers.get("origin");
  const redirectBase = browserOrigin ? new URL(browserOrigin).origin : new URL(request.url).origin;
  return NextResponse.redirect(
    new URL(`${result.destination}?${query}`, redirectBase),
    303,
  );
}
