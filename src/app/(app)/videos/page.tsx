import { Plus } from "lucide-react";
import { ButtonLink, Card, EmptyState, PageHeader, Badge } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canManageVideos } from "@/lib/vendor-capabilities";

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [auth, params] = await Promise.all([requireAuth(), searchParams]);
  const vendor = auth.vendor;
  if (!vendor) return null;
  const canManage = canManageVideos(auth.member?.role);
  const videos = await getDb().video.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader title="影片庫" description="管理直播回放、預錄影片與可綁定到直播間的播放素材。" action={canManage ? <ButtonLink href="/videos/new"><Plus size={16} />新增影片</ButtonLink> : undefined} />
      {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">只有 owner、admin 或 staff 可以管理影片。</p> : null}
      {videos.length === 0 ? (
        <EmptyState title="還沒有影片" description="先新增一支影片，直播間就能綁定播放內容。" action={canManage ? <ButtonLink href="/videos/new">新增影片</ButtonLink> : undefined} />
      ) : (
        <Card>
          <div className="grid gap-3">
            {videos.map((video) => (
              <div key={video.id} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <span>
                  <span className="block font-semibold text-slate-950">{video.title}</span>
                  <span className="mt-1 block text-sm text-slate-500">{video.sourceType} · {video.durationSec}s</span>
                </span>
                <span className="flex items-center gap-3"><Badge tone={video.status === "ready" ? "green" : "blue"}>{video.status}</Badge>{canManage ? <ButtonLink href={`/videos/${video.id}/edit`} tone="secondary">編輯</ButtonLink> : null}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
