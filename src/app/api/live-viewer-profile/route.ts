import { NextResponse } from "next/server";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { chatSessionTokenFromRequest, resolveViewerProfileModeration, resolveViewerRegistrationName } from "@/lib/live-chat";
import { liveChatIpTrustConfig } from "@/lib/live-chat-request-security";
import { liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { liveViewerPassRateLimitIdentity } from "@/lib/live-viewer-pass";
import {
  LIVE_VIEWER_PROFILE_COOKIE,
  liveViewerProfileCookieOptions,
  LiveViewerProfileError,
  liveViewerProfileErrorMessage,
  LiveViewerProfileSaveSchema,
  LiveViewerProfileScopeSchema,
  liveViewerProfileTokenFromRequest,
  readLiveViewerProfile,
  saveLiveViewerProfile,
  suggestLiveViewerNickname,
} from "@/lib/live-viewer-profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";

/**
 * The viewer's nickname and avatar in one live room. Both methods need the
 * same-origin client header and an active admission session for exactly this
 * vendor/live (the session row is the source of the ids used in every query).
 * The nickname is a display name, not a security control.
 */

const MAX_QUERY_LENGTH = 1_024;
const MAX_BODY_BYTES = 4 * 1024;
/** Per source IP each minute: a classroom behind one CGNAT address fits. */
const READ_IP_LIMIT = 600;
const WRITE_IP_LIMIT = 300;
/** Per viewer (verified pass) each minute. */
const WRITE_VIEWER_LIMIT = 10;

const ERROR_STATUS: Record<LiveViewerProfileError["code"], number> = {
  access_denied: 403,
  blocked: 403,
  invalid_nickname: 400,
  nickname_blocked: 400,
  invalid_avatar: 400,
  nickname_taken: 409,
  too_many_profiles: 429,
};

function noStore<T extends Response>(response: T) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function json(data: unknown, status = 200) {
  return noStore(NextResponse.json(data, { status }));
}

function errorResponse(error: unknown) {
  if (!(error instanceof LiveViewerProfileError)) {
    return json({ error: "Unable to save the nickname" }, 500);
  }
  return json({ error: error.code, message: liveViewerProfileErrorMessage(error) }, ERROR_STATUS[error.code]);
}

function parseScope(request: Request) {
  if (request.url.length > MAX_QUERY_LENGTH) return null;
  const searchParams = new URL(request.url).searchParams;
  const allowed = new Set(["vendorId", "liveId"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) return null;
  }
  for (const key of allowed) {
    if (searchParams.getAll(key).length > 1) return null;
  }
  const parsed = LiveViewerProfileScopeSchema.safeParse({
    vendorId: searchParams.get("vendorId") ?? "",
    liveId: searchParams.get("liveId") ?? "",
  });
  return parsed.success ? parsed.data : null;
}

export async function GET(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return noStore(sameOrigin);
  const limited = await checkRateLimit(request, "live-viewer-profile-read-ip", READ_IP_LIMIT, 60_000);
  if (limited) return noStore(limited);

  const query = parseScope(request);
  if (!query) return json({ error: "invalid_request" }, 400);

  try {
    const db = getDb();
    const admissionToken = liveViewerTokenFromRequest(request);
    if (!admissionToken) throw new LiveViewerProfileError("access_denied");
    const result = await readLiveViewerProfile(db, { ...query, admissionToken, profileToken: liveViewerProfileTokenFromRequest(request) });
    // A released nickname is offered again; otherwise the caller's own
    // verified registration name. Never another viewer's.
    const registrationName = result.profile || result.previousNickname
      ? null
      : await resolveViewerRegistrationName(db, { ...query, chatSessionToken: chatSessionTokenFromRequest(request) }, { admissionToken });
    return json({ profile: result.profile, suggestedNickname: suggestLiveViewerNickname(result.previousNickname ?? registrationName) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return noStore(sameOrigin);
  const ipLimited = await checkRateLimit(request, "live-viewer-profile-write-ip", WRITE_IP_LIMIT, 60_000);
  if (ipLimited) return noStore(ipLimited);

  const parsed = LiveViewerProfileSaveSchema.safeParse(await readJsonBody(request, MAX_BODY_BYTES));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const admissionToken = liveViewerTokenFromRequest(request);
  // One bucket per verified viewer pass so viewers behind one NAT do not
  // throttle each other; without a pass the trusted IP is the bucket.
  const identity = liveViewerPassRateLimitIdentity(request, {
    vendorId: parsed.data.vendorId,
    liveId: parsed.data.liveId,
    admissionToken,
  });
  const viewerLimited = identity
    ? await checkRateLimit(request, "live-viewer-profile-write", WRITE_VIEWER_LIMIT, 60_000, { clientIp: identity })
    : await checkRateLimit(request, "live-viewer-profile-write", WRITE_VIEWER_LIMIT, 60_000);
  if (viewerLimited) return noStore(viewerLimited);

  try {
    const db = getDb();
    const chatSessionToken = chatSessionTokenFromRequest(request);
    const ipAddress = getRequestClientIp(request, liveChatIpTrustConfig());
    const result = await saveLiveViewerProfile(db, {
      ...parsed.data,
      admissionToken,
      profileToken: liveViewerProfileTokenFromRequest(request),
      // The vendor's blacklist, with the scope taken from the admission row.
      moderate: (scope) => resolveViewerProfileModeration(db, {
        ...scope,
        admissionToken: admissionToken ?? "",
        chatSessionToken,
        ipAddress,
      }),
    });
    const response = json({ profile: result.profile });
    if (result.issuedProfileToken) {
      response.cookies.set(LIVE_VIEWER_PROFILE_COOKIE, result.issuedProfileToken, liveViewerProfileCookieOptions(request));
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
