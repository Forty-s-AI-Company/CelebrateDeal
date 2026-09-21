import { notFound } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getSalesProjectScope } from "@/lib/sales-project-scope";
import { PresenterStudio } from "@/components/presenter-studio";
import { PageHeader } from "@/components/ui";

export default async function PresenterPage({ params }: { params: Promise<{ id: string }> }) {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  const { id } = await params;
  const live = await getDb().live.findFirst({ where: { id, vendorId: vendor.id, ...(scope.projectId ? { projectId: scope.projectId } : {}) }, select: { id: true, title: true } });
  if (!live) notFound();
  return <><PageHeader title="講師與 PPT 排版" description={live.title} /><PresenterStudio key={live.id} liveId={live.id} /></>;
}
