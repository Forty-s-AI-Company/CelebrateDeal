import { Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function NewAffiliatePage() {
  await requireVendorManager();
  return (
    <>
      <PageHeader title="新增聯盟夥伴目前停用" description="首發 MVP 暫停建立新的聯盟佣金負債。" />
      <Card>
        <p className="text-sm text-slate-600">既有夥伴、歷史佣金、退款與月結處理維持可用。</p>
      </Card>
    </>
  );
}
