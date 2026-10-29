import { notFound } from "next/navigation";
import { resolveSalesProjectBinding, SalesProjectBindingError } from "@/lib/sales-project-binding";
import { FormBuilder } from "@/components/form-builder";
import { PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { ProjectBoundNotice, ProjectUnboundNotice } from "@/components/project-unbound-notice";
import { resolveBoundProjectName, resolveDefaultProjectCandidate } from "@/lib/sales-project-scope";
import { getDb } from "@/lib/db";

export default async function NewFormPage({ searchParams }: { searchParams: Promise<{ error?: string; projectId?: string }> }) {
  const { auth, vendor } = await requireVendorManagerContext();
  const { error, projectId: requestedProject } = await searchParams;
  const { candidate, scopeProjectName, isAggregate } = await resolveDefaultProjectCandidate(auth.user.id, vendor.id, requestedProject);
  const projectId = await validatedProject(vendor.id, candidate);
  const projectName = await resolveBoundProjectName(vendor.id, projectId, scopeProjectName);
  const promoVideos = await getDb().video.findMany({
    where: { vendorId: vendor.id, status: "ready" },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });
  return (
    <>
      <PageHeader title="新增報名表" description="用視覺化欄位編輯與即時預覽，建立可直接分享或放入直播頁的報名流程。" />
      <ProjectBoundNotice name={projectName} />
      {!projectId && isAggregate ? <ProjectUnboundNotice resource="報名表" /> : null}
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
