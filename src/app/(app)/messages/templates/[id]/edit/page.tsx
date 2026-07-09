import { notFound } from "next/navigation";
import { MessageTemplateForm } from "@/components/message-template-form";
import { PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditMessageTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendor();
  const { id } = await params;
  const template = await getDb().messageTemplate.findFirst({ where: { id, vendorId: vendor.id } });
  if (!template) notFound();
  return (
    <>
      <PageHeader title="編輯訊息模板" description="更新通知渠道、觸發條件與文案。" />
      <MessageTemplateForm template={template} />
    </>
  );
}
