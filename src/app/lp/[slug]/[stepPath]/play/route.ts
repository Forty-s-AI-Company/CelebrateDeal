import { loadPublicLandingPage } from "@/lib/landing-page-service";
import { parseFunnelStepPages } from "@/lib/funnel-step-pages";
import { getFunnelWebinarState } from "@/lib/funnel-webinar";
import { funnelVisitorIdFromRequest, isFunnelDeadlineExpired, resolveFunnelVisitorId, resolvePublicFunnelRuntime } from "@/lib/funnel-runtime";
import { parseFunnelOperations } from "@/lib/funnel-operations";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };

function unavailable(status: number, message: string) {
  return Response.json({ message }, { status, headers: privateHeaders });
}

/** Server time gates this entry; the destination retains its own admission checks. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; stepPath: string }> }) {
  const { slug, stepPath } = await params;
  const page = await loadPublicLandingPage(slug);
  const state = page ? parseFunnelStepPages(page.content) : null;
  const step = state?.flow.steps.find((candidate) => candidate.path === stepPath);
  if (!page || state?.flow.goal !== "webinar" || step?.type !== "webinar_broadcast_page") {
    return unavailable(404, "找不到可播放的活動頁，請返回活動報名頁確認網址。");
  }
  const runtime = await resolvePublicFunnelRuntime({
    pageId: page.id,
    requestedStepId: step.id,
    visitorId: resolveFunnelVisitorId(funnelVisitorIdFromRequest(request)),
  });
  if (!runtime || runtime.decision.status !== "render" || isFunnelDeadlineExpired(parseFunnelOperations(runtime.page.operations))) {
    return unavailable(410, "此活動已截止，無法再開啟播放。");
  }
  const resource = page.webinar;
  const gate = getFunnelWebinarState(state.flow.webinar, { liveId: resource?.live.id, formId: resource?.form.id }, Date.now());
  if (!resource || gate.status === "missing") return unavailable(503, "活動設定或播放資源尚未就緒，請聯絡活動主辦方確認。");
  if (gate.status === "waiting") return unavailable(409, "活動尚未開始，請於開始時間回到活動頁再試。");
  if (gate.status === "expired") return unavailable(410, "活動與重播已結束，請聯絡主辦方確認後續場次。");
  // A relative, encoded application route cannot become an external redirect.
  return new Response(null, { status: 303, headers: { ...privateHeaders, Location: `/live/${encodeURIComponent(resource.live.slug)}` } });
}
