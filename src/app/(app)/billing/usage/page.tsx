import { Card, PageHeader, Badge } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { monthRange } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function UsageBar({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="text-slate-500">{used.toLocaleString()} / {limit.toLocaleString()} {unit}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-slate-400">剩餘 {(limit - used).toLocaleString()} {unit}</p>
    </div>
  );
}

export default async function BillingUsagePage() {
  const vendor = await requireVendor();
  const monthKey = new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(monthKey);
  const [limit, records, currentMonthRecords, subscription, transactions] = await Promise.all([
    getDb().vendorUsageLimit.findUnique({ where: { vendorId: vendor.id }, include: { billingPlan: true } }),
    getDb().usageRecord.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    getDb().usageRecord.findMany({ where: { vendorId: vendor.id, monthKey }, orderBy: { createdAt: "desc" }, take: 1 }),
    getDb().vendorSubscription.findFirst({ where: { vendorId: vendor.id, status: "active" }, include: { plan: true } }),
    getDb().paymentTransaction.findMany({
      where: {
        vendorId: vendor.id,
        status: { in: ["paid", "partially_refunded", "refunded"] },
        occurredAt: { gte: start, lt: end },
      },
      orderBy: { occurredAt: "desc" },
    }),
  ]);

  const currentRecord = currentMonthRecords[0];
  const grossRevenue = transactions.reduce((sum, transaction) => sum + transaction.grossAmountCents, 0);
  const estimatedPlatformFees = transactions.reduce((sum, transaction) => sum + transaction.platformFeeCents, 0);

  return (
    <>
      <PageHeader title="用量與扣點" description="追蹤 Cloudflare Stream 播放、活動場次、推廣者、儲存分鐘與交易服務費估算。" />
      <div className="mb-6 grid gap-4 lg:grid-cols-4">
        <Card className="bg-gradient-to-br from-white to-blue-50">
          <p className="text-sm font-medium text-slate-500">目前方案</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{subscription?.plan.name ?? limit?.billingPlan?.name ?? "未指定"}</p>
          <p className="mt-1 text-sm text-slate-500">{subscription?.paymentMode === "platform" ? "平台統一金流" : "自帶金流 / 未設定"}</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">本月活動場次</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{currentRecord?.totalEvents ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">本月成交額</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(grossRevenue)}</p>
        </Card>
        <Card className="bg-gradient-to-br from-white to-orange-50">
          <p className="text-sm font-medium text-slate-500">預估交易服務費</p>
          <p className="mt-2 text-3xl font-bold text-orange-700">{formatCurrency(estimatedPlatformFees)}</p>
        </Card>
      </div>
      {limit ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card><UsageBar label="串流分鐘" used={limit.streamMinutesUsed} limit={limit.streamMinutesLimit} unit="分鐘" /></Card>
          <Card><UsageBar label="儲存分鐘" used={limit.storageMinutesUsed} limit={limit.storageMinutesLimit} unit="分鐘" /></Card>
          <Card><UsageBar label="點數" used={limit.creditsUsed} limit={limit.creditsLimit} unit="點" /></Card>
        </div>
      ) : null}
      <Card className="mt-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-950">用量紀錄</h2>
          {limit?.billingPlan ? <Badge tone="blue">{limit.billingPlan.name}</Badge> : null}
        </div>
        <div className="grid gap-2">
          {records.map((record) => (
            <div key={record.id} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-medium text-slate-950">{record.description ?? record.recordType}</p>
                <p className="text-sm text-slate-500">
                  {record.quantity.toLocaleString()} {record.unit} · {record.creditsDelta} 點
                  {record.monthKey ? ` · ${record.monthKey}` : ""}
                </p>
              </div>
              <span className="text-sm text-slate-500">{formatDateTime(record.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
