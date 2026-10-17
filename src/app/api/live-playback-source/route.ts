import { z } from "zod";
import { NextResponse } from "next/server";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { resolveTrackedLivePlaybackSource } from "@/lib/live-metric-playback-intake";
import { checkRateLimit } from "@/lib/trusted-entry-rate-limit";
import { MetricIngestError } from "@/lib/live-metric-ingestion";
import { metricIngressFromRequest } from '@/lib/live-metric-ingress-proof';

const PlaybackSourceQuery = z.object({
  vendorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  liveId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
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

  try {
    const binding=metricIngressFromRequest(request.headers,{kind:'playback',method:'GET',target:url.pathname+url.search});
    const source = binding?await resolveTrackedLivePlaybackSource(getDb(), { ...parsed.data, token },binding)
      :await resolveTrackedLivePlaybackSource(getDb(), { ...parsed.data, token });
    if (!source) return unavailableResponse();
    return NextResponse.json(source, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MetricIngestError && error.code === "not_authorized") return unavailableResponse();
    return NextResponse.json({ error: "Playback temporarily unavailable" }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
