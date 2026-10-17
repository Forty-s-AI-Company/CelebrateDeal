import { z } from "zod";
import { getCurrentAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasActiveLiveViewerSession, liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { CardScopeSchema } from "@/lib/interaction-card-contract";
import { CardError } from "@/lib/interaction-card";
import { readDanmaku, setDanmaku } from "@/lib/live-danmaku";

const querySchema = CardScopeSchema.extend({ cursor: z.string().datetime().optional(), epoch: z.string().max(64).optional(), positionSeconds: z.coerce.number().finite().min(0).max(86400).optional() });
const commandSchema = z.object({ liveId: z.string().min(1).max(128), enabled: z.boolean() }).strict();
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
async function handle(request: Request, writing: boolean) {
  const rejected = requireSameOriginRequest(request, { requireClientHeader: true }) ?? await checkRateLimit(request, "live-danmaku", 120, 60_000);
  if (rejected) { rejected.headers.set("Cache-Control", "private, no-store"); return rejected; }
  try {
    const params = new URL(request.url).searchParams;
    if (request.url.length > 2048 || [...params.keys()].some(k => params.getAll(k).length !== 1)) return json({ error: "Invalid request" }, 400);
    if (params.get("mode") === "instructor") {
      const auth = await getCurrentAuth();
      if (!auth?.vendor || !auth.member || auth.member.status !== "active" || !["owner", "admin"].includes(auth.member.role)) return json({ error: "Forbidden" }, 403);
      if ([...params.keys()].some(k => !["mode", ...(writing ? [] : ["liveId"])].includes(k))) return json({ error: "Invalid request" }, 400);
      if (writing) {
        const parsed = commandSchema.safeParse(await readJsonBody(request, 1024));
        if (!parsed.success) return json({ error: "Invalid request" }, 400);
        return json({ state: await setDanmaku(getDb(), { vendorId: auth.vendor.id, liveId: parsed.data.liveId }, parsed.data.enabled) });
      }
      const scope = CardScopeSchema.safeParse({ vendorId: auth.vendor.id, liveId: params.get("liveId") });
      if (!scope.success) return json({ error: "Invalid request" }, 400);
      return json(await readDanmaku(getDb(), scope.data));
    }
    if (writing) return json({ error: "Forbidden" }, 403);
    const parsed = querySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const { vendorId, liveId, cursor, epoch, positionSeconds } = parsed.data;
    const token = liveViewerTokenFromRequest(request);
    if (!token || !await hasActiveLiveViewerSession(getDb(), { vendorId, liveId, token })) return json({ error: "Viewer admission required" }, 401);
    return json(await readDanmaku(getDb(), { vendorId, liveId }, cursor, epoch, positionSeconds));
  } catch (error) { return json({ error: "彈幕暫時無法同步，請稍後再試。" }, error instanceof CardError ? error.status : 500); }
}
export async function GET(request: Request) { return handle(request, false); }
export async function POST(request: Request) { return handle(request, true); }
