import { notFound } from "next/navigation";
import { MessageTemplateForm } from "@/components/message-template-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditMessageTemplatePage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const vendor = await requireVendorManager();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const template = await getDb().messageTemplate.findFirst({ where: { id, vendorId: vendor.id } });
  if (!template) notFound();
  return (
    <>
      <PageHeader title="編輯訊息模板" description="選擇 Email 或 LINE，更新觸發條件與內容。SMS 尚未串接。" />
      <MessageTemplateForm template={template} error={error === "invalid_template" ? error : null} />
    </>
  );
}
