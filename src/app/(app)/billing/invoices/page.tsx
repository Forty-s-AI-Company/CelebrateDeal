import { Download, ReceiptText } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "paid") return "green" as const;
  if (status === "issued") return "blue" as const;
  if (status === "overdue") return "orange" as const;
  return "gray" as const;
}

export default async function BillingInvoicesPage() {
  const vendor = await requireVendor();
  const invoices = await getDb().invoice.findMany({
    where: { vendorId: vendor.id },
    orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
  });

  const issuedTotal = invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const unpaidTotal = invoices.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.totalCents, 0);

  return (
    <>
      <PageHeader
        title="帳單"
        description="彙整平台月費、超額用量費、金流服務費、交易服務費與聯盟結算管理費。"
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-white to-blue-50">
          <p className="text-sm font-medium text-slate-500">累計帳單金額</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(issuedTotal)}</p>
        </Card>
        <Card className="bg-gradient-to-br from-white to-orange-50">
          <p className="text-sm font-medium text-slate-500">未付款 / 待扣款</p>
          <p className="mt-2 text-3xl font-bold text-orange-700">{formatCurrency(unpaidTotal)}</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">對帳匯出</p>
          <button className="mt-3 inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Download size={16} />
            匯出 CSV
          </button>
        </Card>
      </div>

      {invoices.length === 0 ? (
        <EmptyState title="尚無帳單" description="產生第一筆月結後，系統會在這裡列出月費、超額費與服務費明細。" />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950">
              <ReceiptText size={18} />
              帳單列表
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">帳單</th>
                  <th className="px-5 py-3">月份</th>
                  <th className="px-5 py-3">月費</th>
                  <th className="px-5 py-3">超額</th>
                  <th className="px-5 py-3">金流 / 交易</th>
                  <th className="px-5 py-3">聯盟管理</th>
                  <th className="px-5 py-3">總額</th>
                  <th className="px-5 py-3">狀態</th>
                  <th className="px-5 py-3">到期</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4 font-mono text-slate-700">{invoice.invoiceNumber}</td>
                    <td className="px-5 py-4 font-semibold text-slate-950">{invoice.monthKey}</td>
                    <td className="px-5 py-4">{formatCurrency(invoice.monthlyFeeCents)}</td>
                    <td className="px-5 py-4">{formatCurrency(invoice.overflowFeeCents)}</td>
                    <td className="px-5 py-4">{formatCurrency(invoice.paymentServiceFeeCents + invoice.transactionServiceFeeCents)}</td>
                    <td className="px-5 py-4">{formatCurrency(invoice.affiliateManagementFeeCents)}</td>
                    <td className="px-5 py-4 font-bold text-slate-950">{formatCurrency(invoice.totalCents)}</td>
                    <td className="px-5 py-4"><Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge></td>
                    <td className="px-5 py-4 text-slate-500">{invoice.dueAt ? formatDateTime(invoice.dueAt) : "未設定"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
