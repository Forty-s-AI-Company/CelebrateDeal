import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import {
  EVERGREEN_LIVE_SELECT,
  evergreenSessionCookieName,
  evergreenSessionCookieOptions,
  evergreenSessionTokenFromRequest,
  publicEvergreenSession,
  resolveEvergreenViewerSession,
  type EvergreenSessionIntent,
} from "@/lib/evergreen-viewer-session";
import { getRuntimeLivePublishReadiness } from "@/lib/live-runtime-readiness";
import { checkRateLimit } from "@/lib/rate-limit";
import { publicLiveAvailabilityWhere } from "@/lib/sellable-live";

const Identifier = z.string().trim().min(1).max(128);
const SessionQuery = z.object({
  liveId: Identifier,
  vendorId: Identifier.optional(),
}).strict();
const SessionPayload = z.object({
  liveId: Identifier,
  vendorId: Identifier.optional(),
  intent: z.enum(["claim", "rejoin"]).optional(),
}).strict();

const privateHeaders = { "Cache-Control": "private, no-store" };

function unavailable() {
  return NextResponse.json({ error: "Evergreen session unavailable" }, { status: 404, headers: privateHeaders });
}

/**
 * Only a public, publish-ready evergreen Live resolves. The vendor comes from
 * the Live row itself, so the signed session is always bound to its owner.
 */
async function loadEvergreenLive(liveId: string, vendorId: string | undefined) {
  const live = await getDb().live.findFirst({
    where: {
      id: liveId,
      ...(vendorId ? { vendorId } : {}),
      isEvergreen: true,
      ...publicLiveAvailabilityWhere(),
    },
    select: {
      ...EVERGREEN_LIVE_SELECT,
      vendor: { select: { timezone: true } },
      video: { select: { vendorId: true, durationSec: true, sourceType: true, status: true, cloudflareReadyToStream: true, cloudflareLiveInputUid: true, liveInputStatus: true } },
      form: { select: { vendorId: true, isActive: true, fields: true } },
      messageTemplate: { select: { vendorId: true, channel: true, trigger: true, isActive: true, subject: true, body: true } },
      interactionScript: { select: { vendorId: true, status: true } },
      products: {
        select: {
          vendorId: true,
          product: { select: { vendorId: true, isActive: true, fulfillmentTypeConfirmed: true } },
        },
      },
    },
  });
  if (!live || !getRuntimeLivePublishReadiness(live).ready) return null;
  return live;
}

async function respond(request: Request, input: { liveId: string; vendorId?: string }, intent: EvergreenSessionIntent) {
  const live = await loadEvergreenLive(input.liveId, input.vendorId);
  if (!live) return unavailable();
  const now = new Date();
  const session = resolveEvergreenViewerSession({
    live,
    vendorTimezone: live.vendor.timezone,
    token: evergreenSessionTokenFromRequest(request, live.id),
    intent,
    now,
  });
  if (!session) return unavailable();
  const response = NextResponse.json(publicEvergreenSession(session, now), { headers: privateHeaders });
  if (session.issuedToken) {
    response.cookies.set(evergreenSessionCookieName(live.id), session.issuedToken, evergreenSessionCookieOptions(request));
  }
  return response;
}

/** Read-only: the visitor's session, or the session they would get now. */
export async function GET(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "live-evergreen-session", 120, 60_000);
  if (limited) return limited;
  const url = new URL(request.url);
  const parsed = SessionQuery.safeParse({
    liveId: url.searchParams.get("liveId") ?? undefined,
    vendorId: url.searchParams.get("vendorId") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid evergreen session request" }, { status: 400 });
  return respond(request, parsed.data, "read");
}

/** Assigns (claim) or, after the visitor's session ended, replaces (rejoin) it. */
export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "live-evergreen-session", 120, 60_000);
  if (limited) return limited;
  const parsed = SessionPayload.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid evergreen session request" }, { status: 400 });
  const { intent = "claim", ...input } = parsed.data;
  return respond(request, input, intent);
}
