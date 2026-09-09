import {
  ArrowDown,
  CheckCircle2,
  ChevronRight,
  MailCheck,
  MessageCircle,
  MousePointerClick,
  Radio,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui";
import { calculateAnalyticsFunnel } from "@/lib/analytics-funnel";
import { getDb } from "@/lib/db";
import {
  createDashboardMeasurement,
  dashboardMeasurementAttributes,
  emitDashboardMeasurement,
  readDashboardAnalyticsCounts,
  readDashboardEmailCounts,
  readDashboardRegistrationCounts,
} from "@/lib/dashboard-read-model";
import { realViewerMessageWhere, scheduledMessageEventWhere } from "@/lib/live-chat-analytics";

function getDateDaysAgo(days: number) {
  return new Date(Date.now() - 1000 * 60 * 60 * 24 * days);
}

type DashboardKpiData = {
  registrationCount: number;
  verifiedRegistrationCount: number;
  viewerMessageCount: number;
  scheduledMessageCount: number;
  orderCreatedCount: number;
  emailSentCount: number;
  emailFailedCount: number;
  viewCount: number;
  productClicks: number;
  funnel: ReturnType<typeof calculateAnalyticsFunnel>;
};

type DashboardKpiLoadResult = {
  data: DashboardKpiData | null;
  measurement: ReturnType<typeof createDashboardMeasurement>;
};

async function loadDashboardKpis(vendorId: string, diagnosticFailureScope: string | null): Promise<DashboardKpiLoadResult> {
  const db = getDb();
  const measurement = createDashboardMeasurement();
  const sevenDaysAgo = getDateDaysAgo(7);

  try {
    const registrationCounts = await measurement.measure("registration.grouped-count", () => readDashboardRegistrationCounts(db, vendorId, sevenDaysAgo));
    const viewerMessageCount = await measurement.measure("viewer-message.count", () => db.liveChatMessage.count({ where: realViewerMessageWhere({ vendorId, createdAtGte: sevenDaysAgo }) }));
    const scheduledMessageCount = await measurement.measure("scheduled-message.count", () => db.interactionEvent.count({ where: scheduledMessageEventWhere({ vendorId }) }));
    if (diagnosticFailureScope === "analytics") throw new Error("dashboard_diagnostic_analytics_failure");
    const analyticsCounts = await measurement.measure("analytics.aggregate", () => readDashboardAnalyticsCounts(db, vendorId, sevenDaysAgo));
    const orderCreatedCount = await measurement.measure("order.count", () => db.commerceOrder.count({ where: { vendorId, createdAt: { gte: sevenDaysAgo } } }));
    const emailCounts = await measurement.measure("email.grouped-count", () => readDashboardEmailCounts(db, vendorId, sevenDaysAgo));
    const funnel = calculateAnalyticsFunnel({
      views: analyticsCounts.views,
      productClicks: analyticsCounts.productClicks,
      ctaClicks: analyticsCounts.ctaClicks,
      submissions: registrationCounts.verified,
    });

    return {
      measurement,
      data: {
        registrationCount: registrationCounts.total,
        verifiedRegistrationCount: registrationCounts.verified,
        viewerMessageCount,
        scheduledMessageCount,
        orderCreatedCount,
        emailSentCount: emailCounts.sent,
        emailFailedCount: emailCounts.failed,
        viewCount: analyticsCounts.views,
        productClicks: analyticsCounts.productClicks,
        funnel,
      },
    };
  } catch {
    return { measurement, data: null };
  }
}

function DashboardMetricError() {
  return (
    <section role="alert" className="rounded-xl border border-orange-200 bg-orange-50 p-5 text-sm text-orange-900">
      Dashboard KPI 暫時無法載入，明細資料不會因此重新送出。請稍後重新整理。
    </section>
  );
}

function DashboardKpiContent({ data }: { data: DashboardKpiData }) {
  const conversionRate = data.viewCount > 0
    ? Math.round((data.verifiedRegistrationCount / data.viewCount) * 1000) / 10
    : 0;
  const percentageOfViews = (count: number) => data.viewCount > 0
    ? Math.round((count / data.viewCount) * 1000) / 10
    : 0;
  const dropOffFrom = (previousCount: number, currentCount: number) => previousCount > 0
    ? Math.max(0, Math.round(((previousCount - currentCount) / previousCount) * 1000) / 10)
    : 0;
  const compactNumber = new Intl.NumberFormat("zh-TW").format;
  const surfaceClass = "rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all duration-200 hover:border-slate-300 hover:shadow-sm";
  const secondaryKpis = [
    {
      label: "商品點擊",
      value: compactNumber(data.productClicks),
      detail: `觀看觸發 ${percentageOfViews(data.productClicks)}%`,
      icon: MousePointerClick,
      positive: data.productClicks > 0,
    },
    {
      label: "訂單建立",
      value: compactNumber(data.orderCreatedCount),
      detail: `點擊轉單 ${data.productClicks > 0 ? Math.round((data.orderCreatedCount / data.productClicks) * 1000) / 10 : 0}%`,
      icon: ShoppingBag,
      positive: data.orderCreatedCount > 0,
    },
    {
      label: "真實留言",
      value: compactNumber(data.viewerMessageCount),
      detail: `${compactNumber(data.scheduledMessageCount)} 組排程腳本`,
      icon: MessageCircle,
      positive: data.viewerMessageCount > 0,
    },
    {
      label: "Email 狀態",
      value: compactNumber(data.emailSentCount),
      detail: data.emailFailedCount > 0 ? `${compactNumber(data.emailFailedCount)} 封失敗` : "全數正常送達",
      icon: MailCheck,
      positive: data.emailFailedCount === 0,
    },
  ] as const;
  const funnelSteps = [
    { key: "views", eyebrow: "流量連線", label: "播放 Session", count: data.funnel[0]?.count ?? data.viewCount, percentage: 100, dropOff: 0, offset: "lg:mt-0" },
    { key: "productClicks", eyebrow: "興趣觸發", label: "商品點擊", count: data.funnel[1]?.count ?? data.productClicks, percentage: percentageOfViews(data.productClicks), dropOff: dropOffFrom(data.viewCount, data.productClicks), offset: "lg:mt-3" },
    { key: "registrations", eyebrow: "名單鎖定", label: "活動報名填表", count: data.registrationCount, percentage: percentageOfViews(data.registrationCount), dropOff: dropOffFrom(data.productClicks, data.registrationCount), offset: "lg:mt-6" },
    { key: "verified", eyebrow: "最終成交／驗證", label: "Email 驗證名單", count: data.funnel[3]?.count ?? data.verifiedRegistrationCount, percentage: conversionRate, dropOff: dropOffFrom(data.registrationCount, data.verifiedRegistrationCount), offset: "lg:mt-9" },
  ] as const;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <section className={`${surfaceClass} relative overflow-hidden md:col-span-2`} aria-label="直播即時戰情">
          <Radio className="pointer-events-none absolute -right-4 -top-5 size-32 text-blue-700 opacity-10" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              直播連線中
            </div>
            <div className="mt-7 grid gap-6 sm:grid-cols-2 sm:divide-x sm:divide-slate-200">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">近 7 天播放 Session</p>
                <p className="mt-2 font-mono text-4xl font-bold tabular-nums tracking-tight text-slate-950">{compactNumber(data.viewCount)}</p>
                <p className="mt-2 text-sm text-slate-500">已通過直播 admission 的不重複連線</p>
              </div>
              <div className="sm:pl-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">已驗證報名轉換率</p>
                <p className="mt-2 font-mono text-4xl font-bold tabular-nums tracking-tight text-slate-950">{conversionRate}%</p>
                <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-200/60 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  <TrendingUp className="size-3" aria-hidden="true" />
                  {compactNumber(data.verifiedRegistrationCount)} 筆有效名單
                </span>
              </div>
            </div>
          </div>
        </section>

        {secondaryKpis.map((kpi) => (
          <section key={kpi.label} className={`${surfaceClass} relative min-h-44 overflow-hidden`}>
            <kpi.icon className="absolute right-4 top-4 size-12 text-slate-700 opacity-10" aria-hidden="true" />
            <p className="relative text-xs font-semibold uppercase tracking-wider text-slate-500">{kpi.label}</p>
            <p className="relative mt-5 font-mono text-3xl font-bold tabular-nums tracking-tight text-slate-950">{kpi.value}</p>
            <span className={`relative mt-4 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${kpi.positive ? "border-emerald-200/60 bg-emerald-50 text-emerald-700" : "border-rose-200/60 bg-rose-50 text-rose-700"}`}>
              {kpi.positive ? <TrendingUp className="size-3" aria-hidden="true" /> : <ArrowDown className="size-3" aria-hidden="true" />}
              {kpi.detail}
            </span>
          </section>
        ))}
      </div>
      <section className="mt-6" aria-labelledby="dashboard-conversion-funnel-title">
        <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Live conversion flow</p>
              <h2 id="dashboard-conversion-funnel-title" className="mt-1 text-lg font-semibold text-slate-950">近 7 天階梯轉換漏斗</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">觀看與點擊只計入已通過直播 admission 的不重複播放 session；最終名單只計完成 Email 驗證的正式報名。</p>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden="true" />
              數據即時同步
            </span>
          </div>
          <ol className="grid items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:pb-9">
            {funnelSteps.map((step, index) => (
              <li key={step.key} className="contents">
                <article
                  aria-label={`${step.label}：${step.count}，相對觀看轉換率 ${step.percentage}%，流失率 ${step.dropOff}%`}
                  className={`${step.offset} rounded-xl border p-4 ${index === funnelSteps.length - 1 ? "border-indigo-200 bg-indigo-50/60" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">{String(index + 1).padStart(2, "0")} · {step.eyebrow}</p>
                      <h3 className="mt-1 text-sm font-semibold text-slate-800">{step.label}</h3>
                    </div>
                    <span className="font-mono text-xs font-semibold tabular-nums text-slate-500">{step.percentage}%</span>
                  </div>
                  <p className="mt-5 font-mono text-2xl font-bold tabular-nums tracking-tight text-slate-950">{compactNumber(step.count)}</p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200/80" aria-hidden="true">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 shadow-[0_0_10px_rgba(79,70,229,0.35)]" style={{ width: `${Math.min(step.percentage, 100)}%` }} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">相對觀看</span>
                    {index === 0 ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">流量基準</span>
                    ) : (
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${step.dropOff >= 50 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>流失 {step.dropOff}%</span>
                    )}
                  </div>
                </article>
                {index < funnelSteps.length - 1 ? (
                  <div className="flex items-center justify-center py-1 text-slate-300" aria-hidden="true">
                    <ArrowDown className="size-4 lg:hidden" />
                    <ChevronRight className="hidden size-5 lg:block" />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </>
  );
}

export default async function DashboardKpis({ vendorId, diagnosticFailureScope = null }: { vendorId: string; diagnosticFailureScope?: string | null }) {
  const result = await loadDashboardKpis(vendorId, diagnosticFailureScope);
  const measurement = result.measurement.snapshot();
  emitDashboardMeasurement("kpis", measurement);
  return (
    <div data-dashboard-scope="kpis" {...dashboardMeasurementAttributes(measurement)}>
      {result.data ? <DashboardKpiContent data={result.data} /> : <DashboardMetricError />}
    </div>
  );
}
