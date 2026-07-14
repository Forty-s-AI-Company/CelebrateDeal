import { CheckCircle2, Plus, Radio } from "lucide-react";
import { Card, PageHeader, Badge, ButtonLink } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { calculateAnalyticsFunnel } from "@/lib/analytics-funnel";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatLiveCountdown } from "@/lib/live-countdown";

function getDateDaysAgo(days: number) {
  return new Date(Date.now() - 1000 * 60 * 60 * 24 * days);
}

export default async function DashboardPage() {
  const vendor = await requireVendor();
  const db = getDb();
  const sevenDaysAgo = getDateDaysAgo(7);
  const now = getDateDaysAgo(0);
  const [liveCount, productCount, leadCount, viewCount, productClicks, ctaClicks, recentLives, upcomingLives, affiliates, usageLimit, scripts, roles] = await Promise.all([
    db.live.count({ where: { vendorId: vendor.id } }),
    db.product.count({ where: { vendorId: vendor.id, isActive: true } }),
    db.formSubmission.count({ where: { form: { vendorId: vendor.id }, createdAt: { gte: sevenDaysAgo } } }),
    db.analyticsEvent.count({ where: { vendorId: vendor.id, eventType: "page_view", createdAt: { gte: sevenDaysAgo } } }),
    db.analyticsEvent.count({ where: { vendorId: vendor.id, eventType: "product_click", createdAt: { gte: sevenDaysAgo } } }),
    db.analyticsEvent.count({ where: { vendorId: vendor.id, eventType: "cta_click", createdAt: { gte: sevenDaysAgo } } }),
    db.live.findMany({
      where: { vendorId: vendor.id },
      orderBy: { scheduledAt: "desc" },
      take: 5,
      include: { products: true, submissions: true },
    }),
    db.live.findMany({
      where: { vendorId: vendor.id, scheduledAt: { gte: now } },
      orderBy: { scheduledAt: "asc" },
      take: 3,
    }),
    db.affiliate.findMany({ where: { vendorId: vendor.id }, include: { clicks: true }, take: 5 }),
    db.vendorUsageLimit.findUnique({ where: { vendorId: vendor.id }, include: { billingPlan: true } }),
    db.interactionScript.count({ where: { vendorId: vendor.id } }),
    db.interactionRole.count({ where: { vendorId: vendor.id } }),
  ]);

  const conversionRate = viewCount > 0 ? Math.round((leadCount / viewCount) * 1000) / 10 : 0;
  const funnel = calculateAnalyticsFunnel({
    views: viewCount,
    productClicks,
    ctaClicks,
    submissions: leadCount,
  });
  const usagePercent = usageLimit ? Math.round((usageLimit.creditsUsed / usageLimit.creditsLimit) * 100) : 0;
  const checklist = [
    { label: "建立商品", done: productCount > 0 },
    { label: "建立直播間", done: liveCount > 0 },
    { label: "建立互動角色", done: roles > 0 },
    { label: "建立互動腳本", done: scripts > 0 },
    { label: "設定追蹤", done: Boolean(vendor.tracking?.googleTagManagerId || vendor.tracking?.facebookPixelId) },
  ];

  const kpis = [
    { label: "近 7 天觀看", value: viewCount, tone: "blue" },
    { label: "近 7 天報名", value: leadCount, tone: "green" },
    { label: "商品點擊", value: productClicks, tone: "orange" },
    { label: "轉換率", value: `${conversionRate}%`, tone: "gray" },
  ] as const;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Cloudflare-first 直播導購營運總覽：觀看、名單、商品點擊、聯盟來源與用量配額。"
        action={<ButtonLink href="/lives/new" tone="cta"><Plus size={16} />建立直播</ButtonLink>}
      />

      <div className="grid gap-4 md:grid-cols-4">
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

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">近期直播</h2>
            <ButtonLink href="/lives" tone="secondary">查看全部</ButtonLink>
          </div>
          <div className="grid gap-3">
            {recentLives.map((live) => (
              <a key={live.id} href={`/lives/${live.id}/analytics`} className="flex flex-col gap-3 rounded-lg border border-border p-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-blue-50 text-primary"><Radio size={18} /></span>
                  <span>
                    <span className="block font-semibold text-slate-900">{live.title}</span>
                    <span className="block text-sm text-slate-500">{formatDateTime(live.scheduledAt)}</span>
                  </span>
                </span>
                <span className="flex gap-2">
                  <Badge tone="blue">{live.status}</Badge>
                  <Badge tone="green">{live.submissions.length} 名單</Badge>
                </span>
              </a>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">Onboarding checklist</h2>
          <div className="grid gap-3">
            {checklist.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-sm">
                <CheckCircle2 size={18} className={item.done ? "text-emerald-600" : "text-slate-300"} />
                <span className={item.done ? "text-slate-700" : "text-slate-400"}>{item.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">即將開播</h2>
          <div className="grid gap-3">
            {upcomingLives.map((live) => (
              <div key={live.id} className="rounded-md border border-border p-3">
                <p className="font-semibold text-slate-950">{live.title}</p>
                <p className="mt-1 text-sm text-slate-500">{formatDateTime(live.scheduledAt)}</p>
                <p className="mt-2 text-sm font-medium text-primary">
                  即將開播倒數：{formatLiveCountdown(live.scheduledAt, now) ?? "排程時間無效"}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">聯盟來源摘要</h2>
          <div className="grid gap-3">
            {affiliates.map((affiliate) => (
              <div key={affiliate.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <span>
                  <b className="block text-slate-950">{affiliate.code}</b>
                  <span className="text-slate-500">{affiliate.name}</span>
                </span>
                <span className="text-right">
                  <b className="block">{affiliate.clicks.length}</b>
                  <span className="text-slate-500">點擊</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">用量 / 配額</h2>
          {usageLimit ? (
            <div>
              <p className="text-sm text-slate-500">{usageLimit.billingPlan?.name ?? "未指定方案"}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{usagePercent}%</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-primary" style={{ width: `${usagePercent}%` }} />
              </div>
              <p className="mt-3 text-sm text-slate-500">剩餘 {(usageLimit.creditsLimit - usageLimit.creditsUsed).toLocaleString()} 點</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">尚未設定方案。</p>
          )}
        </Card>
      </div>
    </>
  );
}
