import { Badge, Card } from "@/components/ui";
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
  const kpis = [
    { label: "近 7 天播放 session", value: data.viewCount, tone: "blue" },
    { label: "近 7 天報名", value: data.registrationCount, tone: "green" },
    { label: "完成 Email 驗證", value: data.verifiedRegistrationCount, tone: "green" },
    { label: "商品點擊", value: data.productClicks, tone: "orange" },
    { label: "近 7 天訂單建立", value: data.orderCreatedCount, tone: "orange" },
    { label: "Email 寄送成功", value: data.emailSentCount, tone: "green" },
    { label: "Email 寄送失敗", value: data.emailFailedCount, tone: "orange" },
    { label: "已驗證報名／觀看", value: `${conversionRate}%`, tone: "gray" },
    { label: "近 7 天真實留言", value: data.viewerMessageCount, tone: "green" },
    { label: "排程留言腳本（設定數）", value: data.scheduledMessageCount, tone: "gray" },
  ] as const;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <p className="text-sm text-slate-500">{kpi.label}</p>
            <p className="mt-3 text-3xl font-semibold text-slate-950">{kpi.value}</p>
            <div className="mt-4"><Badge tone={kpi.tone}>{kpi.label}</Badge></div>
          </Card>
        ))}
      </div>
      <section className="mt-6" aria-labelledby="dashboard-conversion-funnel-title">
        <Card>
          <div className="mb-5">
            <h2 id="dashboard-conversion-funnel-title" className="text-lg font-semibold text-slate-950">近 7 天轉換漏斗</h2>
            <p className="mt-1 text-sm text-slate-500">觀看與點擊只計入已通過直播 admission 的不重複播放 session；報名只計完成 Email 驗證的正式名單。</p>
          </div>
          <ol className="grid gap-4 md:grid-cols-4">
            {data.funnel.map((step) => (
              <li key={step.key} aria-label={`${step.label}：${step.count}，相對觀看轉換率 ${step.percentage}%`} className="rounded-md border border-border bg-slate-50 p-4">
                <div className="flex items-baseline justify-between gap-3"><span className="font-medium text-slate-700">{step.label}</span><span className="text-sm text-slate-500">{step.percentage}%</span></div>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{step.count}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(step.percentage, 100)}%` }} /></div>
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
