import { Badge, Card, PageHeader } from "@/components/ui";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { selectBillingPlanAction } from "./actions";
import { PlanSubmitButton } from "./plan-submit-button";

type BillingPlansPageProps = {
  searchParams?: Promise<{ status?: string | string[]; error?: string | string[] }>;
};

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BillingPlansPage({ searchParams = Promise.resolve({}) }: BillingPlansPageProps = {}) {
  const auth = await requireAuth();
  if (!auth.vendor) {
    redirect(auth.isPlatformAdmin ? "/admin/billing/dashboard" : "/login?error=no_vendor");
  }

  const canManageBilling = auth.member?.status === "active" && auth.member.role === "owner";
  const [plans, currentSubscription, csrfToken, query] = await Promise.all([
    getDb().billingPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPriceCents: "asc" },
    }),
    getDb().vendorSubscription.findFirst({
      where: { vendorId: auth.vendor.id, status: "active" },
      include: { plan: true },
      orderBy: { startedAt: "desc" },
    }),
    canManageBilling ? getCsrfToken() : Promise.resolve(""),
    searchParams,
  ]);
  const status = queryValue(query.status);
  const error = queryValue(query.error);

  return (
    <>
      <PageHeader title="方案" description="混合式計費：平台月費、超額用量、平台金流服務費、交易服務費與聯盟結算管理費分開計算。" />
      {status === "changed" ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          方案已更新，新的月費與額度會套用到既有月結流程。
        </p>
      ) : null}
      {status === "current" ? (
        <p role="status" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
          這已經是目前方案，沒有建立重複訂閱。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error === "unavailable" ? "方案不存在或已停止銷售，請重新整理後再選擇。" : "方案更新發生衝突，請稍後再試。"}
        </p>
      ) : null}
      <Card className="mb-4 bg-blue-50/60">
        <p className="text-sm font-medium text-slate-600">目前方案</p>
        <p className="mt-1 text-xl font-semibold text-slate-950">{currentSubscription?.plan.name ?? "尚未選擇"}</p>
        <p className="mt-1 text-sm text-slate-500">
          方案採月底月結後付，不會在此頁直接發動 PayUni 或建立商品交易。
        </p>
      </Card>
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
            {currentSubscription?.planId === plan.id ? (
              <button type="button" disabled className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-200 px-4 text-sm font-semibold text-slate-600">
                目前方案
              </button>
            ) : canManageBilling ? (
              <form action={selectBillingPlanAction}>
                <input type="hidden" name="_csrf" value={csrfToken} />
                <input type="hidden" name="planId" value={plan.id} />
                <PlanSubmitButton label={currentSubscription ? "變更方案" : "選擇方案"} />
              </form>
            ) : (
              <button type="button" disabled className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-100 px-4 text-sm font-semibold text-slate-500">
                僅限商店擁有者異動
              </button>
            )}
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
