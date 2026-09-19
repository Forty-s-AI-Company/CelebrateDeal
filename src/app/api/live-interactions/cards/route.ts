import { getCurrentAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasActiveLiveViewerSession, hashLiveViewerToken, liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { CardAnswerSchema, CardCommandSchema, CardScopeSchema } from "@/lib/interaction-card-contract";
import { answerCard, CardError, commandCard, instructorCards, viewerCardSnapshot, cardTimelineCapability } from "@/lib/interaction-card";

function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
async function handle(request: Request, writing: boolean) {
  const origin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (origin) { origin.headers.set("Cache-Control", "private, no-store"); return origin; }
  const limited = await checkRateLimit(request, "interaction-cards", 120, 60_000);
  if (limited) { limited.headers.set("Cache-Control", "private, no-store"); return limited; }
  try {
    const params = new URL(request.url).searchParams;
    if (request.url.length > 2048 || [...params.keys()].some(k => params.getAll(k).length !== 1)) return json({ error: "Invalid request" }, 400);
    if (params.get("mode") === "instructor") {
      const auth = await getCurrentAuth();
      if (!auth?.vendor || !auth.member || auth.member.status !== "active" || !["owner", "admin"].includes(auth.member.role)) return json({ error: "Forbidden" }, 403);
      if (writing) {
        if ([...params.keys()].some(k => k !== "mode")) return json({ error: "Invalid request" }, 400);
        const parsed = CardCommandSchema.safeParse(await readJsonBody(request, 8192));
        if (!parsed.success) return json({ error: "Invalid card" }, 400);
        return json({ card: await commandCard(getDb(), auth.vendor.id, parsed.data) });
      }
      if ([...params.keys()].some(k => !["mode", "liveId", "answerRunId"].includes(k))) return json({ error: "Invalid request" }, 400);
      const parsed = CardScopeSchema.safeParse({ vendorId: auth.vendor.id, liveId: params.get("liveId") });
      if (!parsed.success) return json({ error: "Invalid scope" }, 400);
      return json({ cards: await instructorCards(getDb(), parsed.data, params.get("answerRunId") ?? undefined), timelineCapability: await cardTimelineCapability(getDb(), parsed.data) });
    }
    if (writing && params.size !== 0) return json({ error: "Invalid request" }, 400);
    const parsed = writing ? CardAnswerSchema.safeParse(await readJsonBody(request, 8192)) : CardScopeSchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return json({ error: "Invalid answer" }, 400);
    const scope = { vendorId: parsed.data.vendorId, liveId: parsed.data.liveId };
    const token = liveViewerTokenFromRequest(request);
    if (!token || !await hasActiveLiveViewerSession(getDb(), { ...scope, token })) return json({ error: "Viewer admission required" }, 401);
    const participant = hashLiveViewerToken(token);
    if (writing) {
      const answer = CardAnswerSchema.parse(parsed.data);
      return json({ card: await answerCard(getDb(), scope, participant, answer.runId, answer.value, answer.positionSeconds) });
    }
    return json(await viewerCardSnapshot(getDb(), scope, participant));
  } catch (error) { return json({ error: "卡片操作失敗，請重新整理後再試。" }, error instanceof CardError ? error.status : 500); }
}
export async function GET(request: Request) { return handle(request, false); }
export async function POST(request: Request) { return handle(request, true); }
