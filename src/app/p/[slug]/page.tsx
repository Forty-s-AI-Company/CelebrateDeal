import { notFound } from "next/navigation";
import { TeamFunnelPublicPage } from "@/components/team-funnel-public-page";
import { getPublicTeamFunnelPage } from "@/lib/team-funnel-public-page";

export default async function PublicPartnerFunnelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await getPublicTeamFunnelPage(slug);
  if (view.state === "not_found") notFound();
  return <TeamFunnelPublicPage view={view} />;
}
