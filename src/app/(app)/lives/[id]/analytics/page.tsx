import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { calculateAnalyticsFunnel } from "@/lib/analytics-funnel";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { realViewerMessageWhere, scheduledMessageEventWhere } from "@/lib/live-chat-analytics";
import {
  conversionRate,
  interactionCountsByRun,
  loadLiveAffiliateAttribution,
  maskedQuestionAuthor,
  pollAnalytics,
} from "@/lib/live-engagement-analytics";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatTwd(cents: number) {
  return `NT$${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(cents / 100)}`;
}

export default async function LiveAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const db = getDb();
  const live = await db.live.findFirst({
    where: { id, vendorId: vendor.id },
    include: {
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
    interactionRuns,
    interactionResponseCounts,
    interactionConversionCounts,
    luckyDrawWinners,
    questionStatusCounts,
    spotlightQuestions,
    liveViewerSessions,
    replayViewerSessions,
    liveCommerce,
    replayCommerce,
    affiliateAttribution,
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
    db.formSubmission.count({ where: { liveId: live.id, form: { vendorId: vendor.id } } }),
    db.formSubmission.count({ where: { liveId: live.id, verificationStatus: "VERIFIED", form: { vendorId: vendor.id } } }),
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
    db.liveInteractionRun.findMany({
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        eventType: { in: ["poll", "lucky_draw", "flash_sale", "flash_voucher"] },
      },
      select: {
        id: true,
        eventType: true,
        title: true,
        configuration: true,
        winnerResponseId: true,
        startsAt: true,
      },
      orderBy: { startsAt: "asc" },
    }),
    db.liveInteractionResponse.groupBy({
      by: ["runId", "value"],
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        eventType: { in: ["poll", "lucky_draw", "flash_sale", "flash_voucher"] },
      },
      _count: { _all: true },
    }),
    db.liveInteractionResponse.groupBy({
      by: ["runId", "eventType"],
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        eventType: { in: ["flash_sale", "flash_voucher"] },
        usedOrderId: { not: null },
      },
      _count: { _all: true },
    }),
    db.liveInteractionResponse.findMany({
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        run: { eventType: "lucky_draw", winnerResponseId: { not: null } },
        claimTokenHash: { not: null },
      },
      select: { id: true, displayName: true, winnerClaimedAt: true },
    }),
    db.liveQuestion.groupBy({
      by: ["status"],
      where: { vendorId: vendor.id, liveId: live.id },
      _count: { _all: true },
    }),
    db.liveQuestion.findMany({
      where: { vendorId: vendor.id, liveId: live.id, spotlightedAt: { not: null } },
      select: { id: true, body: true, displayName: true, status: true },
      orderBy: { spotlightedAt: "desc" },
      take: 50,
    }),
    db.analyticsEvent.findMany({
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        trustLevel: "ADMITTED_LIVE_SESSION",
        eventType: "page_view",
        ...(live.endedAt ? { createdAt: { lt: live.endedAt } } : {}),
      },
      select: { visitorId: true },
      distinct: ["visitorId"],
    }),
    live.endedAt ? db.analyticsEvent.findMany({
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        trustLevel: "ADMITTED_LIVE_SESSION",
        eventType: "page_view",
        createdAt: { gte: live.endedAt },
      },
      select: { visitorId: true },
      distinct: ["visitorId"],
    }) : Promise.resolve([]),
    db.paymentTransaction.aggregate({
      where: {
        vendorId: vendor.id,
        status: "paid",
        primaryCommerceOrder: { isNot: null },
        metadata: { path: ["sourceLiveId"], equals: live.id },
        ...(live.endedAt ? { occurredAt: { lt: live.endedAt } } : {}),
      },
      _count: { _all: true },
      _sum: { grossAmountCents: true },
    }),
    live.endedAt ? db.paymentTransaction.aggregate({
      where: {
        vendorId: vendor.id,
        status: "paid",
        primaryCommerceOrder: { isNot: null },
        metadata: { path: ["sourceLiveId"], equals: live.id },
        occurredAt: { gte: live.endedAt },
      },
      _count: { _all: true },
      _sum: { grossAmountCents: true },
    }) : Promise.resolve({ _count: { _all: 0 }, _sum: { grossAmountCents: null } }),
    loadLiveAffiliateAttribution(db, { vendorId: vendor.id, liveId: live.id }),
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
  const countsByRun = interactionCountsByRun(interactionResponseCounts);
  const conversionCountsByRun = new Map(interactionConversionCounts.map((row) => [row.runId, row._count._all]));
  // Flash-sale clicks do not issue a voucher claim. Count paid orders for the
  // run's server-owned product instead of incorrectly treating clicks as sales.
  const flashSaleOrderCounts = await Promise.all(interactionRuns
    .filter((run) => run.eventType === "flash_sale")
    .map(async (run) => {
      const productId = record(run.configuration).productId;
      if (typeof productId !== "string" || !productId) return [run.id, 0] as const;
      const count = await db.paymentTransaction.count({
        where: {
          vendorId: vendor.id,
          status: "paid",
          metadata: { path: ["sourceLiveId"], equals: live.id },
          primaryCommerceOrder: {
            is: {
              vendorId: vendor.id,
              status: "paid",
              items: { some: { productId, product: { vendorId: vendor.id } } },
            },
          },
        },
      });
      return [run.id, count] as const;
    }));
  for (const [runId, count] of flashSaleOrderCounts) conversionCountsByRun.set(runId, count);
  const winnerById = new Map(luckyDrawWinners.map((winner) => [winner.id, winner]));
  const questionCounts = new Map(questionStatusCounts.map((row) => [row.status, row._count._all]));
  const questionTotal = [...questionCounts.values()].reduce((sum, count) => sum + count, 0);
  const exposureCount = new Set([...liveViewerSessions, ...replayViewerSessions].map((session) => session.visitorId)).size;

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
      <section className="mt-6" aria-labelledby="live-replay-title">
        <Card>
          <h2 id="live-replay-title" className="text-lg font-semibold text-slate-950">直播現場 vs 回放長尾</h2>
          <p className="mt-1 text-sm text-slate-500">以直播實際結束時間切分已驗證觀看與付費交易；直播尚未結束時，回放數據為 0。</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <ComparisonCard label="觀看人次" live={liveViewerSessions.length} replay={replayViewerSessions.length} />
            <ComparisonCard label="付費訂單" live={liveCommerce._count._all} replay={replayCommerce._count._all} />
            <ComparisonCard label="營收" live={formatTwd(liveCommerce._sum.grossAmountCents ?? 0)} replay={formatTwd(replayCommerce._sum.grossAmountCents ?? 0)} />
          </div>
        </Card>
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2" aria-label="直播互動成效">
        <Card>
          <h2 className="text-lg font-semibold text-slate-950">即時投票分析</h2>
          <div className="mt-4 grid gap-4">
            {interactionRuns.filter((run) => run.eventType === "poll").map((run) => {
              const analytics = pollAnalytics(run, countsByRun.get(run.id) ?? new Map());
              return <article key={run.id} className="rounded-lg border border-border p-4">
                <h3 className="font-semibold text-slate-900">{analytics.question}</h3>
                <p className="mt-1 text-sm text-slate-500">總投票人次 {analytics.totalVotes}</p>
                <div className="mt-4 grid gap-3">{analytics.choices.map((choice) => <div key={choice.id}>
                  <div className="flex justify-between gap-3 text-sm"><span>{choice.label}</span><span>{choice.votes} 票 · {choice.percentage}%</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true"><div className="h-full rounded-full bg-violet-600" style={{ width: `${choice.percentage}%` }} /></div>
                </div>)}</div>
              </article>;
            })}
            {interactionRuns.every((run) => run.eventType !== "poll") ? <p className="text-sm text-slate-500">本場尚無投票資料。</p> : null}
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-950">幸運抽獎成效</h2>
          <p className="mt-1 text-sm text-slate-500">抽獎場次 {interactionRuns.filter((run) => run.eventType === "lucky_draw").length}</p>
          <div className="mt-4 grid gap-3">{interactionRuns.filter((run) => run.eventType === "lucky_draw").map((run) => {
            const winner = run.winnerResponseId ? winnerById.get(run.winnerResponseId) : null;
            const entrants = [...(countsByRun.get(run.id)?.values() ?? [])].reduce((sum, count) => sum + count, 0);
            return <article key={run.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-slate-900">{run.title}</h3><Badge tone={winner?.winnerClaimedAt ? "green" : "orange"}>{winner?.winnerClaimedAt ? "已兌換" : "待核銷"}</Badge></div>
              <p className="mt-2 text-sm text-slate-600">總登記／留言 {entrants} 人 · 獎品：{String(record(run.configuration).prizeName ?? run.title)}</p>
              <p className="mt-1 text-sm text-slate-600">中獎者：{winner ? maskedQuestionAuthor(winner.displayName) : "尚未抽出"} · 8 碼核銷碼已安全發放</p>
            </article>;
          })}</div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-950">限時促購轉換漏斗</h2>
          <p className="mt-1 text-sm text-slate-500">曝險以本場已驗證不重複觀看者估算；領取與成交使用伺服器端互動紀錄。</p>
          <div className="mt-4 grid gap-3">{interactionRuns.filter((run) => ["flash_sale", "flash_voucher"].includes(run.eventType)).map((run) => {
            const claims = [...(countsByRun.get(run.id)?.values() ?? [])].reduce((sum, count) => sum + count, 0);
            const orders = conversionCountsByRun.get(run.id) ?? 0;
            return <article key={run.id} className="rounded-lg border border-border p-4">
              <h3 className="font-semibold text-slate-900">{run.title}</h3>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm"><div><strong className="block text-xl">{exposureCount}</strong>曝險</div><div><strong className="block text-xl">{claims}</strong>一鍵領取</div><div><strong className="block text-xl">{orders}</strong>付費下單</div></div>
              <p className="mt-3 text-sm text-slate-600">領取到轉換 CVR：{conversionRate(orders, claims)}%</p>
            </article>;
          })}</div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-950">問答精選回顧</h2>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm"><div><strong className="block text-2xl">{questionTotal}</strong>總提問</div><div><strong className="block text-2xl">{questionCounts.get("answered") ?? 0}</strong>已解答</div><div><strong className="block text-2xl">{questionCounts.get("hidden") ?? 0}</strong>已隱藏</div></div>
          <div className="mt-4 grid gap-2">{spotlightQuestions.map((question) => <article key={question.id} className="rounded-lg border border-border p-3 text-sm"><p>{question.body}</p><p className="mt-1 text-slate-500">{maskedQuestionAuthor(question.displayName)} · {question.status === "answered" ? "已解答" : "精選上牆"}</p></article>)}</div>
        </Card>
      </section>
      <section className="mt-6" aria-labelledby="affiliate-attribution-title">
        <Card>
          <h2 id="affiliate-attribution-title" className="text-lg font-semibold text-slate-950">推廣團隊與分銷夥伴貢獻榜</h2>
          <p className="mt-1 text-sm text-slate-500">只統計本場直播、目前商家的點擊、報名與伺服器歸因訂單。</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-border text-slate-500"><th className="p-2">推廣夥伴</th><th className="p-2">專屬點擊</th><th className="p-2">報名</th><th className="p-2">成交訂單</th><th className="p-2">貢獻金額</th><th className="p-2">轉換率</th><th className="p-2">對帳狀態</th></tr></thead>
              <tbody>{affiliateAttribution.map((row) => <tr key={row.attributionKey} className="border-b border-border last:border-0"><td className="p-2 font-medium text-slate-900">{row.name}</td><td className="p-2">{row.clicks}</td><td className="p-2">{row.registrations}</td><td className="p-2">{row.confirmedOrders}</td><td className="p-2">{formatTwd(row.confirmedGrossCents)}</td><td className="p-2">{row.conversionRate}%</td><td className="p-2"><Badge tone={row.pendingOrders > 0 ? "orange" : "green"}>{row.confirmedOrders} Confirmed · {row.pendingOrders} Pending</Badge></td></tr>)}</tbody>
            </table>
            {affiliateAttribution.length === 0 ? <p role="status" className="py-4 text-sm text-slate-500">目前沒有推廣夥伴歸因資料。</p> : null}
          </div>
        </Card>
      </section>
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
      <div className="mt-6">
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
      </div>
    </>
  );
}

function ComparisonCard({ label, live, replay }: { label: string; live: string | number; replay: string | number }) {
  return <div className="rounded-lg border border-border bg-slate-50 p-4">
    <p className="font-medium text-slate-800">{label}</p>
    <div className="mt-3 grid grid-cols-2 gap-3"><div><span className="text-xs text-slate-500">LIVE</span><strong className="block text-xl text-slate-950">{live}</strong></div><div><span className="text-xs text-slate-500">REPLAY</span><strong className="block text-xl text-slate-950">{replay}</strong></div></div>
  </div>;
}
