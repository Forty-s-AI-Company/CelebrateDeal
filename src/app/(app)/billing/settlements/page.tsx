import { LockKeyhole, WalletCards } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "paid" || status === "locked") return "green" as const;
  if (status === "reviewing") return "orange" as const;
  if (status === "draft") return "gray" as const;
  return "blue" as const;
}

export default async function BillingSettlementsPage() {
  const vendor = await requireVendor();
  const settlements = await getDb().settlement.findMany({
    where: { vendorId: vendor.id },
    orderBy: [{ monthKey: "desc" }],
    include: { payoutBatch: true },
  });

  const current = settlements[0];

  return (
    <>
      <PageHeader
        title="月結"
        description="平台金流與自帶金流共用同一套結算報表，平台交易費、金流手續費與應撥款金額分開追溯。"
      />

      {current ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-4">
          <Card className="bg-gradient-to-br from-white to-blue-50">
            <p className="text-sm font-medium text-slate-500">本期成交額</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(current.grossRevenueCents)}</p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">平台費用</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">
              {formatCurrency(current.monthlyFeeCents + current.overflowFeeCents + current.paymentServiceFeeCents + current.transactionServiceFeeCents)}
            </p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">金流手續費</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(current.paymentGatewayFeeCents)}</p>
          </Card>
          <Card className="bg-gradient-to-br from-white to-orange-50">
            <p className="text-sm font-medium text-slate-500">預計撥款</p>
            <p className="mt-2 text-3xl font-bold text-orange-700">{formatCurrency(current.finalPayoutAmountCents)}</p>
          </Card>
        </div>
      ) : null}

      {settlements.length === 0 ? (
        <EmptyState title="尚無月結資料" description="月結批次建立後，這裡會列出每月應收費用、代收成交額與可撥款金額。" />
      ) : (
        <div className="grid gap-4">
          {settlements.map((settlement) => (
            <Card key={settlement.id} className="grid gap-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-950">{settlement.monthKey} 月結</h2>
                    <Badge tone={statusTone(settlement.status)}>{settlement.status}</Badge>
                    {settlement.lockedAt ? <Badge tone="green"><LockKeyhole size={12} /> 已鎖單</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    批次：{settlement.batchNumber ?? "尚未入批次"} · 出款日：{settlement.payoutDate ? formatDateTime(settlement.payoutDate) : "未排程"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">實際撥款金額</p>
                  <p className="text-2xl font-bold text-slate-950">{formatCurrency(settlement.finalPayoutAmountCents)}</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Metric label="月費" value={settlement.monthlyFeeCents} />
                <Metric label="超額用量" value={settlement.overflowFeeCents} />
                <Metric label="金流服務費" value={settlement.paymentServiceFeeCents} />
                <Metric label="交易服務費" value={settlement.transactionServiceFeeCents} />
                <Metric label="聯盟管理費" value={settlement.affiliateManagementFeeCents} />
                <Metric label="調整金額" value={settlement.adjustmentAmountCents} />
              </div>

              {settlement.payoutBatch ? (
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <WalletCards className="mr-2 inline" size={16} />
                  已連結出款批次 {settlement.payoutBatch.batchNumber}，狀態 {settlement.payoutBatch.status}。
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950">{formatCurrency(value)}</p>
    </div>
  );
}
