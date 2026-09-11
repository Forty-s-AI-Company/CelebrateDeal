import { z } from "zod";
import { getCurrentAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasActiveLiveViewerSession, hashLiveViewerToken, liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { getRuntimeLivePublishReadiness } from "@/lib/live-runtime-readiness";
import { mediaOrigin, mediaPath, startMediaSession, stopMediaSession } from "@/lib/live-media-provider";
import { cleanupMediaSessions } from "@/lib/live-media-cleanup";

const id = z.string().min(1).max(128);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("offer"), liveId: id, vendorId: id.optional(), direction: z.enum(["publish", "read", "monitor"]), sdp: z.string().startsWith("v=0").max(60_000) }).strict(),
  z.object({ action: z.enum(["heartbeat", "stop"]), liveId: id, vendorId: id.optional(), direction: z.enum(["publish", "read", "monitor"]), sessionId: id }).strict(),
]);
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

async function authorize(request: Request, input: z.infer<typeof schema>, db: ReturnType<typeof getDb>) {
  if (input.direction === "read") {
    const token = liveViewerTokenFromRequest(request);
    if (!input.vendorId || !token || !await hasActiveLiveViewerSession(db, { vendorId: input.vendorId, liveId: input.liveId, token })) return json({ error: "請重新取得觀眾入場資格。" }, 401);
    return { vendorId: input.vendorId, principal: `viewer:${hashLiveViewerToken(token)}` };
  }
  const auth = await getCurrentAuth();
  if (!auth?.vendor || auth.member?.status !== "active" || !["owner", "admin"].includes(auth.member.role)) return json({ error: "沒有講師管理權限。" }, 403);
  if (input.vendorId && input.vendorId !== auth.vendor.id) return json({ error: "活動權限不符。" }, 403);
  return { vendorId: auth.vendor.id, principal: `instructor:${auth.member.id}` };
}

export async function POST(request: Request) {
  const rejected = requireSameOriginRequest(request, { requireClientHeader: true });
  if (rejected) return rejected;
  const limited = await checkRateLimit(request, "live-media", 90, 60_000);
  if (limited) return limited;
  const parsed = schema.safeParse(await readJsonBody(request, 64_000));
  if (!parsed.success) return json({ error: "媒體請求不正確。" }, 400);
  const input = parsed.data;
  const origin = mediaOrigin();
  if (!origin) return json({ error: "直播媒體服務尚未設定。" }, 503);
  try {
    const db = getDb();
    const identity = await authorize(request, input, db);
    if (identity instanceof Response) return identity;
    const { vendorId, principal } = identity;
    const scope = { vendorId, liveId: input.liveId, principal, direction: input.direction };
    // Stop remains possible after an event ends or its source is replaced.
    if (input.action === "stop") {
      const session = await db.liveMediaSession.findFirst({ where: { ...scope, id: input.sessionId } });
      if (!session) return json({ ok: true });
      await db.liveMediaSession.updateMany({ where: { ...scope, id: session.id }, data: { closing: true } });
      await stopMediaSession(origin, session.resourcePath);
      await db.liveMediaSession.deleteMany({ where: { ...scope, id: session.id } });
      return json({ ok: true });
    }
    const live = await db.live.findFirst({ where: { id: input.liveId, vendorId }, include: { video: true, form: true, messageTemplate: true, interactionScript: true, products: { include: { product: true } } } });
    if (!live || live.video?.vendorId !== vendorId || live.video.sourceType !== "browser_live" || live.streamMode !== "live" || !["scheduled", "live"].includes(live.status)) return json({ error: "此活動尚未發布為瀏覽器直播，或已結束。" }, 409);
    if (!getRuntimeLivePublishReadiness(live).ready) return json({ error: "請先完成活動的發布檢查。" }, 409);
    if (input.direction === "read" && live.status !== "live") return json({ error: "講師尚未開播。" }, 409);
    if (input.action === "heartbeat") {
      const changed = await db.liveMediaSession.updateMany({ where: { ...scope, id: input.sessionId, closing: false, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date(Date.now() + 60_000) } });
      if (changed.count !== 1) return json({ error: "媒體連線已到期，請重新連線。" }, 410);
      // The publisher sends its first heartbeat only after ICE is connected.
      if (input.direction === "publish" && live.status === "scheduled") await db.live.updateMany({ where: { id: live.id, vendorId, status: "scheduled", videoId: live.videoId }, data: { status: "live", startedAt: new Date(), endedAt: null, replayEnabled: false } });
      return json({ ok: true });
    }
    // Bounded cleanup; upstream session paths never leave this server.
    if (input.action !== "offer") return json({ error: "Invalid action" }, 400);
    await cleanupMediaSessions(db, origin, { vendorId, liveId: live.id });
    if (await db.liveMediaSession.findFirst({ where: scope })) return json({ error: "此身分已有媒體連線，請先停止或等待舊連線到期。" }, 409);
    const result = await startMediaSession(origin, mediaPath(vendorId, live.id), input.direction === "publish" ? "publish" : "read", input.sdp);
    try {
      const session = await db.liveMediaSession.create({ data: { ...scope, resourcePath: result.resourcePath, expiresAt: new Date(Date.now() + 60_000) } });
      return json({ answer: result.answer, sessionId: session.id });
    } catch {
      await stopMediaSession(origin, result.resourcePath).catch(() => undefined);
      return json({ error: "無法保存媒體連線。" }, 503);
    }
  } catch { return json({ error: "影音連線失敗；請確認媒體服務及網路後重試。" }, 503); }
}
