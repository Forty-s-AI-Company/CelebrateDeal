import { Download, ReceiptText } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorFinance } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

const labels: Record<string, string> = { queued: "排隊中", issued: "已開立", allowance: "已開立折讓", voided: "已作廢" };
const tones: Record<string, "gray" | "green" | "orange" | "red"> = { queued: "orange", issued: "green", allowance: "orange", voided: "red" };

export default async function ElectronicInvoicesPage() {
  const { vendor } = await requireVendorFinance("/billing/electronic-invoices");
  const invoices = await getDb().electronicInvoice.findMany({
    where: { vendorId: vendor.id },
    include: { order: { select: { orderNumber: true } }, allowances: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });
  return <>
    <PageHeader title="電子發票" description="台灣 B2C 銷售發票、載具／統編快照與退款折讓狀態。" />
    <div className="mb-6 flex justify-end">
      <Link href="/billing/electronic-invoices/export" prefetch={false} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={16} />匯出開立報表 CSV</Link>
    </div>
    {invoices.length === 0 ? <EmptyState title="尚無電子發票" description="訂單付款後會自動排程開立，暫時排隊不會影響付款成功狀態。" /> :
      <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-semibold"><ReceiptText size={18} />發票列表</h2></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">發票號碼</th><th className="px-5 py-3">訂單</th><th className="px-5 py-3">買受人／載具</th><th className="px-5 py-3">含稅金額</th><th className="px-5 py-3">未稅</th><th className="px-5 py-3">營業稅</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">開立時間</th></tr></thead>
          <tbody className="divide-y divide-border">{invoices.map((invoice) => <tr key={invoice.id}><td className="px-5 py-4 font-mono">{invoice.invoiceNumber ?? "排隊中"}</td><td className="px-5 py-4 font-semibold">{invoice.order.orderNumber}</td><td className="px-5 py-4">{invoice.buyerDisplay}</td><td className="px-5 py-4">{formatCurrency(invoice.amountCents, invoice.currency)}</td><td className="px-5 py-4">{formatCurrency(invoice.pretaxAmountCents, invoice.currency)}</td><td className="px-5 py-4">{formatCurrency(invoice.taxAmountCents, invoice.currency)}</td><td className="px-5 py-4"><Badge tone={tones[invoice.status] ?? "gray"}>{labels[invoice.status] ?? invoice.status}{invoice.allowances.length ? `（${invoice.allowances.length} 筆）` : ""}</Badge></td><td className="px-5 py-4 text-slate-500">{invoice.issuedAt ? formatDateTime(invoice.issuedAt) : "尚未開立"}</td></tr>)}</tbody>
        </table></div></Card>}
  </>;
}
