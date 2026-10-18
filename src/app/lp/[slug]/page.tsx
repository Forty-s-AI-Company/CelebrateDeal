import type { RegistrationAttributionQuery } from "@/lib/registration-attribution";
import { registrationDeadlineOutcome } from "@/components/registration-deadline-outcome";
import { registrationRetryBoundary } from "@/components/registration-retry-boundary";
import { FunnelWebinarExperience } from "@/components/landing-pages/funnel-webinar-experience";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";
import { loadPublicLandingPage } from "@/lib/landing-page-service";
import { LandingPageRenderer } from "@/components/landing-pages/landing-page-renderer";
import { PublicFunnelDocument } from "@/components/landing-pages/public-funnel-document";
import type { PageDocument } from "@/lib/funnel-page-document";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";
import { getNextPublicFunnelStepPath, getPublicFunnelPage } from "@/lib/funnel-public-page";
import { FUNNEL_VISITOR_COOKIE, recordPublicFunnelVisit, resolveFunnelVisitorId, resolvePublicFunnelRuntime } from "@/lib/funnel-runtime";
import { getCsrfToken } from "@/lib/csrf";
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
export default async function PublicLandingPage({ params, searchParams }: { searchParams?: Promise<RegistrationAttributionQuery & { registrationRetry?: string; submitted?: string }>; params: Promise<{ slug: string }> }) {
  const query = await searchParams ?? {};
  const page = await load((await params).slug);
  if (!page) notFound();
  const buildRetryBoundary = () => registrationRetryBoundary({ formId: isFunnelStepPages(page.content) && page.content.flow.goal === "webinar" ? page.webinar?.form.id : page.submissionForm?.id, sourcePath: `/lp/${page.slug}`, attributionQuery: query, retry: query.registrationRetry, submitted: query.submitted });
  const consultation = page.consultationEvents?.length ? { csrfToken: await getCsrfToken(), events: page.consultationEvents } : undefined;
  if (isFunnelStepPages(page.content)) {
    const requestedStep = page.content.flow.steps.find((step) => !step.isSystem);
    if (!requestedStep) notFound();
    const visitorId = resolveFunnelVisitorId((await cookies()).get(FUNNEL_VISITOR_COOKIE)?.value);
    const runtime = await resolvePublicFunnelRuntime({ pageId: page.id, requestedStepId: requestedStep.id, visitorId });
    if (!runtime || runtime.decision.status === "unavailable") notFound();
    const withRetry = await buildRetryBoundary();
    if (runtime.decision.status !== "render") return registrationDeadlineOutcome({ decision: runtime.decision, query, form: page.content.flow.goal === "webinar" ? page.webinar?.form : page.submissionForm, slug: page.slug, withRetry });
    const decision = runtime.decision;
    await recordPublicFunnelVisit({ pageId: runtime.page.id, vendorId: runtime.page.vendorId, stepId: decision.renderedStepId, logicalStepId: decision.requestedStepId, visitorId, experiment: decision.experiment });
    if (page.content.flow.goal === "webinar") return withRetry(<FunnelWebinarExperience state={page.content} stepId={decision.renderedStepId} slug={page.slug} resource={page.webinar} funnelSource={{ landingPageId: page.id, stepId: decision.requestedStepId }} />);
    const document = getPublicFunnelPage(page.content, page.content.flow.steps.find((step) => step.id === decision.renderedStepId)?.path);
    if (!document) notFound();
    const logicalDocument = getPublicFunnelPage(page.content, requestedStep.path);
    const nextPath = logicalDocument ? getNextPublicFunnelStepPath(page.content, logicalDocument.id, { excludeStepIds: decision.progressionExcludedStepId ? [decision.progressionExcludedStepId] : [] }) : null;
    return withRetry(<PublicFunnelDocument document={document} consultation={consultation} commerce={page.commerceByPageId?.[document.id]} submission={page.submissionForm ? { form: page.submissionForm, landingPageId: page.id, funnelStepId: decision.requestedStepId, ...(page.submissionLiveId ? { liveId: page.submissionLiveId } : {}), ...(nextPath ? { redirectTo: `/lp/${encodeURIComponent(page.slug)}/${encodeURIComponent(nextPath)}` } : {}) } : undefined} />);
  }
  const withRetry = await buildRetryBoundary();
  if (!isPageDocument(page.content)) return withRetry(<LandingPageRenderer content={page.content} context={page.context} />);
  return withRetry(<PublicFunnelDocument document={page.content} consultation={consultation} commerce={page.commerceByPageId?.[page.content.id]} submission={page.submissionForm ? { form: page.submissionForm, landingPageId: page.id, ...(page.submissionLiveId ? { liveId: page.submissionLiveId } : {}) } : undefined} />);
}
