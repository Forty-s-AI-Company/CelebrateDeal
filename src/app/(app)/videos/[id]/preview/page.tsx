import { notFound } from "next/navigation";
import { PromoVideoPlayer } from "@/components/promo-video-player";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

const statusLabels: Record<string, string> = {
  ready: "可播放",
  processing: "處理中",
  error: "處理失敗",
  archived: "已封存",
};

function statusTone(status: string): "blue" | "orange" | "gray" | "green" | "red" {
  if (status === "ready") return "green";
  if (status === "processing") return "orange";
  if (status === "error") return "red";
  return "gray";
}

export default async function VideoPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const video = await getDb().video.findFirst({ where: { id, vendorId: vendor.id } });
  if (!video) notFound();

  const playbackUrl = video.videoUrl.trim();
  const canRenderPlayer = (video.status === "ready" || video.status === "archived") && Boolean(playbackUrl);

  return (
    <>
      <PageHeader title="影片預覽" description="這是商家預覽；影片只有在可播放且來源有效時才會載入播放器。" action={<ButtonLink href={`/videos/${encodeURIComponent(video.id)}/edit`} tone="secondary">返回編輯</ButtonLink>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
        <Card className="overflow-hidden p-0">
          <div className="bg-slate-950 p-4">
            {canRenderPlayer ? <PromoVideoPlayer src={playbackUrl} title={video.title} /> : <div role="status" className="grid aspect-video place-items-center rounded-xl bg-slate-900 px-6 text-center text-sm text-slate-200">影片目前無法播放，請回到編輯頁檢查素材狀態。</div>}
          </div>
          <div className="grid gap-2 p-6">
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold text-slate-950">{video.title}</h2><Badge tone={statusTone(video.status)}>{statusLabels[video.status] ?? "未知狀態"}</Badge></div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{video.description || "尚未填寫影片描述。"}</p>
          </div>
        </Card>
        <Card className="h-fit">
          <h2 className="text-lg font-semibold text-slate-950">播放檢查</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">目前狀態</dt><dd className="font-semibold">{statusLabels[video.status] ?? "未知狀態"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">播放來源</dt><dd className="font-semibold">{video.sourceType === "cloudflare_stream" ? "Cloudflare Stream" : "外部影片"}</dd></div>
          </dl>
          {video.status === "archived" ? <p role="alert" className="mt-5 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">這支影片已封存，只提供預覽，不建議綁定新的直播場次。</p> : null}
          {!canRenderPlayer ? <p role="alert" className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">影片來源尚未準備好，系統已安全停止載入。</p> : null}
        </Card>
      </div>
    </>
  );
}
