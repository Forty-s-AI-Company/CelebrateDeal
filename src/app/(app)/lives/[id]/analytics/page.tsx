import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function LiveAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendor();
  const { id } = await params;
  const live = await getDb().live.findFirst({
    where: { id, vendorId: vendor.id },
    include: {
      analytics: { orderBy: { createdAt: "desc" }, take: 30 },
      submissions: true,
      affiliateClicks: true,
    },
  });
  if (!live) notFound();

  const pageViews = live.analytics.filter((event) => event.eventType === "page_view").length;
  const productClicks = live.analytics.filter((event) => event.eventType === "product_click").length;
  const ctaClicks = live.analytics.filter((event) => event.eventType === "cta_click").length;
  const progressEvents = live.analytics.filter((event) => event.eventType === "play_progress").length;

  return (
    <>
      <PageHeader title={`${live.title} 分析`} description="MVP 先收事件流與核心 KPI，後續可加漏斗與 cohorts。" />
      <div className="grid gap-4 md:grid-cols-5">
        <Card><p className="text-sm text-slate-500">觀看</p><p className="mt-2 text-3xl font-semibold">{pageViews}</p></Card>
        <Card><p className="text-sm text-slate-500">名單</p><p className="mt-2 text-3xl font-semibold">{live.submissions.length}</p></Card>
        <Card><p className="text-sm text-slate-500">商品點擊</p><p className="mt-2 text-3xl font-semibold">{productClicks}</p></Card>
        <Card><p className="text-sm text-slate-500">CTA 點擊</p><p className="mt-2 text-3xl font-semibold">{ctaClicks}</p></Card>
        <Card><p className="text-sm text-slate-500">播放進度</p><p className="mt-2 text-3xl font-semibold">{progressEvents}</p></Card>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">最近事件</h2>
          <div className="grid gap-2">
            {live.analytics.map((event) => (
              <div key={event.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <span className="flex items-center gap-2"><Badge tone="blue">{event.eventType}</Badge>{event.visitorId}</span>
                <span className="text-slate-500">{formatDateTime(event.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">聯盟來源</h2>
          <div className="grid gap-2">
            {live.affiliateClicks.map((click) => (
              <div key={click.id} className="rounded-md border border-border p-3 text-sm">
                <p className="font-semibold text-slate-950">{click.referralCode ?? "unknown"}</p>
                <p className="text-slate-500">{click.convertedAt ? "已轉換" : "尚未轉換"} · {formatDateTime(click.createdAt)}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
