import { getCurrentAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { checkRateLimit } from "@/lib/rate-limit";
import { CardError } from "@/lib/interaction-card";
import { ScriptedCommandSchema } from "@/lib/scripted-roles-contract";
import { commandWarmup, instructorWarmup } from "@/lib/scripted-roles";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function handle(request: Request, writing: boolean) {
  const rejected = requireSameOriginRequest(request, { requireClientHeader: true }) ?? await checkRateLimit(request, "scripted-roles", 90, 60_000);
  if (rejected) { rejected.headers.set("Cache-Control", "private, no-store"); return rejected; }
  try {
    const auth = await getCurrentAuth();
    if (!auth?.vendor || !auth.member || auth.member.status !== "active" || !["owner", "admin"].includes(auth.member.role)) return json({ error: "無權操作暖場腳本" }, 403);
    const params = new URL(request.url).searchParams;
    if (writing) {
      if (params.size) return json({ error: "不合法參數" }, 400);
      const command = ScriptedCommandSchema.safeParse(await readJsonBody(request, 2048));
      if (!command.success) return json({ error: "不合法指令" }, 400);
      await commandWarmup(getDb(), auth.vendor.id, command.data);
      return json({ ok: true });
    }
    const liveId = params.get("liveId");
    if (params.size !== 1 || !liveId || liveId.length > 128) return json({ error: "不合法活動" }, 400);
    return json(await instructorWarmup(getDb(), { vendorId: auth.vendor.id, liveId }));
  } catch (error) {
    const status = error instanceof CardError ? error.status : 500;
    return json({ error: status === 429 ? "每五秒最多發送一則，請稍候。" : "請確認腳本、角色、播放時間與全場彈幕設定後重試。" }, status);
  }
}
export async function GET(request: Request) { return handle(request, false); }
export async function POST(request: Request) { return handle(request, true); }
