import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { calculateAnalyticsFunnel } from "@/lib/analytics-funnel";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function LiveAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendor();
  const { id } = await params;
  const db = getDb();
  const live = await db.live.findFirst({
    where: { id, vendorId: vendor.id },
    include: {
      affiliateClicks: true,
    },
  });
  if (!live) notFound();

  const trackedEventTypes = ["page_view", "product_click", "cta_click", "play_progress"];
  const [eventCounts, submissionCount, recentEvents] = await Promise.all([
    db.analyticsEvent.groupBy({
      by: ["eventType"],
      where: { vendorId: vendor.id, liveId: live.id, eventType: { in: trackedEventTypes } },
      _count: { _all: true },
    }),
    db.formSubmission.count({ where: { liveId: live.id } }),
    db.analyticsEvent.findMany({
      where: { vendorId: vendor.id, liveId: live.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  const eventCountByType = new Map(eventCounts.map((eventCount) => [eventCount.eventType, eventCount._count._all]));
  const pageViews = eventCountByType.get("page_view") ?? 0;
  const productClicks = eventCountByType.get("product_click") ?? 0;
  const ctaClicks = eventCountByType.get("cta_click") ?? 0;
  const progressEvents = eventCountByType.get("play_progress") ?? 0;
  const funnel = calculateAnalyticsFunnel({
    views: pageViews,
    productClicks,
    ctaClicks,
    submissions: submissionCount,
  });

  return (
    <>
      <PageHeader title={`${live.title} 分析`} description="MVP 先收事件流、核心 KPI 與轉換漏斗，後續可加 cohorts。" />
      <div className="grid gap-4 md:grid-cols-5">
        <Card><p className="text-sm text-slate-500">觀看</p><p className="mt-2 text-3xl font-semibold">{pageViews}</p></Card>
        <Card><p className="text-sm text-slate-500">名單</p><p className="mt-2 text-3xl font-semibold">{submissionCount}</p></Card>
        <Card><p className="text-sm text-slate-500">商品點擊</p><p className="mt-2 text-3xl font-semibold">{productClicks}</p></Card>
        <Card><p className="text-sm text-slate-500">CTA 點擊</p><p className="mt-2 text-3xl font-semibold">{ctaClicks}</p></Card>
        <Card><p className="text-sm text-slate-500">播放進度</p><p className="mt-2 text-3xl font-semibold">{progressEvents}</p></Card>
      </div>
      <section className="mt-6" aria-labelledby="conversion-funnel-title">
        <Card>
          <div className="mb-5">
            <h2 id="conversion-funnel-title" className="text-lg font-semibold text-slate-950">轉換漏斗</h2>
            <p className="mt-1 text-sm text-slate-500">各階段相對於觀看數的轉換比例。</p>
          </div>
          <ol className="grid gap-4 md:grid-cols-4">
            {funnel.map((step) => (
              <li
                key={step.key}
                aria-label={`${step.label}：${step.count}，相對觀看轉換率 ${step.percentage}%`}
                className="rounded-md border border-border bg-slate-50 p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-slate-700">{step.label}</span>
                  <span className="text-sm text-slate-500">{step.percentage}%</span>
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{step.count}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(step.percentage, 100)}%` }} />
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">最近事件</h2>
          <div className="grid gap-2">
            {recentEvents.length === 0 ? (
              <p role="status" className="text-sm text-slate-500">目前沒有最近事件。</p>
            ) : (
              recentEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                  <span className="flex items-center gap-2"><Badge tone="blue">{event.eventType}</Badge>{event.visitorId}</span>
                  <span className="text-slate-500">{formatDateTime(event.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">聯盟來源</h2>
          <div className="grid gap-2">
            {live.affiliateClicks.length === 0 ? (
              <p role="status" className="text-sm text-slate-500">目前沒有聯盟來源資料。</p>
            ) : (
              live.affiliateClicks.map((click) => (
                <div key={click.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-semibold text-slate-950">{click.referralCode ?? "unknown"}</p>
                  <p className="text-slate-500">{click.convertedAt ? "已轉換" : "尚未轉換"} · {formatDateTime(click.createdAt)}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
