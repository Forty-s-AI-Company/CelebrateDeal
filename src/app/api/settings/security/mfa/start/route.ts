import { withMfaReturnPath } from "@/lib/mfa-return-path";
import { NextResponse } from "next/server";
import { startMfaEnrollment } from "@/lib/mfa-enrollment";

/**
 * Uses a native POST redirect for MFA setup. This keeps the start navigation
 * independent from Next 16's same-route Server Action reducer while sharing
 * the exact CSRF, Origin, session and cookie transition with the action.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const result = await startMfaEnrollment(formData);
  const browserOrigin = request.headers.get("origin");
  const redirectBase = browserOrigin ? new URL(browserOrigin).origin : new URL(request.url).origin;
  return NextResponse.redirect(
    new URL(withMfaReturnPath(`${result.destination}?updated=${result.updated}`, formData.get("next")), redirectBase),
    303,
  );
}
