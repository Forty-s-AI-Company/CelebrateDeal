import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getCsrfToken, verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { chatSessionTokenFromRequest, LiveChatError } from "@/lib/live-chat";
import { liveChatIpTrustConfig, rateLimitRequestWithIdentity } from "@/lib/live-chat-request-security";
import { liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { createPrivateViewerChat, listPrivateViewerChat } from "@/lib/live-private-chat";
import { PrivateViewerChatPost, PrivateViewerChatQuery } from "@/lib/live-private-chat-contract";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";

const headers = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const noStore = (response: Response) => { for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; };
const Post = PrivateViewerChatPost.extend({ csrfToken: z.string().min(1).max(512) }).strict();
async function security(request: Request, write: boolean) {
  const denied = requireSameOriginRequest(request, { requireClientHeader: true });
  if (denied) return { response: noStore(denied), ipAddress: null };
  const ipAddress = getRequestClientIp(request, liveChatIpTrustConfig());
  if (write && !ipAddress) return { response: json({ error: "Private chat unavailable" }, 403), ipAddress: null };
  const limited = await checkRateLimit(rateLimitRequestWithIdentity(request, ipAddress), write ? "private-live-chat-write" : "private-live-chat-read", 60, 60_000);
  return { response: limited ? noStore(limited) : null, ipAddress };
}
function failure(error: unknown) {
  if (error instanceof LiveChatError) {
    const status = error.code === "invalid_cursor" ? 400 : error.code === "keyword_blocked" ? 422
      : ["idempotency_conflict", "transaction_conflict"].includes(error.code) ? 409 : 403;
    return json({ error: "Private chat unavailable", code: error.code }, status);
  }
  if (error instanceof z.ZodError) return json({ error: "Invalid private chat request" }, 400);
  return json({ error: "Private chat unavailable" }, 500);
}
function proof(request: Request, ipAddress: string | null) {
  return { admissionToken: liveViewerTokenFromRequest(request), chatSessionToken: chatSessionTokenFromRequest(request), ipAddress };
}

export async function GET(request: Request) {
  const gate = await security(request, false); if (gate.response) return gate.response;
  if (request.url.length > 2048) return json({ error: "Invalid private chat request" }, 400);
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return json({ error: "Invalid private chat request" }, 400);
  const parsed = PrivateViewerChatQuery.safeParse(Object.fromEntries(query));
  if (!parsed.success) return json({ error: "Invalid private chat request" }, 400);
  try {
    const page = await listPrivateViewerChat(getDb(), { ...parsed.data, ...proof(request, gate.ipAddress) });
    // Mint a write token only after this viewer's conversation was authorized.
    return json({ ...page, csrfToken: await getCsrfToken() });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const gate = await security(request, true); if (gate.response) return gate.response;
  const parsed = Post.safeParse(await readJsonBody(request, 16 * 1024));
  if (!parsed.success) return json({ error: "Invalid private chat request" }, 400);
  if (!await verifyCsrfToken(parsed.data.csrfToken)) return json({ error: "Invalid private chat token" }, 403);
  try {
    const result = await createPrivateViewerChat(getDb(), { ...parsed.data, ...proof(request, gate.ipAddress) });
    return json(result.message, result.created ? 201 : 200);
  } catch (error) { return failure(error); }
}
