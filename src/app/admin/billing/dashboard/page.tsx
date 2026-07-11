import Link from "next/link";
import { AlertTriangle, Banknote, ReceiptText, RotateCcw, ShieldCheck, WalletCards } from "lucide-react";
import { refundPaymentTransactionAction, retryWebhookEventAction, voidAffiliateCommissionAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function sevenDaysAgo() {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date;
}

function statusTone(status: string) {
  if (status === "paid" || status === "approved") return "green" as const;
  if (status.includes("refund") || status === "failed" || status === "reversed") return "orange" as const;
  if (status === "locked" || status === "ready_for_payout") return "blue" as const;
  return "gray" as const;
}

export default async function AdminBillingDashboardPage() {
  await requirePlatformAdmin();
  const db = getDb();
  const start = sevenDaysAgo();
  const [subscriptions, unlockedSettlements, readySettlements, failedPayouts, recentTransactions, recentCommissions, webhookEvents, failedWebhookCount, auditLogs] = await Promise.all([
    db.vendorSubscription.findMany({ where: { status: "active" }, include: { plan: true, vendor: true } }),
    db.settlement.findMany({ where: { lockedAt: null }, include: { vendor: true }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.settlement.findMany({ where: { lockedAt: { not: null }, payoutBatchId: null, finalPayoutAmountCents: { gt: 0 } }, include: { vendor: true }, orderBy: { updatedAt: "desc" }, take: 8 }),
    db.payoutItem.findMany({ where: { status: "failed" }, include: { vendor: true, payoutBatch: true }, orderBy: { updatedAt: "desc" }, take: 8 }),
    db.paymentTransaction.findMany({ where: { occurredAt: { gte: start } }, include: { vendor: true, refunds: true }, orderBy: { occurredAt: "desc" }, take: 10 }),
    db.affiliateCommission.findMany({ where: { status: { in: ["pending", "approved"] } }, include: { vendor: true, affiliate: true }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.webhookEvent.findMany({ include: { vendor: true }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.webhookEvent.count({ where: { status: "failed" } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const mrr = subscriptions.reduce((sum, subscription) => sum + subscription.plan.monthlyPriceCents, 0);
  const pendingPayoutAmount = readySettlements.reduce((sum, settlement) => sum + settlement.finalPayoutAmountCents, 0);

  return (
    <>
      <PageHeader
        title="財務總覽"
        description="平台月費收入、月結狀態、出款異常、退款調整與稽核紀錄集中檢視。"
        action={<Link href="/admin/billing/settlements" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">月結管理</Link>}
      />

      <div data-testid="billing-kpis" className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <p className="flex items-center gap-2 text-sm font-medium text-slate-500"><ReceiptText size={16} />本月 MRR</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(mrr)}</p>
        </Card>
        <Card>
          <p className="flex items-center gap-2 text-sm font-medium text-slate-500"><ShieldCheck size={16} />待鎖單</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{unlockedSettlements.length}</p>
        </Card>
        <Card>
          <p className="flex items-center gap-2 text-sm font-medium text-slate-500"><Banknote size={16} />待出款金額</p>
          <p className="mt-2 text-3xl font-bold text-orange-700">{formatCurrency(pendingPayoutAmount)}</p>
        </Card>
        <Card>
          <p className="flex items-center gap-2 text-sm font-medium text-slate-500"><AlertTriangle size={16} />出款異常</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{failedPayouts.length}</p>
        </Card>
        <Card>
          <p className="flex items-center gap-2 text-sm font-medium text-slate-500"><AlertTriangle size={16} />Webhook 異常</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{failedWebhookCount}</p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-950">近 7 天金流交易</h2>
          </div>
          <div className="divide-y divide-border">
            {recentTransactions.map((transaction) => (
              <div key={transaction.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-950">{transaction.orderNumber ?? transaction.providerTradeNo ?? transaction.id}</p>
                    <Badge tone={statusTone(transaction.status)}>{transaction.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {transaction.vendor.name} · {formatDateTime(transaction.occurredAt)} · 已退 {formatCurrency(transaction.refundedAmountCents)}
                  </p>
                </div>
                <div className="min-w-[280px]">
                  <p className="text-right text-lg font-bold text-slate-950">{formatCurrency(transaction.grossAmountCents)}</p>
                  <form action={refundPaymentTransactionAction} className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3">
                    <CsrfField />
                    <input type="hidden" name="id" value={transaction.id} />
                    <input name="monthKey" type="month" defaultValue={new Date(transaction.occurredAt).toISOString().slice(0, 7)} className="h-9 rounded-md border border-border px-2 text-xs" />
                    <div className="grid grid-cols-3 gap-2">
                      <input name="refundAmount" type="number" step="1" placeholder="退款" className="h-9 rounded-md border border-border px-2 text-xs" />
                      <input name="gatewayFeeRefund" type="number" step="1" placeholder="退金流費" className="h-9 rounded-md border border-border px-2 text-xs" />
                      <input name="platformFeeRefund" type="number" step="1" placeholder="退平台費" className="h-9 rounded-md border border-border px-2 text-xs" />
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input name="reason" placeholder="退款原因" className="h-9 rounded-md border border-border px-2 text-xs" />
                      <button className="inline-flex h-9 items-center gap-1 rounded-md bg-orange-600 px-3 text-xs font-semibold text-white hover:bg-orange-700">
                        <RotateCcw size={13} />
                        退款
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-6">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">待處理月結</h2>
              <Link href="/admin/billing/settlements" className="text-sm font-semibold text-primary hover:underline">管理</Link>
            </div>
            <div className="grid gap-3">
              {[...unlockedSettlements, ...readySettlements].slice(0, 8).map((settlement) => (
                <div key={settlement.id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div>
                    <p className="font-semibold text-slate-950">{settlement.vendor.name}</p>
                    <p className="text-sm text-slate-500">{settlement.monthKey}</p>
                  </div>
                  <div className="text-right">
                    <Badge tone={statusTone(settlement.status)}>{settlement.status}</Badge>
                    <p className="mt-1 text-sm font-semibold">{formatCurrency(settlement.finalPayoutAmountCents)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-950">聯盟佣金調整</h2>
            <div className="mt-4 grid gap-3">
              {recentCommissions.map((commission) => (
                <div key={commission.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{commission.affiliate?.name ?? commission.referralCode ?? "未綁定推廣者"}</p>
                      <p className="mt-1 text-sm text-slate-500">{commission.vendor.name} · {commission.monthKey}</p>
                    </div>
                    <p className="font-bold text-slate-950">{formatCurrency(commission.commissionAmountCents)}</p>
                  </div>
                  <form action={voidAffiliateCommissionAction} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <CsrfField />
                    <input type="hidden" name="id" value={commission.id} />
                    <input name="reason" placeholder="作廢原因" className="h-9 rounded-md border border-border px-2 text-xs" />
                    <button className="h-9 rounded-md border border-orange-200 px-3 text-xs font-semibold text-orange-700 hover:bg-orange-50">作廢佣金</button>
                  </form>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-950">Webhook 事件監控</h2>
          <Link href="/admin/billing/webhooks" className="text-sm font-semibold text-primary hover:underline">完整對帳中心</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">商家</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">錯誤</th>
                <th className="px-4 py-3">時間</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {webhookEvents.map((event) => (
                <tr key={event.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-semibold text-slate-950">{event.provider}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/billing/webhooks/${event.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{event.eventId}</Link>
                    <p className="mt-1 text-xs text-slate-500">{event.eventType}</p>
                  </td>
                  <td className="px-4 py-3">{event.vendor?.name ?? "-"}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(event.status)}>{event.status}</Badge></td>
                  <td className="px-4 py-3 text-slate-500">
                    {event.errorMessage ?? "-"}
                    {event.nextRetryAt ? <p className="mt-1 text-xs">next {formatDateTime(event.nextRetryAt)}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(event.createdAt)}</td>
                  <td className="px-4 py-3">
                    {event.status === "failed" ? (
                      <form action={retryWebhookEventAction}>
                        <CsrfField />
                        <input type="hidden" name="id" value={event.id} />
                        <button className="h-9 rounded-md border border-border px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Retry</button>
                      </form>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <div className="mb-4 flex items-center gap-2">
          <WalletCards className="text-primary" size={18} />
          <h2 className="text-lg font-semibold text-slate-950">最近稽核紀錄</h2>
        </div>
        <div className="grid gap-2">
          {auditLogs.map((log) => (
            <div key={log.id} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-semibold text-slate-950">{log.action}</p>
                <p className="mt-1 text-sm text-slate-500">{log.targetType} · {log.targetId ?? "-"} · {log.actorLabel ?? "system"}</p>
              </div>
              <p className="text-sm text-slate-500">{formatDateTime(log.createdAt)}</p>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
