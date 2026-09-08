import { Card, PageHeader } from "@/components/ui";
import { CsrfField } from "@/components/csrf-field";
import { CustomerCrmWorkbench } from "@/components/customer-crm-workbench";
import { requireVendorManager } from "@/lib/auth";
import { listCustomers } from "@/lib/customer-crm";

export default async function CustomersPage() {
  const vendor = await requireVendorManager();
  const allCustomers = await listCustomers(vendor.id);
  const booked = allCustomers.filter((item) => item.bookingStatus === "scheduled").length;
  const hot = allCustomers.filter((item) => item.tags.some((tag) => tag.includes("高意向"))).length;
  const won = allCustomers.filter((item) => item.consultationStatus === "closed_won").length;
  return <div className="space-y-6">
    <PageHeader title="學員 CRM" description="把報名、觀看、諮詢與成交訊號收進同一張學員旅程圖。" />
    <div className="grid gap-4 md:grid-cols-4">{[["總學員數", allCustomers.length], ["已預約諮詢", booked], ["高意向學員", hot], ["成交轉換率", allCustomers.length ? `${Math.round(won / allCustomers.length * 100)}%` : "0%"]].map(([label, number]) => <Card key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold text-slate-950">{number}</p></Card>)}</div>
    <CustomerCrmWorkbench initialState={{ status: "idle", message: "", items: allCustomers }} csrfField={<CsrfField />} />
  </div>;
}
