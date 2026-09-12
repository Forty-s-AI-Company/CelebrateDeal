import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { loadPublicLandingPage } from "@/lib/landing-page-service";
import { LandingPageRenderer } from "@/components/landing-pages/landing-page-renderer";
export const dynamic = "force-dynamic";
const load = cache(loadPublicLandingPage);
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await load((await params).slug);
  if (!page) return { title: "頁面不存在", robots: { index: false, follow: false } };
  const seo = page.content.data.root.props;
  const title = seo?.title || "Webinar 活動";
  return { title, description: seo?.description, openGraph: { title, description: seo?.description, ...(seo?.shareImage ? { images: [seo.shareImage] } : {}) } };
}
export default async function PublicLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await load((await params).slug);
  if (!page) notFound();
  return <LandingPageRenderer content={page.content} context={page.context} />;
}
