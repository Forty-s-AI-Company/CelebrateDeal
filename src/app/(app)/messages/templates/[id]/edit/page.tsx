import { notFound, redirect } from "next/navigation";
import { MessageTemplateForm } from "@/components/message-template-form";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canManageMessageDelivery } from "@/lib/vendor-capabilities";

export default async function EditMessageTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.vendor || !canManageMessageDelivery(auth.member?.role)) redirect("/messages/templates?error=message_manager_required");
  const vendor = auth.vendor;
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
