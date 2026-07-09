import { Plus } from "lucide-react";
import { ButtonLink, Card, EmptyState, PageHeader, Badge } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function VideosPage() {
  const vendor = await requireVendor();
  const videos = await getDb().video.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader title="影片庫" description="管理直播回放、預錄影片與可綁定到直播間的播放素材。" action={<ButtonLink href="/videos/new"><Plus size={16} />新增影片</ButtonLink>} />
      {videos.length === 0 ? (
        <EmptyState title="還沒有影片" description="先新增一支影片，直播間就能綁定播放內容。" action={<ButtonLink href="/videos/new">新增影片</ButtonLink>} />
      ) : (
        <Card>
          <div className="grid gap-3">
            {videos.map((video) => (
              <a key={video.id} href={`/videos/${video.id}/edit`} className="grid gap-3 rounded-lg border border-border p-4 hover:bg-slate-50 sm:grid-cols-[1fr_auto] sm:items-center">
                <span>
                  <span className="block font-semibold text-slate-950">{video.title}</span>
                  <span className="mt-1 block text-sm text-slate-500">{video.videoUrl}</span>
                </span>
                <Badge tone="green">{video.status}</Badge>
              </a>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
