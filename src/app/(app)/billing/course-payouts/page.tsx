import Link from "next/link";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorFinance } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "paid") return "green" as const;
  if (status === "void") return "orange" as const;
  return "blue" as const;
}

export default async function MerchantCoursePayoutsPage() {
  const { vendor } = await requireVendorFinance("/billing/course-payouts");
  const payouts = await getDb().coursePayout.findMany({
    where: { vendorId: vendor.id },
    orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      recipient: {
        include: { vendorMember: { include: { user: { select: { name: true } } } } },
      },
    },
  });
  const pending = payouts.filter((payout) => payout.status === "pending");
  const pendingAmount = pending.reduce((sum, payout) => sum + payout.finalAmountCents, 0);

  return (
    <>
      <PageHeader
        title="課程 F/G 分潤"
        description="檢視課程分潤的 gross、net reference、應付金額、退款／dispute ledger 與人工出款結果。此頁為商家唯讀對帳，不會執行付款。"
      />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card><p className="text-sm font-medium text-slate-500">最近月結</p><p className="mt-2 text-3xl font-bold text-slate-950">{payouts.length}</p><p className="mt-1 text-xs text-slate-500">最多顯示最近 100 筆</p></Card>
        <Card className="bg-gradient-to-br from-white to-orange-50"><p className="text-sm font-medium text-slate-500">待處理</p><p className="mt-2 text-3xl font-bold text-orange-700">{pending.length}</p></Card>
        <Card><p className="text-sm font-medium text-slate-500">待處理金額</p><p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(pendingAmount)}</p></Card>
      </div>

      {payouts.length === 0 ? (
        <EmptyState title="尚無課程分潤月結" description="含有 F/G allocation 的課程交易完成月結後，商家財務可在這裡檢視對帳資料。" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-5 py-3">月份</th><th className="px-5 py-3">Recipient</th><th className="px-5 py-3">Gross</th><th className="px-5 py-3">Net reference</th><th className="px-5 py-3">Payable</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">Outcome</th><th className="px-5 py-3">明細</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payouts.map((payout) => (
                <tr key={payout.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-5 py-4"><p className="font-semibold text-slate-950">{payout.monthKey}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(payout.createdAt)}</p></td>
                  <td className="px-5 py-4 font-semibold text-slate-950">{payout.recipient.vendorMember.user.name}</td>
                  <td className="px-5 py-4">{payout.grossSalesAmountCents == null ? "未知" : formatCurrency(payout.grossSalesAmountCents)}</td>
                  <td className="px-5 py-4">{payout.netReferenceAmountCents == null ? "未知" : formatCurrency(payout.netReferenceAmountCents)}</td>
                  <td className="px-5 py-4 font-bold text-slate-950">{formatCurrency(payout.finalAmountCents)}</td>
                  <td className="px-5 py-4"><Badge tone={statusTone(payout.status)}>{payout.status}</Badge></td>
                  <td className="px-5 py-4 text-slate-600">{payout.outcomeReference ?? payout.outcomeReason ?? "尚未記錄"}</td>
                  <td className="px-5 py-4"><Link href={`/billing/course-payouts/${encodeURIComponent(payout.id)}`} className="font-semibold text-primary hover:underline">查看 ledger</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
