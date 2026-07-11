import Link from "next/link";
import { Banknote, Calculator, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import {
  createPayoutBatchAction,
  generateSettlementAction,
  lockSettlementAction,
  updateSettlementAdjustmentAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, PageHeader, SubmitButton } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function statusTone(status: string) {
  if (status === "paid" || status === "locked") return "green" as const;
  if (status === "ready_for_payout" || status === "reviewing") return "blue" as const;
  if (status === "failed") return "orange" as const;
  return "gray" as const;
}

export default async function AdminBillingSettlementsPage() {
  await requirePlatformAdmin();
  const db = getDb();
  const [vendors, settlements] = await Promise.all([
    db.vendor.findMany({
      orderBy: { createdAt: "desc" },
      include: { subscriptions: { where: { status: "active" }, include: { plan: true }, take: 1 } },
    }),
    db.settlement.findMany({
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
      include: { vendor: true, payoutBatch: true },
    }),
  ]);

  const lockedReady = settlements.filter((settlement) => settlement.lockedAt && !settlement.payoutBatchId && settlement.finalPayoutAmountCents > 0);
  const pendingPayoutAmount = lockedReady.reduce((sum, settlement) => sum + settlement.finalPayoutAmountCents, 0);

  return (
    <>
      <PageHeader
        title="平台月結管理"
        description="產生商家月結、覆核人工調整、鎖單，並將已鎖定月結送入批次出款。"
        action={<Link href="/billing/settlements" className="text-sm font-semibold text-primary hover:underline">查看商家端月結</Link>}
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="bg-gradient-to-br from-white to-blue-50">
          <p className="text-sm font-medium text-slate-500">商家數</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{vendors.length}</p>
        </Card>
        <Card className="bg-gradient-to-br from-white to-orange-50">
          <p className="text-sm font-medium text-slate-500">待出款月結</p>
          <p className="mt-2 text-3xl font-bold text-orange-700">{lockedReady.length}</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">待出款金額</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(pendingPayoutAmount)}</p>
        </Card>
      </div>

      <Card className="mb-6">
        <div className="flex items-center gap-2">
          <Calculator className="text-primary" size={18} />
          <h2 className="text-lg font-semibold text-slate-950">產生 / 重算月結</h2>
        </div>
        <form action={generateSettlementAction} className="mt-4 grid gap-3 md:grid-cols-[1.4fr_1fr_auto] md:items-end">
          <CsrfField />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            商家
            <select name="vendorId" className="h-10 rounded-md border border-border bg-white px-3 text-sm">
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name} · {vendor.subscriptions[0]?.plan.name ?? "未設定方案"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            月份
            <input name="monthKey" type="month" defaultValue={currentMonthKey()} className="h-10 rounded-md border border-border bg-white px-3 text-sm" />
          </label>
          <SubmitButton>
            <RefreshCw size={16} />
            產生月結
          </SubmitButton>
        </form>
      </Card>

      <div className="grid gap-5">
        {settlements.map((settlement) => (
          <Card key={settlement.id} className="grid gap-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-950">{settlement.vendor.name} · {settlement.monthKey}</h2>
                  <Badge tone={statusTone(settlement.status)}>{settlement.status}</Badge>
                  {settlement.lockedAt ? <Badge tone="green"><LockKeyhole size={12} /> 已鎖單</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  建立 {formatDateTime(settlement.createdAt)}
                  {settlement.lockedAt ? ` · 鎖定 ${formatDateTime(settlement.lockedAt)}` : ""}
                  {settlement.payoutBatch ? ` · 批次 ${settlement.payoutBatch.batchNumber}` : ""}
                </p>
              </div>
              <div className="text-left xl:text-right">
                <p className="text-sm text-slate-500">實際撥款</p>
                <p className="text-3xl font-bold text-slate-950">{formatCurrency(settlement.finalPayoutAmountCents)}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Metric label="月費" value={settlement.monthlyFeeCents} />
              <Metric label="超額" value={settlement.overflowFeeCents} />
              <Metric label="金流月費" value={settlement.paymentServiceFeeCents} />
              <Metric label="交易服務費" value={settlement.transactionServiceFeeCents} />
              <Metric label="金流手續費" value={settlement.paymentGatewayFeeCents} />
              <Metric label="調整" value={settlement.adjustmentAmountCents} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_auto_auto] xl:items-end">
              <form action={updateSettlementAdjustmentAction} className="grid gap-3 md:grid-cols-[150px_1fr_auto] md:items-end">
                <CsrfField />
                <input type="hidden" name="id" value={settlement.id} />
                <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  調整金額
                  <input
                    name="adjustmentAmount"
                    type="number"
                    step="1"
                    defaultValue={settlement.adjustmentAmountCents / 100}
                    disabled={Boolean(settlement.lockedAt)}
                    className="h-10 rounded-md border border-border bg-white px-3 text-sm disabled:bg-slate-100"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  調整原因
                  <input
                    name="adjustmentReason"
                    defaultValue={settlement.adjustmentReason ?? ""}
                    disabled={Boolean(settlement.lockedAt)}
                    placeholder="例如：補扣退款手續費"
                    className="h-10 rounded-md border border-border bg-white px-3 text-sm disabled:bg-slate-100"
                  />
                </label>
                <button disabled={Boolean(settlement.lockedAt)} className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400">
                  儲存調整
                </button>
              </form>

              {!settlement.lockedAt ? (
                <form action={lockSettlementAction}>
                  <CsrfField />
                  <input type="hidden" name="id" value={settlement.id} />
                  <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
                    <ShieldCheck size={16} />
                    鎖定月結
                  </button>
                </form>
              ) : null}

              {settlement.lockedAt && !settlement.payoutBatchId && settlement.finalPayoutAmountCents > 0 ? (
                <form action={createPayoutBatchAction}>
                  <CsrfField />
                  <input type="hidden" name="settlementIds" value={settlement.id} />
                  <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-cta px-4 text-sm font-semibold text-white hover:bg-cta-dark">
                    <Banknote size={16} />
                    建立出款
                  </button>
                </form>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
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
