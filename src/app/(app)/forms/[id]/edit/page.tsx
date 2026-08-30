import { notFound } from "next/navigation";
import { FormBuilder } from "@/components/form-builder";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const { error } = await searchParams;
  const db = getDb();
  const [form, promoVideos] = await Promise.all([
    db.registrationForm.findFirst({ where: { id, vendorId: vendor.id } }),
    db.video.findMany({
      where: { vendorId: vendor.id, status: "ready" },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!form) notFound();
  return (
    <>
      <PageHeader title="編輯報名表" description="調整表單文案、欄位與送出後訊息。" />
      <FormBuilder form={form} error={error} draftScope={vendor.id} promoVideos={promoVideos} />
    </>
  );
}
