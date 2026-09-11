import { NextResponse } from "next/server";
import { completeMfaEnrollment } from "@/lib/mfa-enrollment";

/**
 * Uses a native POST redirect for the nested owner settings flow. This keeps
 * the browser navigation independent from Next 16's Server Action reducer.
 */
export async function POST(request: Request) {
  const result = await completeMfaEnrollment(await request.formData());
  // Next's internal request URL may use the configured canonical host while
  // the browser is using a loopback alias. The origin was already validated by
  // completeMfaEnrollment, so preserve that browser origin for the redirect
  // and keep the session cookie on the same host.
  const browserOrigin = request.headers.get("origin");
  const redirectBase = browserOrigin ? new URL(browserOrigin).origin : new URL(request.url).origin;
  const destination = new URL(result.destination, redirectBase);
  destination.searchParams.set(result.ok ? "updated" : "error", result.ok ? "mfa_enabled" : "mfa_code");
  return NextResponse.redirect(destination, 303);
}
