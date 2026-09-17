import { FunnelWebinarExperience } from "@/components/landing-pages/funnel-webinar-experience";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { loadPublicLandingPage } from "@/lib/landing-page-service";
import { LandingPageRenderer } from "@/components/landing-pages/landing-page-renderer";
import { PublicFunnelDocument } from "@/components/landing-pages/public-funnel-document";
import type { PageDocument } from "@/lib/funnel-page-document";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";
import { getPublicFunnelPage } from "@/lib/funnel-public-page";
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
    if (page.content.flow.goal === "webinar") return <FunnelWebinarExperience state={page.content} stepId={page.content.flow.steps[0].id} slug={page.slug} resource={page.webinar} />;
    const document = getPublicFunnelPage(page.content);
    if (!document) notFound();
    return <PublicFunnelDocument document={document} />;
  }
  if (!isPageDocument(page.content)) return <LandingPageRenderer content={page.content} context={page.context} />;
  return <PublicFunnelDocument document={page.content} />;
}
