import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { calculateAnalyticsFunnel } from "@/lib/analytics-funnel";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { realViewerMessageWhere, scheduledMessageEventWhere } from "@/lib/live-chat-analytics";

export default async function LiveAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const db = getDb();
  const live = await db.live.findFirst({
    where: { id, vendorId: vendor.id },
    include: {
      affiliateClicks: true,
      interactionScript: { select: { id: true, vendorId: true, status: true } },
    },
  });
  if (!live) notFound();

  const trackedEventTypes = ["page_view", "product_click", "cta_click", "play_progress"];
  const validScriptId = live.interactionScript?.vendorId === vendor.id && live.interactionScript.status === "published"
    ? live.interactionScript.id
    : null;
  const [
    verifiedAnalyticsSessions,
    registrationCount,
    verifiedSubmissionCount,
    recentEvents,
    realViewerMessageCount,
    scheduledMessageCount,
    liveOrderCount,
    emailDeliveryStatusCounts,
  ] = await Promise.all([
    db.analyticsEvent.findMany({
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        trustLevel: "ADMITTED_LIVE_SESSION",
        eventType: { in: trackedEventTypes },
      },
      select: { eventType: true, visitorId: true },
      distinct: ["eventType", "visitorId"],
    }),
    db.formSubmission.count({ where: { liveId: live.id } }),
    db.formSubmission.count({ where: { liveId: live.id, verificationStatus: "VERIFIED" } }),
    db.analyticsEvent.findMany({
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        OR: [
          { trustLevel: "ADMITTED_LIVE_SESSION" },
          { trustLevel: "VERIFIED_FORM_SUBMISSION", eventType: "lead_submit" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.liveChatMessage.count({ where: realViewerMessageWhere({ vendorId: vendor.id, liveId: live.id }) }),
    validScriptId
      ? db.interactionEvent.count({ where: scheduledMessageEventWhere({ vendorId: vendor.id, scriptId: validScriptId }) })
      : Promise.resolve(0),
    // A checkout is counted only when the order's payment transaction has a
    // sourceLiveId derived on the server from a verified registration cookie.
    // Direct catalogue checkout must not be guessed into a live's results.
    db.paymentTransaction.count({
      where: {
        vendorId: vendor.id,
        primaryCommerceOrder: { isNot: null },
        metadata: { path: ["sourceLiveId"], equals: live.id },
      },
    }),
    db.emailDelivery.groupBy({
      by: ["status"],
      where: { vendorId: vendor.id, sourceLiveId: live.id },
      _count: { _all: true },
    }),
  ]);
  const eventCountByType = new Map<string, number>();
  for (const event of verifiedAnalyticsSessions) {
    eventCountByType.set(event.eventType, (eventCountByType.get(event.eventType) ?? 0) + 1);
  }
  const pageViews = eventCountByType.get("page_view") ?? 0;
  const productClicks = eventCountByType.get("product_click") ?? 0;
  const ctaClicks = eventCountByType.get("cta_click") ?? 0;
  const progressEvents = eventCountByType.get("play_progress") ?? 0;
  const emailDeliveryCounts = new Map(emailDeliveryStatusCounts.map((entry) => [entry.status, entry._count._all]));
  const emailSentCount = emailDeliveryCounts.get("sent") ?? 0;
  const emailFailedCount = (emailDeliveryCounts.get("failed") ?? 0) + (emailDeliveryCounts.get("exhausted") ?? 0);
  const funnel = calculateAnalyticsFunnel({
    views: pageViews,
    productClicks,
    ctaClicks,
    submissions: verifiedSubmissionCount,
  });

  return (
    <>
      <PageHeader
        title={`${live.title} 分析`}
        description="觀看與點擊只計入已通過直播 admission 的不重複播放 session；真實留言與排程腳本分開統計。"
        action={<ButtonLink href={`/lives/${live.id}/analytics/messages/export`} tone="secondary">匯出留言 CSV</ButtonLink>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card><p className="text-sm text-slate-500">播放 session</p><p className="mt-2 text-3xl font-semibold">{pageViews}</p></Card>
        <Card><p className="text-sm text-slate-500">報名</p><p className="mt-2 text-3xl font-semibold">{registrationCount}</p></Card>
        <Card><p className="text-sm text-slate-500">Email 已驗證</p><p className="mt-2 text-3xl font-semibold">{verifiedSubmissionCount}</p></Card>
        <Card><p className="text-sm text-slate-500">商品點擊</p><p className="mt-2 text-3xl font-semibold">{productClicks}</p></Card>
        <Card><p className="text-sm text-slate-500">CTA 點擊</p><p className="mt-2 text-3xl font-semibold">{ctaClicks}</p></Card>
        <Card><p className="text-sm text-slate-500">播放進度</p><p className="mt-2 text-3xl font-semibold">{progressEvents}</p></Card>
        <Card><p className="text-sm text-slate-500">真實觀眾留言</p><p className="mt-2 text-3xl font-semibold">{realViewerMessageCount}</p><p className="mt-1 text-xs text-slate-500">只計已驗證觀眾可見留言</p></Card>
        <Card><p className="text-sm text-slate-500">建立待付款訂單</p><p className="mt-2 text-3xl font-semibold">{liveOrderCount}</p><p className="mt-1 text-xs text-slate-500">只計直播來源已驗證報名</p></Card>
        <Card><p className="text-sm text-slate-500">Email 成功</p><p className="mt-2 text-3xl font-semibold">{emailSentCount}</p></Card>
        <Card><p className="text-sm text-slate-500">Email 失敗</p><p className="mt-2 text-3xl font-semibold">{emailFailedCount}</p><p className="mt-1 text-xs text-slate-500">含重試耗盡</p></Card>
        <Card><p className="text-sm text-slate-500">排程留言腳本</p><p className="mt-2 text-3xl font-semibold">{scheduledMessageCount}</p><p className="mt-1 text-xs text-slate-500">設定數，不列入轉換率</p></Card>
      </div>
      <section className="mt-6" aria-labelledby="conversion-funnel-title">
        <Card>
          <div className="mb-5">
            <h2 id="conversion-funnel-title" className="text-lg font-semibold text-slate-950">轉換漏斗</h2>
            <p className="mt-1 text-sm text-slate-500">各階段相對於已 admission 播放 session 的比例；名單只計完成 Email 驗證的報名。</p>
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
                  <span className="flex items-center gap-2"><Badge tone="blue">{event.eventType}</Badge>{event.trustLevel === "VERIFIED_FORM_SUBMISSION" ? "verified lead" : "session"} {event.visitorId.slice(0, 12)}…</span>
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
