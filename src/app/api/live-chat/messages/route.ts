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
import { checkRateLimit } from "@/lib/rate-limit";
import type { ClientIpTrustConfig } from "@/lib/request-client-ip";
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

function liveChatIpTrustConfig(env: NodeJS.ProcessEnv = process.env): ClientIpTrustConfig {
  // Local development must use the runtime-provided address only. A local
  // RATE_LIMIT_PROVIDER value never becomes a proxy trust root.
  if (env.NODE_ENV !== "production") {
    return { trustMode: "runtime", deploymentSource: "node" };
  }

  if (env.RATE_LIMIT_PROVIDER === "cloudflare_waf") {
    return {
      trustMode: "cloudflare",
      deploymentSource: "cloudflare",
      ingressSecret: env.LIVE_CHAT_INGRESS_SECRET,
    };
  }
  if (env.RATE_LIMIT_PROVIDER === "upstash_redis") {
    return {
      trustMode: "trusted-proxy",
      deploymentSource: "vercel",
      ingressSecret: env.LIVE_CHAT_INGRESS_SECRET,
    };
  }
  return { trustMode: "none", deploymentSource: "none" };
}

function rateLimitRequestWithIdentity(request: Request, clientIp: string | null) {
  const headers = new Headers(request.headers);

  // checkRateLimit currently derives its final bucket suffix from these
  // legacy headers. Replace them with the already-normalized identity chosen
  // by this route so forged alternate headers cannot create another bucket.
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.set("cf-connecting-ip", clientIp ?? "unknown");
  // Construct the limiter-only request from a clone so reading this request's
  // body later in POST does not compete with the stream owned by the route.
  return new Request(request.body ? request.clone() : request, { headers });
}

type SecurityGateResult = {
  response: Response | null;
  clientIp: string | null;
};

async function securityGate(request: Request, key: string, requireTrustedClientIp: boolean): Promise<SecurityGateResult> {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return { response: noStore(sameOrigin), clientIp: null };

  const clientIp = getRequestClientIp(request, liveChatIpTrustConfig());
  if (requireTrustedClientIp && !clientIp) {
    return { response: json({ error: "Unable to use live chat" }, 403), clientIp: null };
  }

  const limited = await checkRateLimit(
    rateLimitRequestWithIdentity(request, clientIp),
    key,
    60,
    60_000,
  );
  return { response: limited ? noStore(limited) : null, clientIp };
}

export async function GET(request: Request) {
  const security = await securityGate(request, "live-chat-read", false);
  if (security.response) return security.response;

  const rawQuery = queryValues(request);
  const parsed = rawQuery ? ViewerChatQuerySchema.safeParse(rawQuery) : null;
  if (!parsed?.success) return json({ error: "Invalid chat request" }, 400);

  try {
    const result = await listViewerChatMessages(getDb(), {
      ...parsed.data,
      chatSessionToken: chatSessionTokenFromRequest(request),
      admissionToken: liveViewerTokenFromRequest(request),
      ipAddress: security.clientIp,
    });
    return json(result);
  } catch (error) {
    return errorFor(error);
  }
}

export async function POST(request: Request) {
  const security = await securityGate(request, "live-chat-write", true);
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
