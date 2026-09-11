import { BarChart3, Eye, Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, ListSummary, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function LivesPage() {
  const vendor = await requireVendorManager();
  const lives = await getDb().live.findMany({
    where: { vendorId: vendor.id },
    orderBy: { scheduledAt: "desc" },
    include: { video: true, form: true, products: true },
  });

  return (
    <>
      <PageHeader title="直播間管理" description="管理每一場直播頁的播放素材、商品、表單與公開連結。" action={<ButtonLink href="/lives/new" tone="cta"><Plus size={16} />建立直播</ButtonLink>} />
      <ListSummary items={[
        { label: "直播間總數", value: lives.length, hint: "目前工作區" },
        { label: "已發布", value: lives.filter((live) => live.status === "published").length, hint: "可供觀眾進入" },
        { label: "待補影片", value: lives.filter((live) => !live.video).length, hint: "發布前建議完成" },
        { label: "已綁商品", value: lives.reduce((sum, live) => sum + live.products.length, 0), hint: "跨所有直播間" },
      ]} />
      {lives.length === 0 ? (
        <EmptyState title="還沒有直播間" description="用引導流程把影片、商品、報名表與互動腳本組成第一場直播。" action={<ButtonLink href="/lives/new" tone="cta">建立直播</ButtonLink>} secondaryAction={<ButtonLink href="/videos" tone="secondary">先準備影片</ButtonLink>} />
      ) : (
        <Card>
          <div className="grid gap-3">
            {lives.map((live) => (
              <div key={live.id} className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <h2 className="font-semibold text-slate-950">{live.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">{formatDateTime(live.scheduledAt)} · /live/{live.slug}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone="blue">{live.status}</Badge>
                    <Badge tone={live.video ? "green" : "gray"}>{live.video ? "已綁影片" : "無影片"}</Badge>
                    <Badge tone={live.form ? "orange" : "gray"}>{live.form ? "已綁表單" : "無表單"}</Badge>
                    <Badge tone="gray">{live.products.length} 商品</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ButtonLink href={`/lives/${live.id}/edit`} tone="secondary">編輯</ButtonLink>
                  <ButtonLink href={`/lives/${live.id}/preview`} tone="secondary"><Eye size={16} />預覽</ButtonLink>
                  <ButtonLink href={`/lives/${live.id}/chat`} tone="secondary">私密聊天室</ButtonLink>
                  {/* Capture permissions are document-scoped: avoid a client-only navigation from camera=(). */}
                  <a href={`/lives/${live.id}/presenter`} className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">講師與 PPT</a>
                  <ButtonLink href={`/lives/${live.id}/analytics`} tone="secondary"><BarChart3 size={16} />分析</ButtonLink>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
