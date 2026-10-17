import { loadPublicLandingPage } from "@/lib/landing-page-service";
import { resolvePublicFunnelRuntime } from "@/lib/funnel-runtime";
import { getPublicFunnelPage } from "@/lib/funnel-public-page";

/** 串流前純讀檢查；不發事件、不公開拒絕原因、不快取可用性。 */
export async function publicLandingPageStatus(pathname: string, visitorId: string): Promise<200 | 404> {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "lp" || segments.length < 2 || segments.length > 3) return 404;
  let slug: string;
  let stepPath: string | undefined;
  try {
    slug = decodeURIComponent(segments[1]);
    stepPath = segments[2] ? decodeURIComponent(segments[2]) : undefined;
  } catch { return 404; }
  // 執行完整既有公開判斷，只省略與 HTTP 狀態無關的展示資料。
  const page = await loadPublicLandingPage(slug, undefined, false);
  if (!page) return 404;
  if (!("pages" in page.content)) return stepPath ? 404 : 200;
  const steps = page.content;
  const requested = stepPath
    ? steps.flow.steps.find((step) => step.path === stepPath && !step.isSystem)
    : steps.flow.steps.find((step) => !step.isSystem);
  if (!requested || !getPublicFunnelPage(steps, requested.path)) return 404;
  const runtime = await resolvePublicFunnelRuntime({ pageId: page.id, requestedStepId: requested.id, visitorId });
  if (!runtime || runtime.decision.status === "unavailable") return 404;
  if (runtime.decision.status !== "render") return 200; // 截止與合法轉址仍交公開 route 呈現。
  const renderedStepId = runtime.decision.renderedStepId;
  const rendered = steps.flow.steps.find((step) => step.id === renderedStepId);
  return rendered && getPublicFunnelPage(steps, rendered.path) ? 200 : 404;
}
