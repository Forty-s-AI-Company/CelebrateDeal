import { notFound } from "next/navigation";
import { FormBuilder } from "@/components/form-builder";
import { PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getSalesProjectScope } from "@/lib/sales-project-scope";

export default async function EditFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  if (scope.isAggregate) notFound();
  const { id } = await params;
  const { error } = await searchParams;
  const db = getDb();
  const [form, promoVideos] = await Promise.all([
    db.registrationForm.findFirst({
      where: { id, vendorId: vendor.id, ...(scope.projectId ? { projectId: scope.projectId } : {}) },
    }),
    db.video.findMany({
      where: { vendorId: vendor.id, status: "ready", ...(scope.projectId ? { projectId: scope.projectId } : {}) },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!form) notFound();
  return (
    <>
      <PageHeader title="編輯報名表" description="調整表單文案、欄位與送出後訊息。" />
      <FormBuilder form={form} error={error} draftScope={vendor.id} promoVideos={promoVideos} enableFunnelWizard />
    </>
  );
}
