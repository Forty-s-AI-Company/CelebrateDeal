import { NextResponse } from "next/server";
import { dismissMfaRecoveryCodes } from "@/lib/mfa-enrollment";

/**
 * Uses a native POST so the one-time recovery-code acknowledgement remains
 * reliable before React hydration. The shared service still enforces Origin,
 * CSRF, authentication and the exact cookie transition.
 */
export async function POST(request: Request) {
  const result = await dismissMfaRecoveryCodes(await request.formData());
  const browserOrigin = request.headers.get("origin");
  const redirectBase = browserOrigin ? new URL(browserOrigin).origin : new URL(request.url).origin;
  return NextResponse.redirect(new URL(result.destination, redirectBase), 303);
}
