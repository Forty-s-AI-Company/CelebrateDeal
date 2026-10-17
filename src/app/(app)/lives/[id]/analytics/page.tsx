import { Prisma } from '@prisma/client';
import { readMetricReadyReport } from '@/lib/live-metric-report-reader';
import { metricVideoFingerprint } from '@/lib/live-metric-version';
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { calculateAnalyticsFunnel } from "@/lib/analytics-funnel";
import { getDb } from "@/lib/db";
import { COMPLETION_PERCENT, POST_COMPLETION_ORDER_WINDOW_MS } from "@/lib/live-metric-contract";
import { getSalesProjectScope } from "@/lib/sales-project-scope";
import { formatDateTime } from "@/lib/format";
import { realViewerMessageWhere, scheduledMessageEventWhere } from "@/lib/live-chat-analytics";
import {
  conversionRate,
  interactionCountsByRun,
  loadLiveAffiliateAttribution,
  maskedQuestionAuthor,
  pollAnalytics,
} from "@/lib/live-engagement-analytics";

// Labels/fallback reasons only. Values come exclusively from a current ready report.
const coreMetricDefinitions = [
  { key: "registrationRate", label: "報名率", reason: "缺少報名頁的不重複訪客數，尚未能計算報名比例。" },
  { key: "attendanceRate", label: "到場率", reason: "同一報名者與到場紀錄尚未完整連結。" },
  { key: "completionRate", label: "完看率", reason: "每位觀眾的實際觀看區間與首次完看時間尚未就緒。" },
  { key: "averageViewingSeconds", label: "平均觀看時長", reason: "每位觀眾的有效觀看時間與重複觀看計算方式尚未就緒。" },
  { key: "postCompletionOrderRate", label: "看完下單率", reason: "完成觀看與同一位觀眾的下單紀錄尚未完整連結。" },
] as const;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// Display only existing report aggregates. Coverage-dependent missing values
// stay missing; the page never recalculates a ratio or scans source facts.
function metricDisplay(result: unknown, key: string, missingReason: string) {
  const metric = record(record(result)[key]);
  if (metric.status === 'not_applicable' && metric.reason === 'zero_denominator')
    return { value: '不適用', reason: '此期間沒有符合條件的分母資料。' };
  if (metric.status === 'unavailable' && metric.reason === 'missing_data') return { value: '尚不可計算', reason: missingReason };
  if (metric.status !== 'available') return { value: '尚不可計算', reason: '報表資料尚待確認。' };
  const unit = key === 'averageViewingSeconds' ? 'seconds' : 'percent';
  if (metric.unit !== unit || typeof metric.value !== 'number' || !Number.isFinite(metric.value) || metric.value < 0
    || (unit === 'percent' && metric.value > 100) || typeof metric.denominator !== 'number'
    || !Number.isFinite(metric.denominator) || metric.denominator <= 0 || typeof metric.numerator !== 'number'
    || !Number.isFinite(metric.numerator) || metric.numerator < 0
    || (unit === 'percent' && metric.numerator > metric.denominator))
    return { value: '尚不可計算', reason: '報表資料尚待確認。' };
  return { value: `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(metric.value)}${unit === 'percent' ? '%' : ' 秒'}`, reason: '' };
}

type ReportSearch = { start?: string | string[]; end?: string | string[]; mode?: string | string[] };
// UTC-only form values; malformed or incomplete windows never fall back to another report.
function reportWindow(search: ReportSearch) {
  if (search.start === undefined && search.end === undefined && search.mode === undefined) return null;
  const { start, end, mode } = search;
  if (typeof start !== 'string' || typeof end !== 'string' || (mode !== 'live' && mode !== 'replay')) return false;
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value) || !Number.isFinite(Date.parse(value + 'Z'))) return false;
    const normalized = value.length === 16 ? value + ':00.000' : value.includes('.') ? value.padEnd(23, '0') : value + '.000';
    return new Date(value + 'Z').toISOString().slice(0, 23) === normalized;
  };
  if (!valid(start) || !valid(end) || Date.parse(start + 'Z') >= Date.parse(end + 'Z')) return false;
  return { start: new Date(start + 'Z'), end: new Date(end + 'Z'), mode };
}

async function loadCoreMetricReport(db: ReturnType<typeof getDb>, vendorId: string, liveId: string,
  video: Parameters<typeof metricVideoFingerprint>[0] | null, window: ReturnType<typeof reportWindow> = null) {
  if (window === false) return { state: 'invalid_window', candidate: null, result: null };
  if (!video) return { state: 'none', candidate: null, result: null };
  // Authenticated tenant and already-authorized live only. Never use a report
  // identifier from request input, and never fall back to an older generation.
  const [candidate] = await db.$queryRaw<{ id: string; versionId: string; status: string;
    windowStartAt: Date; windowEndAt: Date; version: { mode: 'live' | 'replay' } }[]>(Prisma.sql`
    SELECT r.id,r."versionId",r.status,r."windowStartAt",r."windowEndAt",jsonb_build_object('mode',v.mode) AS version
    FROM "LiveMetricReport" r JOIN "LiveMetricVersion" v ON v.id=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
    WHERE r."vendorId"=${vendorId} AND r."liveId"=${liveId} AND v."videoId"=${video.id} AND v.fingerprint=${metricVideoFingerprint(video)}
    ${window ? Prisma.sql`AND r."windowStartAt"=${window.start} AND r."windowEndAt"=${window.end} AND v.mode=${window.mode}` : Prisma.empty}
    ORDER BY r."createdAt" DESC,r.id DESC LIMIT 1`);
  if (!candidate) return { state: 'none', candidate: null, result: null };
  if (candidate.status !== 'ready') return { state: candidate.status, candidate, result: null };
  const report = await readMetricReadyReport(db, { vendorId, liveId, versionId: candidate.versionId, reportId: candidate.id });
  return report?.status === 'available'
    ? { state: 'ready', candidate, result: report.result }
    : { state: 'stale', candidate, result: null };
}

function coreReportStateMessage(state: string, selected = false) {
  if (state === 'invalid_window') return '所選期間無效，未查詢報表。';
  if (selected && state === 'none') return '所選期間尚無可用報表。';
  const prefix = selected ? '所選期間的最新報表' : '最新報表';
  if (state === 'ready') return `${prefix}已完成；各指標依資料完整性分別顯示。`;
  if (state === 'queued' || state === 'running') return `${prefix}準備中，完成前不顯示舊數值。`;
  if (state === 'failed') return `${prefix}未完成，暫時無法顯示數值。`;
  if (state === 'none') return '目前影片尚無可用報表。';
  return `${prefix}已失效，暫時無法顯示數值。`;
}

function formatTwd(cents: number) {
  return `NT$${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(cents / 100)}`;
}

async function loadAnalytics(db: ReturnType<typeof getDb>, live: { id: string; endedAt: Date | null }, vendorId: string, validScriptId: string | null, trackedEventTypes: string[]) {
  return await Promise.all([
    db.analyticsEvent.findMany({
      where: {
        vendorId: vendorId,
        liveId: live.id,
        trustLevel: "ADMITTED_LIVE_SESSION",
        eventType: { in: trackedEventTypes },
      },
      select: { eventType: true, visitorId: true },
      distinct: ["eventType", "visitorId"],
    }),
    db.formSubmission.count({ where: { liveId: live.id, form: { vendorId: vendorId } } }),
    db.formSubmission.count({ where: { liveId: live.id, verificationStatus: "VERIFIED", form: { vendorId: vendorId } } }),
    db.analyticsEvent.findMany({
      where: {
        vendorId: vendorId,
        liveId: live.id,
        OR: [
          { trustLevel: "ADMITTED_LIVE_SESSION" },
          { trustLevel: "VERIFIED_FORM_SUBMISSION", eventType: "lead_submit" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.liveChatMessage.count({ where: realViewerMessageWhere({ vendorId: vendorId, liveId: live.id }) }),
    validScriptId
      ? db.interactionEvent.count({ where: scheduledMessageEventWhere({ vendorId: vendorId, scriptId: validScriptId }) })
      : Promise.resolve(0),
    // A checkout is counted only when the order's payment transaction has a
    // sourceLiveId derived on the server from a verified registration cookie.
    // Direct catalogue checkout must not be guessed into a live's results.
    db.paymentTransaction.count({
      where: {
        vendorId: vendorId,
        primaryCommerceOrder: { isNot: null },
        metadata: { path: ["sourceLiveId"], equals: live.id },
      },
    }),
    db.emailDelivery.groupBy({
      by: ["status"],
      where: { vendorId: vendorId, sourceLiveId: live.id },
      _count: { _all: true },
    }),
    db.liveInteractionRun.findMany({
      where: {
        vendorId: vendorId,
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
        vendorId: vendorId,
        liveId: live.id,
        eventType: { in: ["poll", "lucky_draw", "flash_sale", "flash_voucher"] },
      },
      _count: { _all: true },
    }),
    db.liveInteractionResponse.groupBy({
      by: ["runId", "eventType"],
      where: {
        vendorId: vendorId,
        liveId: live.id,
        eventType: { in: ["flash_sale", "flash_voucher"] },
        usedOrderId: { not: null },
      },
      _count: { _all: true },
    }),
    db.liveInteractionResponse.findMany({
      where: {
        vendorId: vendorId,
        liveId: live.id,
        run: { eventType: "lucky_draw", winnerResponseId: { not: null } },
        claimTokenHash: { not: null },
      },
      select: { id: true, displayName: true, winnerClaimedAt: true },
    }),
    db.liveQuestion.groupBy({
      by: ["status"],
      where: { vendorId: vendorId, liveId: live.id },
      _count: { _all: true },
    }),
    db.liveQuestion.findMany({
      where: { vendorId: vendorId, liveId: live.id, spotlightedAt: { not: null } },
      select: { id: true, body: true, displayName: true, status: true },
      orderBy: { spotlightedAt: "desc" },
      take: 50,
    }),
    db.analyticsEvent.findMany({
      where: {
        vendorId: vendorId,
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
        vendorId: vendorId,
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
        vendorId: vendorId,
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
        vendorId: vendorId,
        status: "paid",
        primaryCommerceOrder: { isNot: null },
        metadata: { path: ["sourceLiveId"], equals: live.id },
        occurredAt: { gte: live.endedAt },
      },
      _count: { _all: true },
      _sum: { grossAmountCents: true },
    }) : Promise.resolve({ _count: { _all: 0 }, _sum: { grossAmountCents: null } }),
    loadLiveAffiliateAttribution(db, { vendorId: vendorId, liveId: live.id }),
  ]);
}

function ReportWindowForm({ selectedWindow, candidate }: {
  selectedWindow: ReturnType<typeof reportWindow>;
  candidate: Awaited<ReturnType<typeof loadCoreMetricReport>>['candidate'];
}) {
  return <>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">開始時間（UTC）<input name="start" type="datetime-local" step="0.001" required className="block rounded border p-2"
            defaultValue={selectedWindow ? selectedWindow.start.toISOString().slice(0, -1) : candidate?.windowStartAt.toISOString().slice(0, -1)} /></label>
          <label className="text-sm">截止時間（UTC，不含）<input name="end" type="datetime-local" step="0.001" required className="block rounded border p-2"
            defaultValue={selectedWindow ? selectedWindow.end.toISOString().slice(0, -1) : candidate?.windowEndAt.toISOString().slice(0, -1)} /></label>
          <label className="text-sm">場次類型<select name="mode" className="block rounded border p-2" defaultValue={selectedWindow ? selectedWindow.mode : candidate?.version.mode ?? 'live'}>
            <option value="live">直播</option><option value="replay">回放</option>
          </select></label>
          <button type="submit" className="rounded border px-3 py-2 text-sm">查看此期間報表</button>
        </form>
        {selectedWindow === false ? <p role="alert" className="mt-2 text-sm text-amber-800">請選取有效的 UTC 開始與截止時間，以及直播或回放；截止必須晚於開始。</p> : null}
  </>;
}

// 未歸因名單獨立呈現，不推測跨裝置身分，也不補入報名率分子。
function UnattributedRegistrations({ state, result }: { state: string; result: unknown }) {
  const count = record(result).unattributedRegistrations;
  if (state !== 'ready' || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
  return <p className="mt-1 text-sm text-slate-600">未歸因報名：{count} 人（無法連結訪客紀錄，未計入報名率分子）。</p>;
}

export default async function LiveAnalyticsPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams?: Promise<ReportSearch>;
}) {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  const { id } = await params;
  const db = getDb();
  const live = await db.live.findFirst({
    where: { id, vendorId: vendor.id, ...(scope.projectId ? { projectId: scope.projectId } : {}) },
    include: {
      interactionScript: { select: { id: true, vendorId: true, status: true } },
      video: { select: { id: true, vendorId: true, sourceType: true, videoUrl: true, durationSec: true,
        cloudflareStreamUid: true, cloudflareLiveInputUid: true, cloudflarePlaybackId: true } },
    },
  });
  if (!live) notFound();

  const selectedWindow = reportWindow(await searchParams ?? {});
  const trackedEventTypes = ["page_view", "product_click", "cta_click", "play_progress"];
  const validScriptId = live.interactionScript?.vendorId === vendor.id && live.interactionScript.status === "published"
    ? live.interactionScript.id
    : null;
  const [analytics, coreReport] = await Promise.all([
    loadAnalytics(db, live, vendor.id, validScriptId, trackedEventTypes),
    loadCoreMetricReport(db, vendor.id, live.id, live.video, selectedWindow),
  ]);
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
  ] = analytics;
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
      <section className="mb-6" aria-labelledby="core-metric-availability-title">
        <h2 id="core-metric-availability-title" className="text-lg font-semibold text-slate-950">場次核心指標</h2>
        <p className="mt-1 text-sm text-slate-600">各指標的資料與計算方式完整就緒後才會顯示數值。</p>
        <ReportWindowForm selectedWindow={selectedWindow} candidate={coreReport.candidate} />
        <p className="mt-2 text-sm text-slate-600">僅顯示所選期間與影片版本的既有報表，沒有相符報表時不改用其他期間。報名率分母為不重複瀏覽器，並非跨裝置人數；到場率只計入期間內完成驗證的報名者，開始時間前已報名者不納入。</p>
        <p className="mt-2 text-sm text-slate-600" data-metric-rule="approved">
          {`已確認的完看與下單條件：同一位觀眾在同一影片版本實際看過的不重複區間達 ${COMPLETION_PERCENT}% 才算完看；快轉跳過不計、重看同區間不重複計算。看完下單採該觀眾首次完看後 ${POST_COMPLETION_ORDER_WINDOW_MS / (24 * 60 * 60 * 1000)} 天內成立且未取消的訂單，不等同已付款。`}
        </p>
        <p className="mt-2 text-sm text-slate-600" data-core-report-state={coreReport.state}>
          {coreReportStateMessage(coreReport.state, Boolean(selectedWindow))}
        </p>
        {coreReport.candidate ? <p className="mt-1 text-sm text-slate-600">
          {coreReport.candidate.version.mode === 'replay' ? '回放' : '直播'}報表期間：{coreReport.candidate.windowStartAt.toISOString()} 至 {coreReport.candidate.windowEndAt.toISOString()}（UTC）
        </p> : null}
        {record(coreReport.result).provisionalConversions === true ? <p className="mt-1 text-sm text-amber-800">下單觀察期尚未結束，數值仍可能變動。</p> : null}
        <UnattributedRegistrations state={coreReport.state} result={coreReport.result} />
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {coreMetricDefinitions.map((metric) => {
            const display = coreReport.state === 'ready'
              ? metricDisplay(coreReport.result, metric.key, metric.reason) : { value: '尚不可計算', reason: '' };
            return <Card key={metric.key}>
            <h3 className="font-semibold text-slate-950">{metric.label}</h3>
            <p className="mt-2 font-medium text-slate-700">{display.value}</p>
            {display.reason ? <p className="mt-2 text-sm text-slate-600">{display.reason}</p> : null}
          </Card>;
          })}
        </div>
      </section>
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
          <h2 id="affiliate-attribution-title" className="text-lg font-semibold text-slate-950">聯盟來源</h2>
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
