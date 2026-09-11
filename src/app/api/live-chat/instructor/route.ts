import { getCurrentAuth } from "@/lib/auth";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { createInstructorChatMessage, InstructorChatPostSchema, InstructorChatQuerySchema,
  listInstructorChatMessages, LiveChatError } from "@/lib/live-chat";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function handle(request: Request, writing: boolean) {
  const originError = requireSameOriginRequest(request, { requireClientHeader: true });
  if (originError) {
    originError.headers.set("Cache-Control", "private, no-store");
    return originError;
  }
  // Match requireVendorManagerContext; never accept a tenant or role from the request.
  const auth = await getCurrentAuth();
  if (!auth?.vendor || !auth.member || auth.member.status !== "active"
    || !["owner", "admin"].includes(auth.member.role)) return json({ error: "Forbidden" }, 403);
  const limited = await checkRateLimit(request, `private-chat:${auth.vendor.id}:${auth.user.id}`, 60, 60_000);
  if (limited) {
    limited.headers.set("Cache-Control", "private, no-store");
    return limited;
  }
  try {
    if (writing) {
      const parsed = InstructorChatPostSchema.safeParse(await readJsonBody(request, 16 * 1024));
      if (!parsed.success) return json({ error: "Invalid chat request" }, 400);
      const result = await createInstructorChatMessage(getDb(), { ...parsed.data, vendorId: auth.vendor.id });
      return json(result.message, result.created ? 201 : 200);
    }
    if (request.url.length > 2048) return json({ error: "Invalid chat request" }, 400);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return json({ error: "Invalid chat request" }, 400);
    const parsed = InstructorChatQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return json({ error: "Invalid chat request" }, 400);
    return json(await listInstructorChatMessages(getDb(), { ...parsed.data, vendorId: auth.vendor.id }));
  } catch (error) {
    const status = error instanceof LiveChatError
      ? error.code === "invalid_cursor" ? 400
        : ["idempotency_conflict", "transaction_conflict"].includes(error.code) ? 409 : 403
      : 500;
    return json({ error: "Unable to use private chat" }, status);
  }
}

export async function GET(request: Request) { return handle(request, false); }
export async function POST(request: Request) { return handle(request, true); }
