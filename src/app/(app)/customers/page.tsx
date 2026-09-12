import { ListSummary, PageHeader } from "@/components/ui";
import { CsrfField } from "@/components/csrf-field";
import { CustomerCrmWorkbench } from "@/components/customer-crm-workbench";
import { requireVendorManagerContext } from "@/lib/auth";
import { listCustomers } from "@/lib/customer-crm";
import { getSalesProjectScope, salesScopeDescription } from "@/lib/sales-project-scope";
import { SalesScopeNotice } from "@/components/sales-scope-notice";

export default async function CustomersPage() {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  const allCustomers = await listCustomers(vendor.id, "", "", scope.projectId);
  const booked = allCustomers.filter((item) => item.bookingStatus === "scheduled").length;
  const hot = allCustomers.filter((item) => item.tags.some((tag) => tag.includes("高意向"))).length;
  const won = allCustomers.filter((item) => item.consultationStatus === "closed_won").length;
  return <div className="space-y-6">
    <PageHeader title="學員 CRM" description={`把報名、觀看、諮詢與成交訊號收進同一張學員旅程圖。${salesScopeDescription(vendor.name, scope)}`} />
    <SalesScopeNotice workspaceName={vendor.name} scope={scope} />
    <ListSummary items={[
      { label: "全部學員", value: allCustomers.length, hint: "包含報名、觀看與購買紀錄" },
      { label: "已預約諮詢", value: booked, hint: "目前狀態為已排程" },
      { label: "高意向學員", value: hot, hint: "依既有標籤真實統計" },
      { label: "成交轉換率", value: allCustomers.length ? `${Math.round(won / allCustomers.length * 100)}%` : "0%", hint: `${won} 位已成交` },
    ]} />
    <CustomerCrmWorkbench initialState={{ status: "idle", message: "", items: allCustomers }} csrfField={<CsrfField />} />
  </div>;
}
