import { z } from "zod";
import { getCurrentAuth } from "@/lib/auth";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getCsrfToken, verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { LiveChatError } from "@/lib/live-chat";
import { rateLimitRequestWithIdentity } from "@/lib/live-chat-request-security";
import { createPrivateInstructorChat, listPrivateInstructorChat, listPrivateInstructorConversations } from "@/lib/live-private-chat";
import { PrivateViewerChatPost } from "@/lib/live-private-chat-contract";
import { checkRateLimit } from "@/lib/rate-limit";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const Query = z.object({ liveId: Id, submissionId: Id.optional(), cursor: z.string().min(1).max(256).optional() }).strict();
const Post = PrivateViewerChatPost.omit({ vendorId: true }).extend({ submissionId: Id, csrfToken: z.string().min(1).max(512) }).strict();
const headers = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const noStore = (response: Response) => { for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; };
async function gate(request: Request) {
  const denied = requireSameOriginRequest(request, { requireClientHeader: true });
  if (denied) return { response: noStore(denied), actor: null };
  const auth = await getCurrentAuth();
  if (!auth?.vendor || !auth.member || auth.member.status !== "active" || !["owner", "admin"].includes(auth.member.role)) {
    return { response: json({ error: "Private chat access denied" }, 403), actor: null };
  }
  // Authenticated user is the rate identity; forwarded headers cannot create
  // additional buckets for a manager by claiming different addresses.
  const limited = await checkRateLimit(rateLimitRequestWithIdentity(request, null), `private-instructor-chat:${auth.user.id}`, 60, 60_000);
  return { response: limited ? noStore(limited) : null,
    actor: { vendorId: auth.vendor.id, userId: auth.user.id, memberId: auth.member.id, sessionId: auth.session.id } };
}
function failure(error: unknown) {
  if (error instanceof LiveChatError) {
    const status = error.code === "invalid_cursor" ? 400 : ["idempotency_conflict", "transaction_conflict"].includes(error.code) ? 409 : 403;
    return json({ error: "Private chat unavailable", code: error.code }, status);
  }
  if (error instanceof z.ZodError) return json({ error: "Invalid private chat request" }, 400);
  return json({ error: "Private chat unavailable" }, 500);
}
export async function GET(request: Request) {
  const access = await gate(request); if (access.response || !access.actor) return access.response ?? json({ error: "Access denied" }, 403);
  if (request.url.length > 2048) return json({ error: "Invalid private chat request" }, 400);
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return json({ error: "Invalid private chat request" }, 400);
  const parsed = Query.safeParse(Object.fromEntries(query));
  if (!parsed.success) return json({ error: "Invalid private chat request" }, 400);
  try {
    const page = parsed.data.submissionId
      ? await listPrivateInstructorChat(getDb(), { ...access.actor, ...parsed.data, submissionId: parsed.data.submissionId })
      : await listPrivateInstructorConversations(getDb(), { ...access.actor, ...parsed.data });
    return json({ ...page, csrfToken: await getCsrfToken() });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const access = await gate(request); if (access.response || !access.actor) return access.response ?? json({ error: "Access denied" }, 403);
  const parsed = Post.safeParse(await readJsonBody(request, 16 * 1024));
  if (!parsed.success) return json({ error: "Invalid private chat request" }, 400);
  if (!await verifyCsrfToken(parsed.data.csrfToken)) return json({ error: "Invalid private chat token" }, 403);
  try {
    const result = await createPrivateInstructorChat(getDb(), { ...access.actor, ...parsed.data });
    return json(result.message, result.created ? 201 : 200);
  } catch (error) { return failure(error); }
}
