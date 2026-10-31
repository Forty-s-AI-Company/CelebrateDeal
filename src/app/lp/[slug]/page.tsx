import type { RegistrationAttributionQuery } from "@/lib/registration-attribution";
import { registrationDeadlineOutcome } from "@/components/registration-deadline-outcome";
import { hasRegistrationFeedbackQuery, registrationRetryBoundary } from "@/components/registration-retry-boundary";
import { pageDocumentRendersRegistrationForm } from "@/lib/funnel-registration-surface";
import { FunnelWebinarExperience } from "@/components/landing-pages/funnel-webinar-experience";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { funnelPublicRenderEvent, funnelViewportHint } from "@/lib/funnel-public-render-hints";
import { cache } from "react";
import { loadPublicLandingPage } from "@/lib/landing-page-service";
import { liveSessionsProp } from "@/lib/live-fixed-sessions";
import { confirmedWebinarSession } from "@/lib/live-session-result-page";
import { LandingPageRenderer } from "@/components/landing-pages/landing-page-renderer";
import { PublicFunnelDocument } from "@/components/landing-pages/public-funnel-document";
import { FunnelRegistrationLinkProvider } from "@/components/landing-pages/funnel-registration-links";
import { publicRegistrationLinks } from "@/lib/funnel-registration-action";
import type { PageDocument } from "@/lib/funnel-page-document";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";
import { getNextPublicFunnelStepPath, getPublicFunnelPage } from "@/lib/funnel-public-page";
import { FUNNEL_VISITOR_COOKIE, recordPublicFunnelVisit, resolveFunnelVisitorId, resolvePublicFunnelRuntime } from "@/lib/funnel-runtime";
import { getCsrfToken } from "@/lib/csrf";
export const dynamic = "force-dynamic";

// The consultation booking block (a client component, so it cannot carry
// segment config itself) calls a Server Action that sends booking emails
// with `after()` inside this page's limit
// (see IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS).
// Form submissions post to /api/form-submissions, which sets its own.
export const maxDuration = 60;

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
  // Built only after availability, deadline and rendered-step decisions, so the
  // single-use draft is read only when a registration form will show it.
  const buildRetryBoundary = (readDraft: boolean) => registrationRetryBoundary({ formId: isFunnelStepPages(page.content) && page.content.flow.goal === "webinar" ? page.webinar?.form.id : page.submissionForm?.id, sourcePath: `/lp/${page.slug}`, attributionQuery: query, retry: query.registrationRetry, submitted: query.submitted, readDraft });
  const consultation = page.consultationEvents?.length ? { csrfToken: await getCsrfToken(), events: page.consultationEvents } : undefined;
  if (isFunnelStepPages(page.content)) {
    const requestedStep = page.content.flow.steps.find((step) => !step.isSystem);
    if (!requestedStep) notFound();
    const visitorId = resolveFunnelVisitorId((await cookies()).get(FUNNEL_VISITOR_COOKIE)?.value);
    const runtime = await resolvePublicFunnelRuntime({ pageId: page.id, requestedStepId: requestedStep.id, visitorId });
    if (!runtime || runtime.decision.status === "unavailable") notFound();
    if (runtime.decision.status !== "render") return registrationDeadlineOutcome({ decision: runtime.decision, query, form: page.content.flow.goal === "webinar" ? page.webinar?.form : page.submissionForm, slug: page.slug, withRetry: await buildRetryBoundary(hasRegistrationFeedbackQuery(query)) });
    const decision = runtime.decision;
  const initialViewport = funnelViewportHint((await headers()).get("user-agent"));
  const event = funnelPublicRenderEvent(runtime.page.operations);
    await recordPublicFunnelVisit({ pageId: runtime.page.id, vendorId: runtime.page.vendorId, stepId: decision.renderedStepId, logicalStepId: decision.requestedStepId, visitorId, experiment: decision.experiment });
    const renderedStep = page.content.flow.steps.find((step) => step.id === decision.renderedStepId);
    if (page.content.flow.goal === "webinar") {
      const confirmedLiveSession = await confirmedWebinarSession(page.webinar);
      return (await buildRetryBoundary(renderedStep?.type === "webinar_registration_page"))(<FunnelRegistrationLinkProvider value={publicRegistrationLinks(page.context)}><FunnelWebinarExperience initialViewport={initialViewport} event={event} state={page.content} stepId={decision.renderedStepId} slug={page.slug} resource={page.webinar} funnelSource={{ landingPageId: page.id, stepId: decision.requestedStepId }} confirmedLiveSession={confirmedLiveSession} /></FunnelRegistrationLinkProvider>);
    }
    const document = getPublicFunnelPage(page.content, renderedStep?.path);
    if (!document) notFound();
    const withRetry = await buildRetryBoundary(Boolean(page.submissionForm) && pageDocumentRendersRegistrationForm(document));
    const logicalDocument = getPublicFunnelPage(page.content, requestedStep.path);
    const nextPath = logicalDocument ? getNextPublicFunnelStepPath(page.content, logicalDocument.id, { excludeStepIds: decision.progressionExcludedStepId ? [decision.progressionExcludedStepId] : [] }) : null;
    return withRetry(<PublicFunnelDocument document={document} initialViewport={initialViewport} event={event} registrationLinks={publicRegistrationLinks(page.context)} consultation={consultation} commerce={page.commerceByPageId?.[document.id]} submission={page.submissionForm ? { form: page.submissionForm, landingPageId: page.id, funnelStepId: decision.requestedStepId, ...(page.submissionLiveId ? { liveId: page.submissionLiveId } : {}), ...liveSessionsProp(page), ...(nextPath ? { redirectTo: `/lp/${encodeURIComponent(page.slug)}/${encodeURIComponent(nextPath)}` } : {}) } : undefined} />);
  }
  // Legacy landing content cannot be inspected for forms; keep reading as before.
  if (!isPageDocument(page.content)) return (await buildRetryBoundary(true))(<LandingPageRenderer content={page.content} context={page.context} />);
  const withRetry = await buildRetryBoundary(Boolean(page.submissionForm) && pageDocumentRendersRegistrationForm(page.content));
  const initialViewport = funnelViewportHint((await headers()).get("user-agent"));
  return withRetry(<PublicFunnelDocument document={page.content} initialViewport={initialViewport} event={funnelPublicRenderEvent(null)} registrationLinks={publicRegistrationLinks(page.context)} consultation={consultation} commerce={page.commerceByPageId?.[page.content.id]} submission={page.submissionForm ? { form: page.submissionForm, landingPageId: page.id, ...(page.submissionLiveId ? { liveId: page.submissionLiveId } : {}), ...liveSessionsProp(page) } : undefined} />);
}
