import Link from "next/link";
import { liveOrientation } from "@/lib/presenter-layout";
import { notFound } from "next/navigation";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { EvergreenPreviewPlayer } from "@/components/evergreen-preview-player";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function LivePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const live = await getDb().live.findFirst({ where: { id, vendorId: vendor.id }, include: { products: { include: { product: true } }, form: true, video: true, messageTemplate: true, liveReminderTemplate: true, interactionScript: { include: { events: { orderBy: { triggerSec: "asc" } } } } } });
  if (!live) notFound();

  return (
    <>
      <PageHeader title="直播預覽" description="確認公開頁資訊，並取得可分享連結。" action={<ButtonLink href={`/live/${live.slug}`} tone="cta" prefetch={false}>開啟公開頁</ButtonLink>} />
      <Card>
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            {live.isEvergreen && live.evergreenPreviewEnabled && live.video?.videoUrl ? (
              <EvergreenPreviewPlayer
                videoUrl={live.video.videoUrl}
                orientation={liveOrientation(live.presenterLayout)}
                playbackRate={live.evergreenPreviewRate}
                events={(live.interactionScript?.events ?? []).map(({ id: eventId, triggerSec, title, eventType }) => ({ id: eventId, triggerSec, title, eventType }))}
              />
            ) : <div className="rounded-lg bg-slate-100 bg-contain bg-no-repeat bg-center" style={{ aspectRatio: liveOrientation(live.presenterLayout) === "portrait" ? "9 / 16" : "16 / 9", maxHeight: "70dvh", backgroundImage: live.heroImageUrl ? `url(${live.heroImageUrl})` : undefined }} />}
            <p className="mt-2 text-sm text-slate-500">已合成影片保留原始比例，比例不符時留白。開啟公開頁可確認與觀眾相同的播放與互動畫面。</p>
            <h2 className="mt-4 text-xl font-semibold text-slate-950">{live.title}</h2>
            <p className="mt-2 text-sm text-slate-500">{live.description}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-700">公開連結</p>
            <Link className="mt-2 block break-all text-primary" href={`/live/${live.slug}`} prefetch={false}>/live/{live.slug}</Link>
            <p className="mt-5 text-sm font-semibold text-slate-700">綁定內容</p>
            <ul className="mt-2 space-y-2 text-sm text-slate-600">
              <li>影片：{live.video?.title ?? "未綁定"}</li>
              <li>串流模式：{live.streamMode}</li>
              <li>觀看方向：{liveOrientation(live.presenterLayout) === "portrait" ? "直式 9:16" : "橫式 16:9"}</li>
              <li>Cloudflare Live Input：{live.cloudflareLiveInputUid ?? live.video?.cloudflareLiveInputUid ?? "未設定"}</li>
              <li>表單：{live.form?.name ?? "未綁定"}</li>
              <li>報名成功 Email：{live.messageTemplate?.name ?? "未綁定"}</li>
              <li>開播提醒 Email：{live.liveReminderTemplate?.name ?? "未綁定"}</li>
              <li>提醒時間：{live.liveReminderTemplate ? `提前 ${live.liveReminderOffsetMinutes} 分鐘` : "未啟用"}</li>
              <li>互動腳本：{live.interactionScript?.name ?? "未綁定"}</li>
              <li>常青模式：{live.isEvergreen ? `${live.evergreenScheduleMode} · 公開 1×` : "未啟用"}</li>
              <li>商品：{live.products.map((item) => item.product.name).join("、") || "未綁定"}</li>
            </ul>
          </div>
        </div>
      </Card>
    </>
  );
}
