import { redirect } from "next/navigation";
import { MessageTemplateForm } from "@/components/message-template-form";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { canManageMessageDelivery } from "@/lib/vendor-capabilities";

export default async function NewMessageTemplatePage() {
  const auth = await requireAuth();
  if (!auth.vendor || !canManageMessageDelivery(auth.member?.role)) redirect("/messages/templates?error=message_manager_required");
  return (
    <>
      <PageHeader title="新增訊息模板" description="可使用 {{name}}、{{live_title}} 等變數，MVP 先儲存模板內容。" />
      <MessageTemplateForm />
    </>
  );
}
