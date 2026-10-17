import { MessageTemplateForm } from "@/components/message-template-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function NewMessageTemplatePage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  await requireVendorManager();
  const { error } = await searchParams;
  return (
    <>
      <PageHeader title="新增訊息模板" description="可分別建立 Email 與 LINE 通知模板，每份模板選擇一個通道。SMS 尚未串接，不能啟用。" />
      <MessageTemplateForm error={error === "invalid_template" || error === "missing_template" ? error : null} />
    </>
  );
}
