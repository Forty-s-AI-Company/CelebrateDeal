import type { EmailDeliveryOperationsActionState } from "@/app/actions/email-delivery-operations-actions";
import { CsrfField } from "@/components/csrf-field";
import { EmailDeliveryOperationsWorkbench } from "@/components/email-delivery-operations-workbench";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { loadEmailDeliverySearchResult } from "@/lib/email-delivery-operations";

export default async function MessageDeliveriesPage() {
  const vendor = await requireVendorManager();
  const result = await loadEmailDeliverySearchResult(vendor.id, {
    query: "",
    status: "ALL",
    trigger: "ALL",
    page: 1,
  });
  const initialState: EmailDeliveryOperationsActionState = {
    status: "idle",
    message: "",
    result,
  };

  return (
    <>
      <PageHeader
        title="Email 寄送營運"
        description="安全查找、篩選並處理寄送失敗；收件資訊維持遮罩，重新排程也不會直接呼叫外部寄信服務。"
        action={<ButtonLink href="/messages/templates" tone="secondary">管理訊息模板</ButtonLink>}
      />
      <EmailDeliveryOperationsWorkbench initialState={initialState} csrfField={<CsrfField />} />
    </>
  );
}
