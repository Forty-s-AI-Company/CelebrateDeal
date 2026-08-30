import { Card, PageHeader, Badge } from "@/components/ui";
import Link from "next/link";
import { requireVendorFinance } from "@/lib/auth";
import { calculateStreamUsageMinutes, monthRange } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { streamQuotaNotification } from "@/lib/stream-quota";

function UsageBar({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const hasLimit = limit > 0;
  const overage = hasLimit ? Math.max(0, used - limit) : 0;
  const percent = hasLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="text-slate-500">{used.toLocaleString()} / {limit.toLocaleString()} {unit}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-slate-400">
        {!hasLimit ? "未設定上限" : overage > 0 ? `已超額 ${overage.toLocaleString()} ${unit}` : `剩餘 ${(limit - used).toLocaleString()} ${unit}`}
      </p>
    </div>
  );
}

type StreamReconciliationSummary = {
  providerWatchMinutes: number;
  internalWatchMinutes: number;
  differenceMinutes: number;
  status: "MATCHED" | "MISMATCH" | "RESOLVED";
  evidenceKind: "ADMIN_ATTESTED_DIGEST";
  sourceDigest: string;
  resolution: "ACCEPT_INTERNAL" | "ACCEPT_PROVIDER" | "ESCALATED" | null;
  capturedAt: Date;
};

type StreamOperationsAlertSummary = {
  id: string;
  type: "QUOTA_WARNING" | "QUOTA_EXHAUSTED" | "PROVIDER_DISCREPANCY";
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  severity: "WARNING" | "CRITICAL";
  message: string;
  createdAt: Date;
};

function StreamReconciliationCard({ latest }: { latest: StreamReconciliationSummary | null }) {
  const badgeTone = latest?.status === "MATCHED" ? "green" : latest?.status === "RESOLVED" ? "blue" : "orange";

  return (
    <Card className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Stream provider 對帳</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Provider 月度摘要與 server-owned playback ledger 分開保存；已知差異必須由平台財務處理，不會直接改動你的帳單或自動扣款。
          </p>
        </div>
        {latest ? <Badge tone={badgeTone}>{latest.status}</Badge> : <Badge tone="gray">尚未匯入</Badge>}
      </div>
      {latest ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Provider</p>
            <p className="mt-1 font-semibold text-slate-950">{latest.providerWatchMinutes.toLocaleString()} 分鐘</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Internal ledger</p>
            <p className="mt-1 font-semibold text-slate-950">{latest.internalWatchMinutes.toLocaleString()} 分鐘</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">差異</p>
            <p className="mt-1 font-semibold text-slate-950">{latest.differenceMinutes > 0 ? "+" : ""}{latest.differenceMinutes.toLocaleString()} 分鐘</p>
          </div>
          <div className="md:col-span-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            證據等級：平台管理員核對的摘要雜湊（不是 provider 簽章）
            {" · "}SHA-256 {latest.sourceDigest.slice(0, 12)}…
            {" · "}{formatDateTime(latest.capturedAt)}
            {latest.resolution ? ` · 處理：${latest.resolution}` : ""}
          </div>
          {latest.status === "MISMATCH" ? (
            <p role="alert" className="md:col-span-3 rounded-md bg-orange-50 px-3 py-2 text-sm font-medium text-orange-900">
              Provider 與 internal ledger 尚有未處理差異；平台財務必須先完成 resolution，才能把這份證據用於月結判斷。
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-600">
          本月尚無 provider 對帳摘要。現在顯示的用量仍來自 immutable internal ledger；這不等同 Cloudflare 帳單已驗證。
        </p>
      )}
    </Card>
  );
}

function StreamOperationsAlertsCard({ alerts }: { alerts: StreamOperationsAlertSummary[] }) {
  if (alerts.length === 0) return null;

  return (
    <Card className="mt-6">
      <h2 className="text-lg font-semibold text-slate-950">需要處理的 Stream 通知</h2>
      <div className="mt-4 grid gap-3">
        {alerts.map((alert) => (
          <div key={alert.id} role={alert.severity === "CRITICAL" ? "alert" : "status"} className="rounded-md border border-orange-200 bg-orange-50 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={alert.severity === "CRITICAL" ? "orange" : "blue"}>{alert.type}</Badge>
              <span className="text-xs font-semibold text-orange-900">{alert.status}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-orange-950">{alert.message}</p>
            <p className="mt-1 text-xs text-orange-800">{formatDateTime(alert.createdAt)}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default async function BillingUsagePage() {
  const { vendor } = await requireVendorFinance("/billing/usage");
  const monthKey = new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(monthKey);
  const [limit, records, currentMonthRecords, streamUsageRecords, streamUsageLedgerEntries, streamUsageAllocationGroups, streamUsagePageGroups, subscription, transactions, refundPlatformFeeTotal, latestStreamReconciliation, streamOperationsAlerts] = await Promise.all([
    getDb().vendorUsageLimit.findUnique({ where: { vendorId: vendor.id }, include: { billingPlan: true } }),
    getDb().usageRecord.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    getDb().usageRecord.findMany({ where: { vendorId: vendor.id, monthKey }, orderBy: { createdAt: "desc" }, take: 20 }),
    getDb().usageRecord.findMany({
      where: { vendorId: vendor.id, monthKey },
      select: { recordType: true, quantity: true, totalWatchMinutes: true },
    }),
    getDb().streamUsageLedgerEntry.findMany({
      where: { vendorId: vendor.id, monthKey },
      select: { watchSeconds: true },
    }),
    getDb().streamUsageAllocationEntry.groupBy({
      by: ["recipientKey", "recipientType", "recipientTeamId", "recipientMembershipId"],
      where: { vendorId: vendor.id, monthKey },
      _sum: { allocatedWatchSeconds: true },
    }),
    getDb().streamUsageLedgerEntry.groupBy({
      by: ["sourcePageId"],
      where: { vendorId: vendor.id, monthKey },
      _sum: { watchSeconds: true },
    }),
    getDb().vendorSubscription.findFirst({ where: { vendorId: vendor.id, status: "active" }, include: { plan: true } }),
    getDb().paymentTransaction.findMany({
      where: {
        vendorId: vendor.id,
        status: { in: ["paid", "partially_refunded", "refunded"] },
        occurredAt: { gte: start, lt: end },
      },
      orderBy: { occurredAt: "desc" },
    }),
    getDb().refundRecord.aggregate({
      where: { vendorId: vendor.id, monthKey, status: "processed" },
      _sum: { platformFeeRefundCents: true },
    }),
    getDb().streamUsageReconciliation.findFirst({
      where: { vendorId: vendor.id, monthKey },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        provider: true,
        providerWatchMinutes: true,
        internalWatchMinutes: true,
        differenceMinutes: true,
        status: true,
        evidenceKind: true,
        sourceDigest: true,
        resolution: true,
        capturedAt: true,
        createdAt: true,
      },
    }),
    getDb().streamOperationsAlert.findMany({
      where: { vendorId: vendor.id, monthKey, status: { not: "RESOLVED" } },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: { id: true, type: true, status: true, severity: true, message: true, createdAt: true },
    }),
  ]);

  const memberIds = streamUsageAllocationGroups
    .map((group) => group.recipientMembershipId)
    .filter((membershipId): membershipId is string => Boolean(membershipId));
  const pageIds = streamUsagePageGroups
    .map((group) => group.sourcePageId)
    .filter((pageId): pageId is string => Boolean(pageId));
  const [memberships, pages] = await Promise.all([
    memberIds.length > 0
      ? getDb().teamMembership.findMany({
          where: { vendorId: vendor.id, id: { in: [...new Set(memberIds)] } },
          select: { id: true, vendorMember: { select: { user: { select: { name: true } } } } },
        })
      : Promise.resolve([]),
    pageIds.length > 0
      ? getDb().partnerFunnelPage.findMany({
          where: { vendorId: vendor.id, id: { in: [...new Set(pageIds)] } },
          select: { id: true, slug: true, headline: true },
        })
      : Promise.resolve([]),
  ]);
  const membershipNames = new Map(memberships.map((membership) => [membership.id, membership.vendorMember.user.name]));
  const pageLabels = new Map(pages.map((page) => [page.id, page.headline || page.slug]));
  const memberUsageRows = streamUsageAllocationGroups
    .map((group) => ({
      key: group.recipientKey,
      label: group.recipientMembershipId
        ? membershipNames.get(group.recipientMembershipId) ?? `成員 ${group.recipientMembershipId}`
        : "未歸屬成員",
      seconds: group._sum.allocatedWatchSeconds ?? 0,
    }))
    .filter((row) => row.seconds > 0)
    .sort((left, right) => right.seconds - left.seconds);
  const pageUsageRows = streamUsagePageGroups
    .map((group) => ({
      key: group.sourcePageId ?? "direct-playback",
      label: group.sourcePageId ? pageLabels.get(group.sourcePageId) ?? `推廣頁 ${group.sourcePageId}` : "直接播放（未指定推廣頁）",
      seconds: group._sum.watchSeconds ?? 0,
    }))
    .filter((row) => row.seconds > 0)
    .sort((left, right) => right.seconds - left.seconds);

  const currentUsageEvents = Math.max(0, ...currentMonthRecords.map((record) => record.totalEvents));
  const currentUsageStorageMinutes = Math.max(0, ...currentMonthRecords.map((record) => record.totalStorageMinutes));
  const streamMinutesUsed = Math.max(
    limit?.streamMinutesUsed ?? 0,
    calculateStreamUsageMinutes(
      streamUsageRecords,
      streamUsageLedgerEntries.reduce((sum, entry) => sum + entry.watchSeconds, 0),
    ),
  );
  const streamNotification = streamQuotaNotification({ used: streamMinutesUsed, limit: limit?.streamMinutesLimit ?? 0 });
  const storageMinutesUsed = Math.max(limit?.storageMinutesUsed ?? 0, currentUsageStorageMinutes);
  const grossRevenue = transactions.reduce(
    (sum, transaction) => sum + Math.max(0, transaction.grossAmountCents - transaction.refundedAmountCents),
    0,
  );
  const estimatedPlatformFees = Math.max(
    0,
    transactions.reduce((sum, transaction) => sum + transaction.platformFeeCents, 0) -
      (refundPlatformFeeTotal._sum.platformFeeRefundCents ?? 0),
  );

  return (
    <>
       <PageHeader title="用量與扣點" description="追蹤 Cloudflare Stream 播放、活動場次、推廣者、儲存分鐘與交易服務費估算；Stream 額度用完後會暫停新播放。" />
      <div className="mb-6 grid gap-4 lg:grid-cols-4">
        <Card className="bg-gradient-to-br from-white to-blue-50">
          <p className="text-sm font-medium text-slate-500">目前方案</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{subscription?.plan.name ?? limit?.billingPlan?.name ?? "未指定"}</p>
          <p className="mt-1 text-sm text-slate-500">{subscription?.paymentMode === "platform" ? "平台統一金流" : "自帶金流 / 未設定"}</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">本月活動場次</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{currentUsageEvents}</p>
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
          <Card>
            <UsageBar label="串流分鐘" used={streamMinutesUsed} limit={limit.streamMinutesLimit} unit="分鐘" />
            {streamNotification ? (
              <p role="status" className="mt-3 rounded-md bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800">
                {streamNotification}
              </p>
            ) : null}
          </Card>
          <Card><UsageBar label="儲存分鐘" used={storageMinutesUsed} limit={limit.storageMinutesLimit} unit="分鐘" /></Card>
          <Card><UsageBar label="點數" used={limit.creditsUsed} limit={limit.creditsLimit} unit="點" /></Card>
        </div>
      ) : null}
      {limit && limit.streamMinutesLimit > 0 && streamMinutesUsed >= limit.streamMinutesLimit ? (
        <Card className="mt-6 border-orange-200 bg-orange-50/70">
          <h2 className="text-lg font-semibold text-orange-950">Stream 額度已達上限</h2>
          <p className="mt-2 text-sm leading-6 text-orange-900">
            新播放已安全暫停；目前不會自動超額扣款。月結流程會依 server-owned 用量產生帳單，請到帳單頁查看並手動完成付款；若帳單尚未出現，請由財務管理者依月結流程處理。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/billing/invoices" className="inline-flex min-h-10 items-center justify-center rounded-md bg-orange-900 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800">
              查看帳單／手動付款
            </Link>
            <Link href="/billing/plans" className="inline-flex min-h-10 items-center justify-center rounded-md border border-orange-300 px-4 py-2 text-sm font-semibold text-orange-950 hover:bg-orange-100">
              查看方案與超額規則
            </Link>
          </div>
        </Card>
      ) : null}
      <StreamReconciliationCard latest={latestStreamReconciliation} />
      <StreamOperationsAlertsCard alerts={streamOperationsAlerts} />
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
      {memberUsageRows.length > 0 || pageUsageRows.length > 0 ? (
        <Card className="mt-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-950">Stream 歸屬用量</h2>
            <p className="mt-1 text-sm text-slate-500">
              本月 immutable ledger 的成員／推廣頁歸屬明細；上方 Stream 上限仍以商家 vendor aggregate enforce，這裡不表示每位成員已有獨立額度或自動扣款。
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">成員歸屬</h3>
              {memberUsageRows.length > 0 ? (
                <div className="grid gap-2">
                  {memberUsageRows.map((row) => (
                    <div key={row.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span className="text-slate-700">{row.label}</span>
                      <span className="font-semibold text-slate-950">{row.seconds.toLocaleString()} 秒（約 {Math.ceil(row.seconds / 60).toLocaleString()} 分鐘）</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-500">本月尚無成員歸屬資料。</p>}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">推廣頁歸屬</h3>
              {pageUsageRows.length > 0 ? (
                <div className="grid gap-2">
                  {pageUsageRows.map((row) => (
                    <div key={row.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span className="text-slate-700">{row.label}</span>
                      <span className="font-semibold text-slate-950">{row.seconds.toLocaleString()} 秒（約 {Math.ceil(row.seconds / 60).toLocaleString()} 分鐘）</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-500">本月尚無推廣頁歸屬資料。</p>}
            </div>
          </div>
        </Card>
      ) : null}
    </>
  );
}
