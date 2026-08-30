import { NextResponse } from "next/server";
import { startMfaEnrollment } from "@/lib/mfa-enrollment";

/**
 * Uses a native POST redirect for MFA setup. This keeps the start navigation
 * independent from Next 16's same-route Server Action reducer while sharing
 * the exact CSRF, Origin, session and cookie transition with the action.
 */
export async function POST(request: Request) {
  const result = await startMfaEnrollment(await request.formData());
  const browserOrigin = request.headers.get("origin");
  const redirectBase = browserOrigin ? new URL(browserOrigin).origin : new URL(request.url).origin;
  return NextResponse.redirect(
    new URL(`${result.destination}?updated=${result.updated}`, redirectBase),
    303,
  );
}
