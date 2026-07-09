import { AffiliateForm } from "@/components/affiliate-form";
import { PageHeader } from "@/components/ui";

export default function NewAffiliatePage() {
  return (
    <>
      <PageHeader title="新增聯盟夥伴" description="建立推廣碼與來源設定，前台會記錄 ref 來源。" />
      <AffiliateForm />
    </>
  );
}
