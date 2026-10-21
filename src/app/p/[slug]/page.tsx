import type { RegistrationAttributionQuery } from "@/lib/registration-attribution";
import { registrationRetryBoundary } from "@/components/registration-retry-boundary";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { decodeRouteSlug } from "@/lib/format";
import { TeamFunnelPublicPage } from "@/components/team-funnel-public-page";
import { getPublicTeamFunnelPage } from "@/lib/team-funnel-public-page";
import { buildShareMetadata, shareDescription, unavailableShareMetadata } from "@/lib/public-share-metadata";

const loadFunnelPage = cache(async (slug: string) => getPublicTeamFunnelPage(slug));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const view = await loadFunnelPage(decodeRouteSlug((await params).slug));
  // 只有已發布且可公開的漏斗頁才輸出內容；其他狀態不洩漏標題並禁止收錄。
  if (view.state !== "ready" || !view.page) return unavailableShareMetadata();
  return buildShareMetadata({
    title: view.page.headline,
    description: shareDescription(view.page.subheadline, view.page.webinar.title),
    siteName: view.page.partner.name,
  });
}

export default async function PublicPartnerFunnelPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<RegistrationAttributionQuery & { registrationRetry?: string; submitted?: string }> }) {
  const slug = decodeRouteSlug((await params).slug);
  const view = await loadFunnelPage(slug);
  if (view.state === "not_found") notFound();
  if (view.state !== "ready") return <TeamFunnelPublicPage view={view} />;
  const query = await searchParams;
  const withRetry = await registrationRetryBoundary({ formId: view.state === "ready" ? view.page?.webinar?.registration?.formId : undefined, sourcePath: `/p/${slug}`, retry: query?.registrationRetry, submitted: query?.submitted, attributionQuery: query });
  return withRetry(<TeamFunnelPublicPage view={view} />);
}
