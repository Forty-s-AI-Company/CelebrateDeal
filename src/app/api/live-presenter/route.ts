import { getCurrentAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { checkRateLimit } from "@/lib/rate-limit";
import { DEFAULT_PRESENTER_LAYOUT, PresenterLayoutSchema, liveOrientation } from "@/lib/presenter-layout";
import { Prisma } from "@prisma/client";
import { mediaOrigin } from "@/lib/live-media-provider";
import { z } from "zod";

const command = z.object({ liveId: z.string().min(1).max(128), layout: PresenterLayoutSchema, enableBroadcast: z.boolean().optional() }).strict();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
async function handle(request: Request, writing: boolean) {
  const rejected = requireSameOriginRequest(request, { requireClientHeader: true });
  if (rejected) return rejected;
  const limited = await checkRateLimit(request, "live-presenter", 60, 60_000);
  if (limited) return limited;
  const auth = await getCurrentAuth();
  if (!auth?.vendor || auth.member?.status !== "active" || !["owner", "admin"].includes(auth.member.role)) return json({ error: "沒有講師管理權限。" }, 403);
  const data = writing ? command.safeParse(await readJsonBody(request, 4096)) : null;
  if (writing && !data?.success) return json({ error: "排版設定不正確。" }, 400);
  const liveId = data?.success ? data.data.liveId : new URL(request.url).searchParams.get("liveId");
  if (!liveId || liveId.length > 128) return json({ error: "活動不正確。" }, 400);
  try {
    const db = getDb();
    const live = await db.live.findFirst({ where: { id: liveId, vendorId: auth.vendor.id }, select: { id: true, videoId: true, title: true, slug: true, streamMode: true, status: true, presenterLayout: true, video: { select: { sourceType: true } } } });
    if (!live) return json({ error: "找不到活動。" }, 404);
    if (data?.success) {
      const { layout, enableBroadcast } = data.data;
      if (liveOrientation(layout) !== liveOrientation(live.presenterLayout)) return json({ error: "方向已變更，請重新載入講師頁。方向請在活動編輯中設定。" }, 409);
      if (enableBroadcast && !mediaOrigin()) return json({ error: "媒體伺服器尚未設定，無法啟用瀏覽器直播。" }, 503);
      if (enableBroadcast && ["live", "ended"].includes(live.status)) return json({ error: "請在活動開始前設定直播來源。" }, 409);
      await db.$transaction(async tx => {
        // Never overwrite or delete the original VOD/Cloudflare asset.
        const video = enableBroadcast && live.video?.sourceType !== "browser_live" ? await tx.video.create({ data: { vendorId: auth.vendor!.id, title: `${live.title}：瀏覽器直播`, sourceType: "browser_live", videoUrl: "https://media.invalid/browser-live", status: "ready" } }) : null;
        // Compare the source/status read above so another tab cannot switch a now-live event.
        await tx.live.update({ where: { vendorId_id: { vendorId: auth.vendor!.id, id: live.id }, status: live.status, presenterLayout: { equals: live.presenterLayout ?? Prisma.DbNull }, ...(enableBroadcast ? { videoId: live.videoId } : {}) }, data: { presenterLayout: layout, ...(enableBroadcast ? { streamMode: "live", replayEnabled: false, isEvergreen: false, ...(video ? { videoId: video.id } : {}) } : {}) } });
      });
      return json({ layout });
    }
    return json({ layout: PresenterLayoutSchema.safeParse(live.presenterLayout).data ?? DEFAULT_PRESENTER_LAYOUT, enabled: live.video?.sourceType === "browser_live", configured: Boolean(mediaOrigin()), liveStatus: live.status, streamMode: live.streamMode, viewerUrl: `/live/${encodeURIComponent(live.slug)}` });
  } catch { return json({ error: "排版設定無法讀取或保存，請稍後再試。" }, 500); }
}
export async function GET(request: Request) { return handle(request, false); }
export async function POST(request: Request) { return handle(request, true); }
