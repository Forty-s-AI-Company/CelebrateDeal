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
      <PageHeader title="新增訊息模板" description="建立可供 Email 排程與寄送使用的商家模板；未串接的渠道會保持停用。" />
      <MessageTemplateForm error={error === "invalid_template" || error === "missing_template" ? error : null} />
    </>
  );
}
