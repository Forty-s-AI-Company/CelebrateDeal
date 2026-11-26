import { NextResponse } from "next/server";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { chatSessionTokenFromRequest, resolveViewerRegistrationName } from "@/lib/live-chat";
import { liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { liveViewerPassRateLimitIdentity } from "@/lib/live-viewer-pass";
import {
  findLiveViewerProfile,
  LIVE_VIEWER_PROFILE_COOKIE,
  liveViewerAvatarUrl,
  liveViewerProfileCookieOptions,
  LiveViewerProfileError,
  liveViewerProfileErrorMessage,
  LiveViewerProfileSaveSchema,
  LiveViewerProfileScopeSchema,
  liveViewerProfileTokenFromRequest,
  resolveLiveViewerProfileScope,
  saveLiveViewerProfile,
  suggestLiveViewerNickname,
} from "@/lib/live-viewer-profile";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * The viewer's nickname and avatar in one live room. Both methods need the
 * same-origin client header and an active admission session for exactly this
 * vendor/live (the session row is the source of the ids used in every query).
 */

const MAX_QUERY_LENGTH = 1_024;
const MAX_BODY_BYTES = 4 * 1024;
/** Per source IP each minute: a classroom behind one CGNAT address fits. */
const READ_IP_LIMIT = 600;
const WRITE_IP_LIMIT = 300;
/** Per viewer (verified pass) each minute. */
const WRITE_VIEWER_LIMIT = 10;

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
  const message = liveViewerProfileErrorMessage(error);
  if (error.code === "access_denied") return json({ error: error.code, message }, 403);
  if (error.code === "nickname_taken") return json({ error: error.code, message }, 409);
  return json({ error: error.code, message }, 400);
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
    const scope = await resolveLiveViewerProfileScope(db, { ...query, admissionToken });
    const row = await findLiveViewerProfile(db, scope, liveViewerProfileTokenFromRequest(request));
    const avatarUrl = row ? liveViewerAvatarUrl(row.avatarSeed) : null;
    const profile = row && avatarUrl ? { nickname: row.nickname, avatarSeed: row.avatarSeed, avatarUrl } : null;
    // Only the caller's own verified registration name; never another viewer.
    const registrationName = profile
      ? null
      : await resolveViewerRegistrationName(db, { ...scope, chatSessionToken: chatSessionTokenFromRequest(request) }, { admissionToken });
    return json({ profile, suggestedNickname: suggestLiveViewerNickname(registrationName) });
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
    const result = await saveLiveViewerProfile(getDb(), {
      ...parsed.data,
      admissionToken,
      profileToken: liveViewerProfileTokenFromRequest(request),
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
