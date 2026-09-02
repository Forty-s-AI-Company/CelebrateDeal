import { NextResponse } from "next/server";
import { regenerateMfaRecoveryCodes } from "@/lib/mfa-recovery-regeneration";

/**
 * Native POST keeps confirmed recovery-code regeneration independent of the
 * Server Action reducer while retaining the same shared security transition.
 */
export async function POST(request: Request) {
  const result = await regenerateMfaRecoveryCodes(await request.formData());
  const query = result.ok ? "updated=recovery_regenerated" : `error=${result.error}`;
  const browserOrigin = request.headers.get("origin");
  const redirectBase = browserOrigin ? new URL(browserOrigin).origin : new URL(request.url).origin;
  return NextResponse.redirect(new URL(`${result.destination}?${query}`, redirectBase), 303);
}
