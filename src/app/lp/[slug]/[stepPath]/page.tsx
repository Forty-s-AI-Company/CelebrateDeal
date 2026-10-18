import type { RegistrationAttributionQuery } from "@/lib/registration-attribution";
import { registrationDeadlineOutcome } from "@/components/registration-deadline-outcome";
import { registrationRetryBoundary } from "@/components/registration-retry-boundary";
import { FunnelWebinarExperience } from "@/components/landing-pages/funnel-webinar-experience";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";
import { PublicFunnelDocument } from "@/components/landing-pages/public-funnel-document";
import { getCsrfToken } from "@/lib/csrf";
import { getNextPublicFunnelStepPath, getPublicFunnelPage } from "@/lib/funnel-public-page";
import { FUNNEL_VISITOR_COOKIE, recordPublicFunnelVisit, resolveFunnelVisitorId, resolvePublicFunnelRuntime } from "@/lib/funnel-runtime";
import { loadPublicLandingPage } from "@/lib/landing-page-service";
import { parseFunnelStepPages } from "@/lib/funnel-step-pages";

export const dynamic = "force-dynamic";
const load = cache(loadPublicLandingPage);

async function resolve(slug: string, stepPath: string) {
  const page = await load(slug);
  const steps = page ? parseFunnelStepPages(page.content) : null;
  const document = steps ? getPublicFunnelPage(steps, stepPath) : null;
  return { page, document, steps };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; stepPath: string }> }): Promise<Metadata> {
  const { slug, stepPath } = await params;
  const { document } = await resolve(slug, stepPath);
  if (!document) return { title: "頁面不存在", robots: { index: false, follow: false } };
  const seo = document.settings.seo;
  const title = seo.title || document.name;
  return { title, description: seo.description, keywords: seo.keywords, authors: seo.author ? [{ name: seo.author }] : undefined, robots: seo.hideFromSearch ? { index: false, follow: false } : undefined, openGraph: { title, description: seo.description, ...(seo.socialImage ? { images: [seo.socialImage] } : {}) } };
}

export default async function PublicFunnelStepPage({ params, searchParams }: { searchParams?: Promise<RegistrationAttributionQuery & { registrationRetry?: string; submitted?: string }>; params: Promise<{ slug: string; stepPath: string }> }) {
  const { slug, stepPath } = await params;
  const { page, document, steps } = await resolve(slug, stepPath);
  if (!document) notFound();
  const step = steps?.flow.steps.find((candidate) => candidate.path === stepPath);
  if (!page || !steps || !step || step.isSystem) notFound();
  const query = await searchParams ?? {};
  const visitorId = resolveFunnelVisitorId((await cookies()).get(FUNNEL_VISITOR_COOKIE)?.value);
  const runtime = await resolvePublicFunnelRuntime({ pageId: page.id, requestedStepId: step.id, visitorId });
  if (!runtime || runtime.decision.status === "unavailable") notFound();
  const withRetry = await registrationRetryBoundary({ formId: steps.flow.goal === "webinar" ? page.webinar?.form.id : page.submissionForm?.id, sourcePath: `/lp/${page.slug}/${step.path}`, attributionQuery: query, retry: query.registrationRetry, submitted: query.submitted });
  if (runtime.decision.status !== "render") return registrationDeadlineOutcome({ decision: runtime.decision, query, form: steps.flow.goal === "webinar" ? page.webinar?.form : page.submissionForm, slug: page.slug, withRetry });
  const decision = runtime.decision;
  await recordPublicFunnelVisit({ pageId: runtime.page.id, vendorId: runtime.page.vendorId, stepId: decision.renderedStepId, logicalStepId: decision.requestedStepId, visitorId, experiment: decision.experiment });
  if (steps.flow.goal === "webinar") return withRetry(<FunnelWebinarExperience state={steps} stepId={decision.renderedStepId} slug={page.slug} resource={page.webinar} funnelSource={{ landingPageId: page.id, stepId: decision.requestedStepId }} />);
  const rendered = getPublicFunnelPage(steps, steps.flow.steps.find((candidate) => candidate.id === decision.renderedStepId)?.path);
  if (!rendered) notFound();
  const logicalDocument = getPublicFunnelPage(steps, step.path);
  const nextPath = logicalDocument ? getNextPublicFunnelStepPath(steps, logicalDocument.id, { excludeStepIds: decision.progressionExcludedStepId ? [decision.progressionExcludedStepId] : [] }) : null;
  const consultation = page.consultationEvents?.length ? { csrfToken: await getCsrfToken(), events: page.consultationEvents } : undefined;
  return withRetry(<PublicFunnelDocument document={rendered} consultation={consultation} commerce={page.commerceByPageId?.[rendered.id]} submission={page.submissionForm ? { form: page.submissionForm, landingPageId: page.id, funnelStepId: decision.requestedStepId, ...(page.submissionLiveId ? { liveId: page.submissionLiveId } : {}), ...(nextPath ? { redirectTo: `/lp/${encodeURIComponent(page.slug)}/${encodeURIComponent(nextPath)}` } : {}) } : undefined} />);
}
