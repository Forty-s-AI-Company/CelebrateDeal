import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { hasActiveLiveViewerSession, liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  recordStreamUsageLedgerEntry,
  StreamUsageValidationError,
  STREAM_USAGE_MAX_HEARTBEAT_SECONDS,
} from "@/lib/stream-usage";

const StreamUsagePayload = z.object({
  vendorId: z.string().min(1).max(128),
  liveId: z.string().min(1).max(128),
  sourcePageSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i).max(160).nullable().optional(),
  liveShareCode: z.string().regex(/^tls1\.[A-Za-z0-9_-]{32,}$/u).max(160).nullable().optional(),
  eventId: z.string().uuid(),
  watchSeconds: z.number().int().min(1).max(STREAM_USAGE_MAX_HEARTBEAT_SECONDS),
}).strict();

function errorResponse(error: StreamUsageValidationError) {
  if (error.code === "live_not_found" || error.code === "source_page_not_found") {
    return NextResponse.json({ error: "Playback source not found" }, { status: 404 });
  }
  if (error.code === "event_conflict") {
    return NextResponse.json({ error: "Usage event conflict" }, { status: 409 });
  }
  if (error.code === "stream_minutes_exhausted") {
    return NextResponse.json(
      { error: "Stream quota exhausted", code: "stream_minutes_exhausted" },
      { status: 429, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json({ error: "Invalid usage event" }, { status: 400 });
}

function admissionRequiredResponse() {
  return NextResponse.json(
    { error: "Playback unavailable" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "stream-usage", 120, 60_000);
  if (limited) return limited;

  const parsed = StreamUsagePayload.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid usage event" }, { status: 400 });

  try {
    const token = liveViewerTokenFromRequest(request);
    if (!token) return admissionRequiredResponse();

    const admitted = await hasActiveLiveViewerSession(getDb(), {
      vendorId: parsed.data.vendorId,
      liveId: parsed.data.liveId,
      token,
    });
    if (!admitted) return admissionRequiredResponse();

    const result = await recordStreamUsageLedgerEntry(parsed.data);
    return NextResponse.json({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    if (error instanceof StreamUsageValidationError) return errorResponse(error);
    return NextResponse.json({ error: "Unable to record usage" }, { status: 500 });
  }
}
