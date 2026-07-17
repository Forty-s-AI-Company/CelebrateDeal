import { Badge, Card, PageHeader } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";

export default async function BillingPlansPage() {
  const plans = await getDb().billingPlan.findMany({
    where: { isActive: true },
    orderBy: { monthlyPriceCents: "asc" },
  });

  return (
    <>
      <PageHeader title="方案" description="混合式計費：平台月費、超額用量、平台金流服務費、交易服務費與聯盟結算管理費分開計算。" />
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id} className="grid gap-4 bg-gradient-to-br from-white to-slate-50">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{plan.name}</h2>
                <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
              </div>
              <Badge tone={plan.isActive ? "blue" : "gray"}>{plan.code}</Badge>
            </div>
            <p className="text-3xl font-bold text-slate-950">{formatCurrency(plan.monthlyPriceCents)}</p>
            <div className="grid gap-2 text-sm text-slate-600">
              <PlanRow label="內含播放" value={`${Math.round(plan.includedStreamMinutes / 60).toLocaleString()} 小時 / 月`} />
              <PlanRow label="內含活動" value={`${plan.includedEvents.toLocaleString()} 場 / 月`} />
              <PlanRow label="內含推廣者" value={`${plan.includedAffiliates.toLocaleString()} 人`} />
              <PlanRow label="儲存額度" value={`${plan.includedStorageMinutes.toLocaleString()} 分鐘`} />
              <PlanRow label="平台金流月費" value={formatCurrency(plan.paymentServiceFeeCents)} />
              <PlanRow label="交易服務費" value={`${plan.transactionFeeRateBps / 100}%`} />
            </div>
            <div className="rounded-lg bg-white p-3 text-xs text-slate-500 shadow-sm">
              超額：播放每 100 小時 {formatCurrency(plan.overflowWatchHourPriceCents)}、活動每 10 場 {formatCurrency(plan.overflowEventUnitPriceCents)}、推廣者每 10 人 {formatCurrency(plan.overflowAffiliateUnitPriceCents)}。
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-white px-3 py-2">
      <span>{label}</span>
      <b className="text-slate-950">{value}</b>
    </div>
  );
}
