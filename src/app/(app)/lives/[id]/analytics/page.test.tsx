import {metricVideoFingerprint} from '@/lib/live-metric-version';
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  requireVendorManagerContext: vi.fn(),
  getSalesProjectScope: vi.fn(),
  liveFindFirst: vi.fn(),
  analyticsFindMany: vi.fn(),
  formSubmissionCount: vi.fn(),
  liveChatMessageCount: vi.fn(),
  interactionEventCount: vi.fn(),
  paymentTransactionCount: vi.fn(),
  paymentTransactionAggregate: vi.fn(),
  emailDeliveryGroupBy: vi.fn(),
  liveInteractionRunFindMany: vi.fn(),
  liveInteractionResponseGroupBy: vi.fn(),
  liveInteractionResponseFindMany: vi.fn(),
  liveQuestionGroupBy: vi.fn(),
  liveQuestionFindMany: vi.fn(),
  queryRaw: vi.fn(),
  metricCandidateQuery: vi.fn(),
  readReadyReport: vi.fn(),
}));

vi.mock("@/lib/live-metric-report-reader",()=>({readMetricReadyReport:mocks.readReadyReport}));

vi.mock("@/lib/auth", () => ({
  requireVendorManager: mocks.requireVendor,
  requireVendorManagerContext: mocks.requireVendorManagerContext,
}));
vi.mock("@/lib/sales-project-scope", () => ({ getSalesProjectScope: mocks.getSalesProjectScope }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: { findFirst: mocks.liveFindFirst },
    analyticsEvent: { findMany: mocks.analyticsFindMany },
    formSubmission: { count: mocks.formSubmissionCount },
    liveChatMessage: { count: mocks.liveChatMessageCount },
    interactionEvent: { count: mocks.interactionEventCount },
    paymentTransaction: {
      count: mocks.paymentTransactionCount,
      aggregate: mocks.paymentTransactionAggregate,
    },
    liveInteractionRun: { findMany: mocks.liveInteractionRunFindMany },
    liveInteractionResponse: {
      groupBy: mocks.liveInteractionResponseGroupBy,
      findMany: mocks.liveInteractionResponseFindMany,
    },
    liveQuestion: {
      groupBy: mocks.liveQuestionGroupBy,
      findMany: mocks.liveQuestionFindMany,
    },
    emailDelivery: { groupBy: mocks.emailDeliveryGroupBy },
    $queryRaw: async (query:{strings:readonly string[]}) => {
      if (query.strings.join('').includes('FROM "LiveMetricReport" r')) {
        const row=await mocks.metricCandidateQuery(query);return row?[row]:[];
      }
      return mocks.queryRaw(query);
    },
  }),
}));

import LiveAnalyticsPage from "./page";

const live = {
  id: "live-current",
  title: "夏季直播",
  interactionScript: { id: "script-current", vendorId: "vendor-current", status: "published" },
  affiliateClicks: [{
    id: "affiliate-click-1",
    referralCode: "summer-partner",
    convertedAt: null,
    createdAt: new Date("2026-07-30T12:00:00.000Z"),
  }],
};

const recentEvents = Array.from({ length: 30 }, (_, index) => ({
  id: `recent-${index + 1}`,
  eventType: "page_view",
  visitorId: `visitor-${index + 1}`,
  trustLevel: "ADMITTED_LIVE_SESSION",
  createdAt: new Date(`2026-07-${String(30 - index).padStart(2, "0")}T12:00:00.000Z`),
}));
const verifiedAnalyticsSessions = [
  ...Array.from({ length: 40 }, (_, index) => ({ eventType: "page_view", visitorId: `view-session-${index}` })),
  ...Array.from({ length: 8 }, (_, index) => ({ eventType: "product_click", visitorId: `product-session-${index}` })),
  ...Array.from({ length: 6 }, (_, index) => ({ eventType: "cta_click", visitorId: `cta-session-${index}` })),
  ...Array.from({ length: 5 }, (_, index) => ({ eventType: "play_progress", visitorId: `progress-session-${index}` })),
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.metricCandidateQuery.mockResolvedValue(null);
  mocks.readReadyReport.mockResolvedValue({status:"unavailable",reason:"report_not_current"});
  mocks.requireVendor.mockResolvedValue({ id: "vendor-current" });
  mocks.requireVendorManagerContext.mockResolvedValue({
    auth: { user: { id: "user-current" } },
    vendor: { id: "vendor-current", timezone: "Asia/Taipei" },
  });
  mocks.getSalesProjectScope.mockResolvedValue({ projectId: null });
  mocks.liveFindFirst.mockResolvedValue(live);
  mocks.formSubmissionCount.mockResolvedValueOnce(6).mockResolvedValueOnce(4);
  mocks.liveChatMessageCount.mockResolvedValue(3);
  mocks.interactionEventCount.mockResolvedValue(7);
  mocks.paymentTransactionCount.mockResolvedValue(2);
  mocks.paymentTransactionAggregate.mockResolvedValue({
    _count: { _all: 0 },
    _sum: { grossAmountCents: null },
  });
  mocks.liveInteractionRunFindMany.mockResolvedValue([]);
  mocks.liveInteractionResponseGroupBy.mockResolvedValue([]);
  mocks.liveInteractionResponseFindMany.mockResolvedValue([]);
  mocks.liveQuestionGroupBy.mockResolvedValue([]);
  mocks.liveQuestionFindMany.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([{
    attributionKey: "summer-partner",
    name: "summer-partner",
    clicks: 1,
    registrations: 0,
    confirmedOrders: 0,
    pendingOrders: 0,
    confirmedGrossCents: 0,
  }]);
  mocks.emailDeliveryGroupBy.mockResolvedValue([
    { status: "sent", _count: { _all: 12 } },
    { status: "failed", _count: { _all: 1 } },
    { status: "exhausted", _count: { _all: 2 } },
  ]);
  mocks.analyticsFindMany
    .mockResolvedValueOnce(verifiedAnalyticsSessions)
    .mockResolvedValueOnce(recentEvents)
    .mockResolvedValue([]);
});

describe("/lives/[id]/analytics route", () => {
  it("uses full live-scoped event totals for KPIs and the conversion funnel when more than 30 events exist", async () => {
    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(mocks.analyticsFindMany).toHaveBeenNthCalledWith(1, {
      where: {
        vendorId: "vendor-current",
        liveId: live.id,
        trustLevel: "ADMITTED_LIVE_SESSION",
        eventType: { in: ["page_view", "product_click", "cta_click", "play_progress"] },
      },
      select: { eventType: true, visitorId: true },
      distinct: ["eventType", "visitorId"],
    });
    expect(mocks.formSubmissionCount).toHaveBeenNthCalledWith(1, { where: { liveId: live.id, form: { vendorId: "vendor-current" } } });
    expect(mocks.formSubmissionCount).toHaveBeenNthCalledWith(2, { where: { liveId: live.id, verificationStatus: "VERIFIED", form: { vendorId: "vendor-current" } } });
    expect(html).toMatch(/播放 session<\/p><p[^>]*>40<\/p>/);
    expect(html).toMatch(/商品點擊<\/p><p[^>]*>8<\/p>/);
    expect(html).toMatch(/CTA 點擊<\/p><p[^>]*>6<\/p>/);
    expect(html).toMatch(/播放進度<\/p><p[^>]*>5<\/p>/);
    expect(html).toContain('aria-label="商品點擊：8，相對觀看轉換率 20%"');
    expect(html).toContain('aria-label="CTA 點擊：6，相對觀看轉換率 15%"');
    expect(html).toMatch(/報名<\/p><p[^>]*>6<\/p>/);
    expect(html).toMatch(/Email 已驗證<\/p><p[^>]*>4<\/p>/);
    expect(html).toContain('aria-label="名單：4，相對觀看轉換率 10%"');
    expect(mocks.liveChatMessageCount).toHaveBeenCalledWith({ where: {
      vendorId: "vendor-current",
      liveId: live.id,
      source: "viewer",
      isSimulated: false,
      status: "visible",
      formSubmissionId: { not: null },
      roleId: null,
    } });
    expect(mocks.interactionEventCount).toHaveBeenCalledWith({ where: {
      eventType: { in: ["chat_message", "reminder"] },
      message: { not: null },
      isSimulated: true,
      script: { id: "script-current", vendorId: "vendor-current", status: "published" },
      role: { is: { vendorId: "vendor-current", isActive: true, isScheduled: true } },
    } });
    expect(html).toMatch(/真實觀眾留言<\/p><p[^>]*>3<\/p>/);
    expect(mocks.paymentTransactionCount).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-current",
        primaryCommerceOrder: { isNot: null },
        metadata: { path: ["sourceLiveId"], equals: live.id },
      },
    });
    expect(html).toMatch(/建立待付款訂單<\/p><p[^>]*>2<\/p>/);
    expect(mocks.emailDeliveryGroupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { vendorId: "vendor-current", sourceLiveId: live.id },
      _count: { _all: true },
    });
    expect(html).toMatch(/Email 成功<\/p><p[^>]*>12<\/p>/);
    expect(html).toMatch(/Email 失敗<\/p><p[^>]*>3<\/p>/);
    expect(html).toMatch(/排程留言腳本<\/p><p[^>]*>7<\/p>/);
    expect(html).toContain("設定數，不列入轉換率");
    expect(html).toContain(`href="/lives/${live.id}/analytics/messages/export"`);
  });

  it("keeps the recent-event list limited to 30 live-scoped events", async () => {
    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(mocks.analyticsFindMany).toHaveBeenNthCalledWith(2, {
      where: {
        vendorId: "vendor-current",
        liveId: live.id,
        OR: [
          { trustLevel: "ADMITTED_LIVE_SESSION" },
          { trustLevel: "VERIFIED_FORM_SUBMISSION", eventType: "lead_submit" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    expect(html).toContain("visitor-1");
    expect(html).toContain("visitor-30");
    expect(html).toContain("summer-partner");
  });

  it("shows an empty state when there are no recent events", async () => {
    mocks.analyticsFindMany
      .mockReset()
      .mockResolvedValueOnce(verifiedAnalyticsSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);

    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(html).toContain("目前沒有最近事件。");
    expect(html).not.toContain("visitor-1");
  });

  it("shows an empty state when there are no affiliate sources", async () => {
    mocks.liveFindFirst.mockResolvedValue({ ...live, affiliateClicks: [] });
    mocks.queryRaw.mockResolvedValue([]);

    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(html).toContain("目前沒有推廣夥伴歸因資料。");
    expect(html).not.toContain("summer-partner");
  });
});

it.each(["existing activity", "no activity"])("keeps unsupported core metrics unavailable with %s", async (scenario) => {
  if (scenario === "no activity") {
    mocks.analyticsFindMany.mockReset().mockResolvedValue([]);
    mocks.formSubmissionCount.mockReset().mockResolvedValue(0);
  }
  const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));
  const section = html.split('<section class="mb-6" aria-labelledby="core-metric-availability-title">')[1]?.split('<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-5">')[0];
  expect(section).toBeDefined();
  for (const label of ["報名率", "到場率", "完看率", "平均觀看時長", "看完下單率"]) expect(section).toContain(label);
  expect(section?.match(/尚不可計算/g)).toHaveLength(5);
  // Rule thresholds are descriptions, never calculated metric values.
  const metricValues = [...(section?.matchAll(/<p class="mt-2 font-medium text-slate-700">(.*?)<\/p>/g) ?? [])].map((match) => match[1]);
  expect(metricValues).toEqual(Array(5).fill("尚不可計算"));
  const rule = section?.match(/<p[^>]*data-metric-rule="approved"[^>]*>(.*?)<\/p>/)?.[1];
  expect(rule).toContain("同一位觀眾在同一影片版本實際看過的不重複區間達 90% 才算完看");
  expect(rule).toContain("該觀眾首次完看後 7 天內成立且未取消的訂單，不等同已付款");
  const valuesAndReasons = section?.replace(/<p[^>]*data-metric-rule="approved"[^>]*>.*?<\/p>/, "");
  expect(valuesAndReasons).not.toMatch(/\d+(?:\.\d+)?(?:%| 秒)/);
  expect(section).not.toContain("完看標準與");
  expect(section).not.toContain("不重複訪客數");
  expect(section).not.toContain("完成觀看與同一位觀眾");
  expect(section).toContain("目前影片尚無可用報表");
});


const metricVideo={id:'video-current',vendorId:'vendor-current',sourceType:'url',videoUrl:'https://example.test/video.mp4',durationSec:100,cloudflareStreamUid:null,cloudflareLiveInputUid:null,cloudflarePlaybackId:null};
const metricCandidate={id:'report-current',versionId:'version-current',status:'ready',windowStartAt:new Date('2026-10-14T00:00:00Z'),windowEndAt:new Date('2026-10-14T01:00:00Z'),version:{mode:'live'}};
const knownMetric=(value:number,numerator:number,denominator:number,unit='percent')=>({status:'available',value,numerator,denominator,unit});
const metricResult={registrationRate:knownMetric(40,4,10),attendanceRate:knownMetric(60,3,5),completionRate:knownMetric(100*2/3,2,3),averageViewingSeconds:knownMetric(250/3,250,3,'seconds'),postCompletionOrderRate:knownMetric(50,1,2),unattributedRegistrations:0,provisionalConversions:true};
function withMetricReport(status='ready',result:unknown=metricResult){mocks.liveFindFirst.mockResolvedValue({...live,video:metricVideo});mocks.metricCandidateQuery.mockResolvedValue({...metricCandidate,status});mocks.readReadyReport.mockResolvedValue({status:'available',result});}
function coreSection(html:string){return html.split('<section class="mb-6" aria-labelledby="core-metric-availability-title">')[1]?.split('<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-5">')[0]??'';}
it('formats each existing ready aggregate without recalculating metrics',async()=>{
 withMetricReport();const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 for(const text of ['40%','60%','66.67%','83.33 秒','50%','下單觀察期尚未結束','直播報表期間：2026-10-14T00:00:00.000Z 至 2026-10-14T01:00:00.000Z（UTC）','未歸因報名：0 人'])expect(html).toContain(text);
 expect(mocks.readReadyReport).toHaveBeenCalledWith(expect.anything(),{vendorId:'vendor-current',liveId:live.id,versionId:metricCandidate.versionId,reportId:metricCandidate.id});
 expect(mocks.metricCandidateQuery).toHaveBeenCalledOnce();
});
it('keeps unsupported per-metric data unavailable even in a ready report',async()=>{
 withMetricReport('ready',{...metricResult,registrationRate:{status:'unavailable',reason:'missing_data'},averageViewingSeconds:{status:'unavailable',reason:'missing_data'}});
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html.match(/尚不可計算/g)).toHaveLength(2);expect(html).not.toContain('40%');expect(html).not.toContain('83.33 秒');expect(html).toContain('60%');expect(html).toContain('不重複訪客數');
});
it.each(['queued','running','failed','stale'])('shows newest %s state without reading older results',async status=>{
 withMetricReport(status);const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html.match(/尚不可計算/g)).toHaveLength(5);expect(html).toContain(`data-core-report-state="${status}"`);expect(mocks.readReadyReport).not.toHaveBeenCalled();expect(mocks.metricCandidateQuery).toHaveBeenCalledOnce();for(const reason of ['不重複訪客數','同一報名者與到場紀錄','實際觀看區間與首次完看','有效觀看時間與重複觀看','完成觀看與同一位觀眾'])expect(html).not.toContain(reason);
});
it('never displays a ready row rejected by the existing expiry/revision reader',async()=>{
 withMetricReport();mocks.readReadyReport.mockResolvedValue({status:'unavailable',reason:'report_not_current'});
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html.match(/尚不可計算/g)).toHaveLength(5);expect(html).toContain('data-core-report-state="stale"');expect(mocks.metricCandidateQuery).toHaveBeenCalledOnce();
});
it('does not query reports without a current video',async()=>{
 mocks.liveFindFirst.mockResolvedValue({...live,video:null});const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html.match(/尚不可計算/g)).toHaveLength(5);expect(mocks.metricCandidateQuery).not.toHaveBeenCalled();expect(mocks.readReadyReport).not.toHaveBeenCalled();
});
it('shows zero denominators and invalid numbers without NaN, Infinity or fake zero',async()=>{
 withMetricReport('ready',{...metricResult,registrationRate:{status:'not_applicable',reason:'zero_denominator'},attendanceRate:knownMetric(Infinity,1,0),completionRate:knownMetric(NaN,1,2)});
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html).toContain('不適用');expect(html.match(/尚不可計算/g)).toHaveLength(2);expect(html).not.toContain('NaN');expect(html).not.toContain('Infinity');
});
it('does not read private reports when the authorized live lookup rejects scope',async()=>{
 mocks.liveFindFirst.mockResolvedValue(null);await expect(LiveAnalyticsPage({params:Promise.resolve({id:'foreign-live'})})).rejects.toThrow();expect(mocks.metricCandidateQuery).not.toHaveBeenCalled();expect(mocks.readReadyReport).not.toHaveBeenCalled();
});

it('binds the candidate to the session tenant, authorized live and exact existing content fingerprint',async()=>{
 withMetricReport();await LiveAnalyticsPage({params:Promise.resolve({id:live.id})});
 expect(mocks.metricCandidateQuery.mock.calls[0][0].values).toEqual(['vendor-current',live.id,metricVideo.id,metricVideoFingerprint(metricVideo)]);
 expect(mocks.metricCandidateQuery.mock.calls[0][0].strings.join('')).toContain('ORDER BY r."createdAt" DESC,r.id DESC LIMIT 1');
});
it('does not start report reads when manager authorization rejects',async()=>{
 mocks.requireVendorManagerContext.mockRejectedValueOnce(new Error('not authorized'));
 await expect(LiveAnalyticsPage({params:Promise.resolve({id:live.id})})).rejects.toThrow('not authorized');expect(mocks.metricCandidateQuery).not.toHaveBeenCalled();expect(mocks.readReadyReport).not.toHaveBeenCalled();
});
it('treats an empty ready reader outcome as stale instead of showing the candidate result',async()=>{
 withMetricReport();mocks.readReadyReport.mockResolvedValue(null);const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html.match(/尚不可計算/g)).toHaveLength(5);expect(html).toContain('data-core-report-state="stale"');
});

it.each(['candidate','ready'])('propagates unexpected %s read failures without a false empty state',async boundary=>{
 withMetricReport();const failure=new Error('synthetic read failure');
 if(boundary==='candidate')mocks.metricCandidateQuery.mockRejectedValue(failure);else mocks.readReadyReport.mockRejectedValue(failure);
 await expect(LiveAnalyticsPage({params:Promise.resolve({id:live.id})})).rejects.toBe(failure);
});
it.each([
 knownMetric(40,4,10,'seconds'),knownMetric(101,4,10),knownMetric(-1,4,10),knownMetric(40,11,10),{status:'available',value:40,denominator:10,unit:'percent'},
])('does not display a malformed available metric',async metric=>{
 withMetricReport('ready',{...metricResult,registrationRate:metric});
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html).toMatch(/報名率<\/h3><p[^>]*>尚不可計算<\/p>/);expect(html).toContain('報表資料尚待確認。');
});

it.each([undefined,{status:'unavailable',reason:'other'},{status:'bogus'}])('does not guess a source cause for malformed ready metric states',async metric=>{
 withMetricReport('ready',{...metricResult,registrationRate:metric});
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html).toMatch(/報名率<\/h3><p[^>]*>尚不可計算<\/p>/);expect(html).toContain('報表資料尚待確認。');expect(html).not.toContain('不重複訪客數');
});

it('lists unattributed registrations separately without altering the ready registration rate',async()=>{
 withMetricReport('ready',{...metricResult,unattributedRegistrations:1});
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html).toContain('未歸因報名：1 人');expect(html).toContain('未計入報名率分子');expect(html).toContain('40%');
});
it.each([undefined,-1,NaN,1.5,'1'])('does not invent unattributed counts from invalid data (%s)',async count=>{
 withMetricReport('ready',{...metricResult,unattributedRegistrations:count});
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html).not.toContain('未歸因報名：');
});

it('labels the same exact UTC report window as replay for replay versions',async()=>{
 withMetricReport();mocks.metricCandidateQuery.mockResolvedValue({...metricCandidate,version:{mode:'replay'}});
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id})})));
 expect(html).toContain('回放報表期間：2026-10-14T00:00:00.000Z 至 2026-10-14T01:00:00.000Z（UTC）');
});

it('queries only the explicitly chosen UTC window and mode within the authorized scope',async()=>{
 withMetricReport();
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id}),searchParams:Promise.resolve({start:'2026-10-14T00:00:00',end:'2026-10-14T01:00:00',mode:'replay'})})));
 const query=mocks.metricCandidateQuery.mock.calls[0][0];
 expect(query.values).toEqual(expect.arrayContaining(['vendor-current',live.id,new Date('2026-10-14T00:00:00Z'),new Date('2026-10-14T01:00:00Z'),'replay']));
 expect(html).toContain('method="get"');expect(html).toContain('開始時間前已報名者不納入');expect(html).toContain('並非跨裝置人數');
});
it.each([
 {start:'2026-10-14T01:00:00',end:'2026-10-14T00:00:00',mode:'live'},
 {start:'2026-02-30T00:00:00',end:'2026-03-02T00:00:00',mode:'live'},
 {start:['2026-10-14T00:00:00'],end:'2026-10-14T01:00:00',mode:'live'},
 {start:'2026-10-14T00:00:00',mode:'live'},
 {start:'2026-10-14T00:00:00',end:'2026-10-14T01:00:00',mode:'other'},
])('rejects invalid window selection without falling back to another report (%j)',async search=>{
 withMetricReport();
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id}),searchParams:Promise.resolve(search)})));
 expect(html).toContain('請選取有效的 UTC');expect(html).toContain('所選期間無效，未查詢報表。');expect(html).not.toContain('最新報表已失效');expect(mocks.metricCandidateQuery).not.toHaveBeenCalled();expect(mocks.readReadyReport).not.toHaveBeenCalled();expect(html).not.toContain('40%');
});
it('does not substitute an older or differently timed report when the selected window has no report',async()=>{
 withMetricReport();mocks.metricCandidateQuery.mockResolvedValue(null);
 const html=coreSection(renderToStaticMarkup(await LiveAnalyticsPage({params:Promise.resolve({id:live.id}),searchParams:Promise.resolve({start:'2026-10-14T00:00:00',end:'2026-10-14T01:00:00',mode:'live'})})));
 expect(mocks.metricCandidateQuery).toHaveBeenCalledOnce();expect(mocks.readReadyReport).not.toHaveBeenCalled();expect(html).not.toContain('40%');expect(html).toContain('所選期間尚無可用報表。');expect(html).not.toContain('目前影片尚無可用報表。');
});

it.each([
 ['2026-10-14T00:00','2026-10-14T01:00'],
 ['2026-10-14T00:00:00.1','2026-10-14T01:00:00.123'],
])('preserves normalized browser UTC input precision (%s)',async(start,end)=>{
 withMetricReport();
 await LiveAnalyticsPage({params:Promise.resolve({id:live.id}),searchParams:Promise.resolve({start,end,mode:'live'})});
 expect(mocks.metricCandidateQuery.mock.calls[0][0].values).toEqual(expect.arrayContaining([new Date(start+'Z'),new Date(end+'Z')]));
});
