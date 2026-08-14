import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { admitLiveViewer, LiveQuotaAdmissionError, liveViewerCookieOptions, liveViewerTokenFromRequest, releaseLiveViewer } from "@/lib/live-quota-admission";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const LiveAdmissionPayload = z.object({
  vendorId: z.string().min(1).max(128),
  liveId: z.string().min(1).max(128),
}).strict();

function errorResponse(error: LiveQuotaAdmissionError) {
  if (error.code === "live_not_found") {
    return NextResponse.json({ error: "Playback source not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "Playback temporarily unavailable" }, { status: 429 });
}

async function readPayload(request: Request) {
  const parsed = LiveAdmissionPayload.safeParse(await readJsonBody(request));
  return parsed.success ? parsed.data : null;
}

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "live-admission", 120, 60_000);
  if (limited) return limited;

  const payload = await readPayload(request);
  if (!payload) return NextResponse.json({ error: "Invalid admission request" }, { status: 400 });

  try {
    const result = await admitLiveViewer(getDb(), {
      ...payload,
      token: liveViewerTokenFromRequest(request),
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set("celebratedeal_live_viewer", result.token, liveViewerCookieOptions(request));
    return response;
  } catch (error) {
    if (error instanceof LiveQuotaAdmissionError) return errorResponse(error);
    return NextResponse.json({ error: "Unable to admit playback" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const payload = await readPayload(request);
  if (!payload) return NextResponse.json({ error: "Invalid admission request" }, { status: 400 });

  await releaseLiveViewer(getDb(), {
    ...payload,
    token: liveViewerTokenFromRequest(request),
  });
  return NextResponse.json({ ok: true });
}
