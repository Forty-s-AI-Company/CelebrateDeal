import { z } from "zod";
import { NextResponse } from "next/server";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { evergreenSessionTokenFromRequest } from "@/lib/evergreen-viewer-session";
import { registrationSessionTokenFromRequest, sessionHintTokenFromRequest } from "@/lib/live-fixed-sessions-store";
import { resolveLiveWaitingSource } from "@/lib/live-waiting-source";
import { checkRateLimit } from "@/lib/rate-limit";

// Only the Live is named: the video is always the Live's own bound waiting video.
const WaitingSourceQuery = z.object({
  vendorId: z.string().min(1).max(128),
  liveId: z.string().min(1).max(128),
}).strict();

function unavailableResponse() {
  return NextResponse.json(
    { error: "Waiting video unavailable" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * The waiting-room background video of a public Live (before its start). No
 * admission session is needed or created: the waiting room never takes viewer
 * capacity and the loop is not metered (see src/lib/live-waiting-source.ts).
 */
export async function GET(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "live-waiting-source", 120, 60_000);
  if (limited) return limited;

  const url = new URL(request.url);
  // Exactly vendorId and liveId once each: an extra key (such as a video id) is refused, not ignored.
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || new Set(keys).size !== 2) {
    return NextResponse.json({ error: "Invalid waiting video request" }, { status: 400 });
  }
  const parsed = WaitingSourceQuery.safeParse({
    vendorId: url.searchParams.get("vendorId"),
    liveId: url.searchParams.get("liveId"),
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid waiting video request" }, { status: 400 });

  const source = await resolveLiveWaitingSource(getDb(), {
    ...parsed.data,
    evergreenToken: evergreenSessionTokenFromRequest(request, parsed.data.liveId),
    registrationToken: registrationSessionTokenFromRequest(request),
    sessionHintToken: sessionHintTokenFromRequest(request, parsed.data.liveId),
  });
  if (!source) return unavailableResponse();

  return NextResponse.json(source, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
