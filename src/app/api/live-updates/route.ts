import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import {
  chatSessionTokenFromRequest,
  decodeLiveUpdatesCursor,
  LiveChatError,
  listViewerChatUpdates,
  resolveViewerAdmissionContext,
} from "@/lib/live-chat";
import { liveChatIpTrustConfig, rateLimitRequestWithIdentity } from "@/lib/live-chat-request-security";
import { readViewerInteractionState } from "@/lib/live-interaction-viewer-state";
import { hashLiveViewerToken, liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { liveViewerPassFromRequest } from "@/lib/live-viewer-pass";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";

/**
 * Merged viewer poll (F-091 (2)): chat rows after `since` plus the current
 * interaction state in one request, behind one admission check. Replaces the
 * separate 3 s chat and 2 s interaction GET polls of the viewer page.
 */

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_QUERY_LENGTH = 1_024;
// Poll hints returned to the client, which clamps them again on its side.
const ACTIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 3_000;

const Identifier = z.string().trim().min(1).max(128);
const INCLUDE_VALUES = ["chat", "interactions"] as const;
type IncludePart = (typeof INCLUDE_VALUES)[number];
const QuerySchema = z.object({
  vendorId: Identifier,
  liveId: Identifier,
  since: z.string().trim().min(1).max(320).optional(),
  include: z.string().max(64).optional(),
}).strict();

function noStore<T extends Response>(response: T) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

function parseQuery(request: Request) {
  if (request.url.length > MAX_QUERY_LENGTH) return null;
  const searchParams = new URL(request.url).searchParams;
  const allowed = new Set(["vendorId", "liveId", "since", "include"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) return null;
  }
  for (const key of allowed) {
    if (searchParams.getAll(key).length > 1) return null;
  }
  const parsed = QuerySchema.safeParse({
    vendorId: searchParams.get("vendorId") ?? "",
    liveId: searchParams.get("liveId") ?? "",
    since: searchParams.get("since") ?? undefined,
    include: searchParams.get("include") ?? undefined,
  });
  if (!parsed.success) return null;
  const requested = parsed.data.include === undefined ? [...INCLUDE_VALUES] : parsed.data.include.split(",");
  const parts = new Set<IncludePart>();
  for (const part of requested) {
    if (!(INCLUDE_VALUES as readonly string[]).includes(part)) return null;
    parts.add(part as IncludePart);
  }
  return { ...parsed.data, chat: parts.has("chat"), interactions: parts.has("interactions") };
}

export async function GET(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return noStore(sameOrigin);

  const clientIp = getRequestClientIp(request, liveChatIpTrustConfig());
  const limited = await checkRateLimit(rateLimitRequestWithIdentity(request, clientIp), "live-updates-read", 180, 60_000);
  if (limited) return noStore(limited);

  const query = parseQuery(request);
  if (!query) return json({ error: "Invalid live updates request" }, 400);
  // Verify the signed, live-bound cursor before any read so a bad one costs nothing.
  if (query.since && !decodeLiveUpdatesCursor(query.since, query.liveId)) return json({ error: "Invalid live updates cursor" }, 400);

  try {
    const db = getDb();
    // One admission check (signed pass first, session row otherwise) for both halves.
    const admission = await resolveViewerAdmissionContext(db, {
      vendorId: query.vendorId,
      liveId: query.liveId,
      admissionToken: liveViewerTokenFromRequest(request),
    }, liveViewerPassFromRequest(request));
    const [chat, interactions] = await Promise.all([
      query.chat
        ? listViewerChatUpdates(db, {
            vendorId: query.vendorId,
            liveId: query.liveId,
            since: query.since,
            admission,
            chatSessionToken: chatSessionTokenFromRequest(request),
            ipAddress: clientIp,
          })
        : null,
      query.interactions
        ? readViewerInteractionState(db, {
            vendorId: query.vendorId,
            liveId: query.liveId,
            participantHash: hashLiveViewerToken(admission.admissionToken),
          })
        : null,
    ]);
    const interactionActive = Boolean(interactions && (interactions.runs.length > 0 || interactions.spotlight));
    return json({
      cursor: chat?.cursor ?? null,
      nextPollMs: interactionActive ? ACTIVE_POLL_MS : IDLE_POLL_MS,
      ...(chat ? { chat: { messages: chat.messages, reset: chat.reset, viewer: chat.viewer } } : {}),
      ...(interactions ? { interactions } : {}),
    });
  } catch (error) {
    if (error instanceof LiveChatError) {
      if (error.code === "invalid_cursor") return json({ error: "Invalid live updates cursor" }, 400);
      return json({ error: "Viewer admission required" }, 401);
    }
    return json({ error: "Unable to load live updates" }, 500);
  }
}
