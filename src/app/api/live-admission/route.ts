import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { admitLiveViewer, LIVE_VIEWER_SESSION_TTL_MS, LiveQuotaAdmissionError, liveViewerCookieOptions, liveViewerTokenFromRequest, releaseLiveViewer } from "@/lib/live-quota-admission";
import { getDb } from "@/lib/db";
import { evergreenSessionTokenFromRequest } from "@/lib/evergreen-viewer-session";
import { createLiveViewerPass, LIVE_VIEWER_PASS_COOKIE, liveViewerPassCookieOptions } from "@/lib/live-viewer-pass";
import { checkRateLimit } from "@/lib/rate-limit";

const LiveAdmissionPayload = z.object({
  vendorId: z.string().min(1).max(128),
  liveId: z.string().min(1).max(128),
}).strict();

function errorResponse(error: LiveQuotaAdmissionError) {
  if (error.code === "live_not_found") {
    return NextResponse.json({ error: "Playback source not found" }, { status: 404 });
  }
  if (error.code === "admission_busy") {
    return NextResponse.json({ error: "Playback temporarily unavailable" }, { status: 503 });
  }
  return NextResponse.json({ error: "Playback temporarily unavailable" }, { status: 429 });
}

/** A refused or failed admission also ends read-poll access (R461-05). */
function withoutViewerPass(request: Request, response: NextResponse) {
  response.cookies.set(LIVE_VIEWER_PASS_COOKIE, "", liveViewerPassCookieOptions(request, 0));
  return response;
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
      evergreenToken: evergreenSessionTokenFromRequest(request, payload.liveId),
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set("celebratedeal_live_viewer", result.token, liveViewerCookieOptions(request));
    // Renewed with every admission: read polls verify this signature instead
    // of reading the viewer session row (F-091).
    response.cookies.set(LIVE_VIEWER_PASS_COOKIE, createLiveViewerPass({
      vendorId: payload.vendorId,
      liveId: payload.liveId,
      viewerSessionId: result.sessionId,
      admissionToken: result.token,
      sessionExpiresAt: result.expiresAt,
    }), liveViewerPassCookieOptions(request, Math.ceil(LIVE_VIEWER_SESSION_TTL_MS / 1_000)));
    return response;
  } catch (error) {
    if (error instanceof LiveQuotaAdmissionError) return withoutViewerPass(request, errorResponse(error));
    return withoutViewerPass(request, NextResponse.json({ error: "Unable to admit playback" }, { status: 500 }));
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
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LIVE_VIEWER_PASS_COOKIE, "", liveViewerPassCookieOptions(request, 0));
  return response;
}
