import { NextResponse } from "next/server";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import {
  chatSessionTokenFromRequest,
  createViewerChatMessage,
  LiveChatError,
  listViewerChatMessages,
  ViewerChatPostSchema,
  ViewerChatQuerySchema,
} from "@/lib/live-chat";
import { liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { liveViewerPassFromRequest, liveViewerPassRateLimitIdentity } from "@/lib/live-viewer-pass";
import { chatSpeakerRateLimitIdentity } from "@/lib/form-submission-chat-session";
import { checkRateLimit } from "@/lib/rate-limit";
import { liveChatIpTrustConfig } from "@/lib/live-chat-request-security";
import { getRequestClientIp } from "@/lib/request-client-ip";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_QUERY_LENGTH = 2_048;

function noStore<T extends Response>(response: T) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

function errorFor(error: unknown) {
  if (error instanceof LiveChatError) {
    if (error.code === "keyword_blocked") return json({ error: "Message contains blocked text" }, 422);
    if (error.code === "idempotency_conflict" || error.code === "transaction_conflict") {
      return json({ error: "Message retry conflicts with an existing message" }, 409);
    }
    if (error.code === "invalid_cursor") return json({ error: "Invalid chat cursor" }, 400);
    return json({ error: "Unable to use live chat" }, 403);
  }
  return json({ error: "Unable to use live chat" }, 500);
}

function queryValues(request: Request) {
  if (request.url.length > MAX_QUERY_LENGTH) return null;
  const searchParams = new URL(request.url).searchParams;
  const allowedKeys = new Set(["vendorId", "liveId", "cursor"]);
  for (const key of searchParams.keys()) {
    if (!allowedKeys.has(key)) return null;
  }
  for (const key of allowedKeys) {
    if (searchParams.getAll(key).length > 1) return null;
  }
  return {
    vendorId: searchParams.get("vendorId") ?? "",
    liveId: searchParams.get("liveId") ?? "",
    cursor: searchParams.get("cursor") ?? undefined,
  };
}

type SecurityGateResult = {
  response: Response | null;
  clientIp: string | null;
};

/** Per viewer (pass) or per speaker (chat session) each minute. */
const LIVE_CHAT_IDENTITY_LIMIT = 60;
/** Per source IP each minute for reads: room for a classroom behind one CGNAT address. */
const LIVE_CHAT_READ_IP_LIMIT = LIVE_CHAT_IDENTITY_LIMIT * 30;
/** Per source IP each minute for posts. */
const LIVE_CHAT_WRITE_IP_LIMIT = 600;

function rawScope(request: Request) {
  if (request.url.length > MAX_QUERY_LENGTH) return { vendorId: null, liveId: null };
  const searchParams = new URL(request.url).searchParams;
  return { vendorId: searchParams.get("vendorId"), liveId: searchParams.get("liveId") };
}

/**
 * A4-03 MAJOR-A: two buckets, both must pass.
 * - Identity: a verified viewer pass for reads, a verified chat session
 *   (one registration) for posts, so viewers sharing a NAT/CGNAT address do
 *   not throttle each other. Without one, the trusted IP.
 * - Source IP: a looser cap, so one address cannot multiply its allowance by
 *   opening many admissions or registrations.
 */
async function securityGate(request: Request, mode: "read" | "write"): Promise<SecurityGateResult> {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return { response: noStore(sameOrigin), clientIp: null };

  const clientIp = getRequestClientIp(request, liveChatIpTrustConfig());
  if (mode === "write" && !clientIp) {
    return { response: json({ error: "Unable to use live chat" }, 403), clientIp: null };
  }

  const ipLimited = mode === "write"
    ? await checkRateLimit(request, "live-chat-write-ip", LIVE_CHAT_WRITE_IP_LIMIT, 60_000, { clientIp })
    : await checkRateLimit(request, "live-chat-read-ip", LIVE_CHAT_READ_IP_LIMIT, 60_000, { clientIp });
  if (ipLimited) return { response: noStore(ipLimited), clientIp };

  const identity = mode === "write"
    ? chatSpeakerRateLimitIdentity(chatSessionTokenFromRequest(request))
    : liveViewerPassRateLimitIdentity(request, { ...rawScope(request), admissionToken: liveViewerTokenFromRequest(request) });
  const limited = await checkRateLimit(
    request,
    mode === "write" ? "live-chat-write" : "live-chat-read",
    LIVE_CHAT_IDENTITY_LIMIT,
    60_000,
    { clientIp: identity ?? clientIp },
  );
  return { response: limited ? noStore(limited) : null, clientIp };
}

export async function GET(request: Request) {
  const security = await securityGate(request, "read");
  if (security.response) return security.response;

  const rawQuery = queryValues(request);
  const parsed = rawQuery ? ViewerChatQuerySchema.safeParse(rawQuery) : null;
  if (!parsed?.success) return json({ error: "Invalid chat request" }, 400);

  try {
    const result = await listViewerChatMessages(getDb(), {
      ...parsed.data,
      chatSessionToken: chatSessionTokenFromRequest(request),
      admissionToken: liveViewerTokenFromRequest(request),
      // Read poll: a signed pass skips the per-poll viewer session read.
      viewerPass: liveViewerPassFromRequest(request),
      ipAddress: security.clientIp,
    });
    return json(result);
  } catch (error) {
    return errorFor(error);
  }
}

export async function POST(request: Request) {
  const security = await securityGate(request, "write");
  if (security.response) return security.response;

  const parsed = ViewerChatPostSchema.safeParse(await readJsonBody(request, 16 * 1024));
  if (!parsed.success) return json({ error: "Invalid chat request" }, 400);

  try {
    const result = await createViewerChatMessage(getDb(), {
      ...parsed.data,
      chatSessionToken: chatSessionTokenFromRequest(request),
      admissionToken: liveViewerTokenFromRequest(request),
      ipAddress: security.clientIp,
    });
    return json(result.message, result.created ? 201 : 200);
  } catch (error) {
    return errorFor(error);
  }
}
