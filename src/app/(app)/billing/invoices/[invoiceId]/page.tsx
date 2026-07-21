import Link from "next/link";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { invoiceStatusLabel, invoiceStatusTone } from "@/lib/invoice-presentation";
import { PrintInvoiceButton } from "./print-invoice-button";

type InvoiceDetailPageProps = {
  params: Promise<{ invoiceId: string }>;
};

export default async function InvoiceDetailPage({ params }: InvoiceDetailPageProps) {
  const vendor = await requireVendor();
  const { invoiceId } = await params;
  if (!invoiceId || invoiceId.length > 64) notFound();

  const invoice = await getDb().invoice.findFirst({
    where: { id: invoiceId, vendorId: vendor.id },
  });
  if (!invoice) notFound();

  const isReceipt = invoice.status === "paid";
  const title = isReceipt ? "付款收據" : "帳單明細";
  const lineItems = [
    ["平台月費", invoice.monthlyFeeCents],
    ["超額用量費", invoice.overflowFeeCents],
    ["金流服務費", invoice.paymentServiceFeeCents],
    ["交易服務費", invoice.transactionServiceFeeCents],
    ["聯盟結算管理費", invoice.affiliateManagementFeeCents],
  ] as const;

  return (
    <div className="print:bg-white print:text-black">
      <div className="print:hidden">
        <PageHeader
          title={title}
          description="查看單筆帳單費用、付款狀態與可列印收據。"
          action={(
            <div className="flex flex-wrap gap-2">
              <Link
                href="/billing/invoices"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ArrowLeft size={16} aria-hidden="true" />
                返回帳單
              </Link>
              <PrintInvoiceButton />
            </div>
          )}
        />
      </div>

      <Card className="mx-auto max-w-4xl print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <ReceiptText size={22} aria-hidden="true" />
              <p className="text-sm font-semibold tracking-wide">CELEBRATEDEAL</p>
            </div>
            <h1 className="mt-3 text-2xl font-bold text-slate-950">{title}</h1>
            <p className="mt-1 font-mono text-sm text-slate-500">{invoice.invoiceNumber}</p>
          </div>
          <Badge tone={invoiceStatusTone(invoice.status)}>{invoiceStatusLabel(invoice.status)}</Badge>
        </header>

        <section className="grid gap-4 border-b border-border py-5 text-sm sm:grid-cols-2">
          <Detail label="帳單對象" value={vendor.name} />
          <Detail label="計費月份" value={invoice.monthKey} mono />
          <Detail label="建立時間" value={formatDateTime(invoice.createdAt)} />
          <Detail label="到期時間" value={invoice.dueAt ? formatDateTime(invoice.dueAt) : "未設定"} />
          <Detail label="付款時間" value={invoice.paidAt ? formatDateTime(invoice.paidAt) : "尚未付款"} />
          <Detail label="文件類型" value={isReceipt ? "付款收據" : "帳單明細"} />
        </section>

        <section className="py-5">
          <h2 className="mb-3 text-base font-semibold text-slate-950">費用項目</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">項目</th>
                  <th className="px-4 py-3 text-right font-medium">金額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lineItems.map(([label, amount]) => (
                  <tr key={label}>
                    <td className="px-4 py-3 text-slate-700">{label}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">{formatCurrency(amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ml-auto grid max-w-sm gap-2 border-t border-border pt-5 text-sm">
          <TotalRow label="小計" value={formatCurrency(invoice.subtotalCents)} />
          <TotalRow label="稅額" value={formatCurrency(invoice.taxCents)} />
          <TotalRow label="總額" value={formatCurrency(invoice.totalCents)} total />
        </section>

        <footer className="mt-6 border-t border-border pt-4 text-xs leading-5 text-slate-500">
          本頁是 CelebrateDeal 平台帳單與付款紀錄，不是財政部電子發票。若未來啟用電子發票服務，將另行提供法定憑證資訊。
        </footer>
      </Card>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 font-semibold text-slate-950 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function TotalRow({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-8 ${total ? "mt-1 border-t border-border pt-3 text-lg font-bold text-slate-950" : "text-slate-600"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
