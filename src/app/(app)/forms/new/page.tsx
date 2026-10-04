import { notFound } from "next/navigation";
import { resolveSalesProjectBinding, SalesProjectBindingError } from "@/lib/sales-project-binding";
import { FormBuilder } from "@/components/form-builder";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function NewFormPage({ searchParams }: { searchParams: Promise<{ error?: string; projectId?: string }> }) {
  const vendor = await requireVendorManager();
  const { error, projectId: requestedProject } = await searchParams;
  const projectId = await validatedProject(vendor.id, requestedProject ?? null);
  const promoVideos = await getDb().video.findMany({
    where: { vendorId: vendor.id, status: "ready" },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });
  return (
    <>
      <PageHeader title="新增報名表" description="用視覺化欄位編輯與即時預覽，建立可直接分享或放入直播頁的報名流程。" />
      <FormBuilder projectId={projectId} error={error} draftScope={vendor.id} promoVideos={promoVideos} />
    </>
  );
}

async function validatedProject(vendorId: string, projectId: string | null) {
  try { return await resolveSalesProjectBinding(getDb(), vendorId, projectId); }
  catch (error) {
    if (error instanceof SalesProjectBindingError) notFound();
    throw error;
  }
}
