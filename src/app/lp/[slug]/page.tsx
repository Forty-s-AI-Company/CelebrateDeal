import { FunnelWebinarExperience } from "@/components/landing-pages/funnel-webinar-experience";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";
import { loadPublicLandingPage } from "@/lib/landing-page-service";
import { LandingPageRenderer } from "@/components/landing-pages/landing-page-renderer";
import { PublicFunnelDocument } from "@/components/landing-pages/public-funnel-document";
import type { PageDocument } from "@/lib/funnel-page-document";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";
import { getNextPublicFunnelStepPath, getPublicFunnelPage } from "@/lib/funnel-public-page";
import { FUNNEL_VISITOR_COOKIE, recordPublicFunnelVisit, resolveFunnelVisitorId, resolvePublicFunnelRuntime } from "@/lib/funnel-runtime";
export const dynamic = "force-dynamic";
const load = cache(loadPublicLandingPage);
function isPageDocument(content: NonNullable<Awaited<ReturnType<typeof loadPublicLandingPage>>>["content"]): content is PageDocument { return "root" in content && "settings" in content; }
function isFunnelStepPages(content: NonNullable<Awaited<ReturnType<typeof loadPublicLandingPage>>>["content"]): content is FunnelStepPages { return "pages" in content && "flow" in content; }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await load((await params).slug);
  if (!page) return { title: "頁面不存在", robots: { index: false, follow: false } };
  let seo: { title?: string; description?: string } | undefined;
  let socialImage: string | undefined;
  const funnelDocument = isFunnelStepPages(page.content) ? getPublicFunnelPage(page.content) : isPageDocument(page.content) ? page.content : null;
  if (funnelDocument) {
    seo = funnelDocument.settings.seo;
    socialImage = funnelDocument.settings.seo.socialImage;
  } else if ("data" in page.content) {
    seo = page.content.data.root.props;
    socialImage = page.content.data.root.props?.shareImage;
  }
  const title = seo?.title || "Webinar 活動";
  const settings = funnelDocument?.settings.seo;
  return { title, description: seo?.description, keywords: settings?.keywords, authors: settings?.author ? [{ name: settings.author }] : undefined, robots: settings?.hideFromSearch ? { index: false, follow: false } : undefined, openGraph: { title, description: seo?.description, ...(socialImage ? { images: [socialImage] } : {}) } };
}
export default async function PublicLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await load((await params).slug);
  if (!page) notFound();
  if (isFunnelStepPages(page.content)) {
    const requestedStep = page.content.flow.steps.find((step) => !step.isSystem);
    if (!requestedStep) notFound();
    const visitorId = resolveFunnelVisitorId((await cookies()).get(FUNNEL_VISITOR_COOKIE)?.value);
    const runtime = await resolvePublicFunnelRuntime({ pageId: page.id, requestedStepId: requestedStep.id, visitorId });
    if (!runtime || runtime.decision.status === "unavailable") notFound();
    if (runtime.decision.status === "closed") return <PublicFunnelClosed />;
    if (runtime.decision.status === "redirect") redirect(`/lp/${encodeURIComponent(page.slug)}/${encodeURIComponent(runtime.decision.path)}`);
    const decision = runtime.decision;
    await recordPublicFunnelVisit({ pageId: runtime.page.id, vendorId: runtime.page.vendorId, stepId: decision.renderedStepId, logicalStepId: decision.requestedStepId, visitorId, experiment: decision.experiment });
    if (page.content.flow.goal === "webinar") return <FunnelWebinarExperience state={page.content} stepId={decision.renderedStepId} slug={page.slug} resource={page.webinar} funnelSource={{ landingPageId: page.id, stepId: decision.requestedStepId }} />;
    const document = getPublicFunnelPage(page.content, page.content.flow.steps.find((step) => step.id === decision.renderedStepId)?.path);
    if (!document) notFound();
    const logicalDocument = getPublicFunnelPage(page.content, requestedStep.path);
    const nextPath = logicalDocument ? getNextPublicFunnelStepPath(page.content, logicalDocument.id, { excludeStepIds: decision.progressionExcludedStepId ? [decision.progressionExcludedStepId] : [] }) : null;
    return <PublicFunnelDocument document={document} commerce={page.commerceByPageId?.[document.id]} submission={page.submissionForm ? { form: page.submissionForm, landingPageId: page.id, funnelStepId: decision.requestedStepId, ...(page.submissionLiveId ? { liveId: page.submissionLiveId } : {}), ...(nextPath ? { redirectTo: `/lp/${encodeURIComponent(page.slug)}/${encodeURIComponent(nextPath)}` } : {}) } : undefined} />;
  }
  if (!isPageDocument(page.content)) return <LandingPageRenderer content={page.content} context={page.context} />;
  return <PublicFunnelDocument document={page.content} commerce={page.commerceByPageId?.[page.content.id]} submission={page.submissionForm ? { form: page.submissionForm, landingPageId: page.id, ...(page.submissionLiveId ? { liveId: page.submissionLiveId } : {}) } : undefined} />;
}

function PublicFunnelClosed() {
  return <main className="mx-auto max-w-2xl px-6 py-24 text-center"><h1 className="text-2xl font-black text-slate-950">此活動已截止</h1><p className="mt-3 text-slate-600">目前不再接受新的瀏覽或送出資料。</p></main>;
}
