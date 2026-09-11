import { notFound } from "next/navigation";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { PresenterStudio } from "@/components/presenter-studio";
import { PageHeader } from "@/components/ui";

export default async function PresenterPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const live = await getDb().live.findFirst({ where: { id, vendorId: vendor.id }, select: { id: true, title: true } });
  if (!live) notFound();
  return <><PageHeader title="講師與 PPT 排版" description={live.title} /><PresenterStudio key={live.id} liveId={live.id} /></>;
}
