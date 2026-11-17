import { NextResponse } from "next/server";
import { createFirstSuccessInvite } from "@/lib/staging-first-success";
import { authorizeWp4Ops, wp4Unavailable } from "@/lib/wp4-runtime-boundary";

/**
 * Staging-only: one short-lived registration invite for a fresh Resend test
 * mailbox, for the O-13 first-success runner. The handler takes no input; the
 * address is derived from a server-generated run id.
 */
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  try {
    const { runId, invitePath, expiresAt } = await createFirstSuccessInvite();
    return NextResponse.json(
      { runId, invitePath, expiresAt: expiresAt.toISOString() },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return wp4Unavailable(503);
  }
}
