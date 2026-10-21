import { Download, ReceiptText } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorFinance } from "@/lib/auth";
import { StepUpMfaNotice } from "@/components/step-up-mfa-notice";
import { recentMfaStatus } from "@/lib/recent-mfa";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

const labels: Record<string, string> = { queued: "尚未開立（僅記錄需求）", issued: "已開立", allowance: "已開立折讓", voided: "已作廢" };
const tones: Record<string, "gray" | "green" | "orange" | "red"> = { queued: "orange", issued: "green", allowance: "orange", voided: "red" };

export default async function ElectronicInvoicesPage() {
  const { user, session, vendor } = await requireVendorFinance("/billing/electronic-invoices");
  const invoices = await getDb().electronicInvoice.findMany({
    where: { vendorId: vendor.id },
    include: { order: { select: { orderNumber: true } }, allowances: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });
  return <>
    <PageHeader title="電子發票" description="查看既有發票紀錄、發票需求與退款折讓狀態。" />
    {/* Automatic e-invoicing is not available yet; existing records stay readable. */}
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">自動電子發票尚未開放</p>
      <p className="mt-1 leading-6">目前未提供自動開立服務。付款成功、已儲存發票需求或匯出紀錄，均不代表已開立發票；如需發票，請另行確認開立方式。</p>
    </div>
    <div className="mb-4"><StepUpMfaNotice status={recentMfaStatus({ user, session })} nextPath="/billing/electronic-invoices" operation="匯出含買受人資料的 CSV" /></div>
    <div className="mb-6 flex justify-end">
      <Link href="/billing/electronic-invoices/export" prefetch={false} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={16} />匯出發票紀錄 CSV</Link>
    </div>
    {invoices.length === 0 ? <EmptyState title="尚無電子發票紀錄" description="自動開立服務尚未開放。付款紀錄與發票開立狀態需分別確認。" /> :
      <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-semibold"><ReceiptText size={18} />發票列表</h2></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">發票號碼</th><th className="px-5 py-3">訂單</th><th className="px-5 py-3">買受人／載具</th><th className="px-5 py-3">含稅金額</th><th className="px-5 py-3">未稅</th><th className="px-5 py-3">營業稅</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">開立時間</th></tr></thead>
          <tbody className="divide-y divide-border">{invoices.map((invoice) => <tr key={invoice.id}><td className="px-5 py-4 font-mono">{invoice.invoiceNumber ?? "尚無號碼"}</td><td className="px-5 py-4 font-semibold">{invoice.order.orderNumber}</td><td className="px-5 py-4">{invoice.buyerDisplay}</td><td className="px-5 py-4">{formatCurrency(invoice.amountCents, invoice.currency)}</td><td className="px-5 py-4">{formatCurrency(invoice.pretaxAmountCents, invoice.currency)}</td><td className="px-5 py-4">{formatCurrency(invoice.taxAmountCents, invoice.currency)}</td><td className="px-5 py-4"><Badge tone={tones[invoice.status] ?? "gray"}>{labels[invoice.status] ?? invoice.status}{invoice.allowances.length ? `（${invoice.allowances.length} 筆）` : ""}</Badge></td><td className="px-5 py-4 text-slate-500">{invoice.issuedAt ? formatDateTime(invoice.issuedAt) : "尚未開立"}</td></tr>)}</tbody>
        </table></div></Card>}
  </>;
}
