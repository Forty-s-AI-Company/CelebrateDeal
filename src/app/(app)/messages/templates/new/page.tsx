import { MessageTemplateForm } from "@/components/message-template-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function NewMessageTemplatePage() {
  await requireVendorManager();
  return (
    <>
      <PageHeader title="新增訊息模板" description="可使用 {{name}}、{{live_title}} 等變數，MVP 先儲存模板內容。" />
      <MessageTemplateForm />
    </>
  );
}
