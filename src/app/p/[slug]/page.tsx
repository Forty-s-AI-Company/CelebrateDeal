import type { RegistrationAttributionQuery } from "@/lib/registration-attribution";
import { registrationRetryBoundary } from "@/components/registration-retry-boundary";
import { notFound } from "next/navigation";
import { TeamFunnelPublicPage } from "@/components/team-funnel-public-page";
import { getPublicTeamFunnelPage } from "@/lib/team-funnel-public-page";

export default async function PublicPartnerFunnelPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<RegistrationAttributionQuery & { registrationRetry?: string; submitted?: string }> }) {
  const { slug } = await params;
  const view = await getPublicTeamFunnelPage(slug);
  if (view.state === "not_found") notFound();
  if (view.state !== "ready") return <TeamFunnelPublicPage view={view} />;
  const query = await searchParams;
  const withRetry = await registrationRetryBoundary({ formId: view.state === "ready" ? view.page?.webinar?.registration?.formId : undefined, sourcePath: `/p/${slug}`, retry: query?.registrationRetry, submitted: query?.submitted, attributionQuery: query });
  return withRetry(<TeamFunnelPublicPage view={view} />);
}
