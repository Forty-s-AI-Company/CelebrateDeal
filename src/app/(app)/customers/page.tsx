import { Card, PageHeader } from "@/components/ui";
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ["全部學員", allCustomers.length, "包含報名、觀看與購買紀錄"],
        ["已預約諮詢", booked, "目前狀態為已排程"],
        ["高意向學員", hot, "依既有標籤真實統計"],
        ["成交轉換率", allCustomers.length ? `${Math.round(won / allCustomers.length * 100)}%` : "0%", `${won} 位已成交`],
      ].map(([label, value, hint]) => <Card key={String(label)}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{hint}</p></Card>)}
    </div>
    <CustomerCrmWorkbench initialState={{ status: "idle", message: "", items: allCustomers }} csrfField={<CsrfField />} />
  </div>;
}
