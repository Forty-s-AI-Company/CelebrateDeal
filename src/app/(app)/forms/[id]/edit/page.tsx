import { notFound } from "next/navigation";
import { FormBuilder } from "@/components/form-builder";
import { PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditFormPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendor();
  const { id } = await params;
  const form = await getDb().registrationForm.findFirst({ where: { id, vendorId: vendor.id } });
  if (!form) notFound();
  return (
    <>
      <PageHeader title="編輯報名表" description="調整表單文案、欄位與送出後訊息。" />
      <FormBuilder form={form} />
    </>
  );
}
