import { z } from "zod";
import { NextResponse } from "next/server";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { resolveLivePlaybackSource } from "@/lib/live-playback-source";
import { checkRateLimit } from "@/lib/rate-limit";

const PlaybackSourceQuery = z.object({
  vendorId: z.string().min(1).max(128),
  liveId: z.string().min(1).max(128),
}).strict();

function unavailableResponse() {
  return NextResponse.json(
    { error: "Playback unavailable" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "live-playback-source", 120, 60_000);
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = PlaybackSourceQuery.safeParse({
    vendorId: url.searchParams.get("vendorId"),
    liveId: url.searchParams.get("liveId"),
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid playback request" }, { status: 400 });

  const token = liveViewerTokenFromRequest(request);
  if (!token) return unavailableResponse();

  const source = await resolveLivePlaybackSource(getDb(), { ...parsed.data, token });
  if (!source) return unavailableResponse();

  return NextResponse.json(source, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
