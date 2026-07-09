import { BarChart3, Eye, Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function LivesPage() {
  const vendor = await requireVendor();
  const lives = await getDb().live.findMany({
    where: { vendorId: vendor.id },
    orderBy: { scheduledAt: "desc" },
    include: { video: true, form: true, products: true },
  });

  return (
    <>
      <PageHeader title="直播間管理" description="管理每一場直播頁的播放素材、商品、表單與公開連結。" action={<ButtonLink href="/lives/new" tone="cta"><Plus size={16} />建立直播</ButtonLink>} />
      {lives.length === 0 ? (
        <EmptyState title="還沒有直播間" description="用 stepper 建立第一場直播，把影片、商品與報名表串起來。" action={<ButtonLink href="/lives/new" tone="cta">建立直播</ButtonLink>} />
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
