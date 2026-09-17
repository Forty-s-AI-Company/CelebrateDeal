import { FunnelWebinarExperience } from "@/components/landing-pages/funnel-webinar-experience";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicFunnelDocument } from "@/components/landing-pages/public-funnel-document";
import { getNextPublicFunnelStepPath, getPublicFunnelPage } from "@/lib/funnel-public-page";
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

export default async function PublicFunnelStepPage({ params }: { params: Promise<{ slug: string; stepPath: string }> }) {
  const { slug, stepPath } = await params;
  const { page, document, steps } = await resolve(slug, stepPath);
  if (!document) notFound();
  const step = steps?.flow.steps.find((candidate) => candidate.path === stepPath);
  if (page && steps?.flow.goal === "webinar" && step) return <FunnelWebinarExperience state={steps} stepId={step.id} slug={page.slug} resource={page.webinar} />;
  const nextPath = steps ? getNextPublicFunnelStepPath(steps, document.id) : null;
  return <PublicFunnelDocument document={document} commerce={page?.commerceByPageId?.[document.id]} submission={page?.submissionForm ? { form: page.submissionForm, landingPageId: page.id, ...(page.submissionLiveId ? { liveId: page.submissionLiveId } : {}), ...(nextPath ? { redirectTo: `/lp/${encodeURIComponent(page.slug)}/${encodeURIComponent(nextPath)}` } : {}) } : undefined} />;
}
