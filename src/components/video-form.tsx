import type { Video } from "@prisma/client";
import { upsertVideoAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { MediaUploadField } from "@/components/media-upload-field";
import { VideoProviderStatus } from "@/components/video-provider-status";
import { Card, Field, SelectField, SubmitButton, TextArea } from "@/components/ui";

type VideoWithImageAsset = Video & { thumbnailAssetId?: string | null };

export function VideoForm({ video, error }: { video?: VideoWithImageAsset; error?: string }) {
  const isExternalVideo = !video || video.sourceType === "url";

  return (
    <Card>
      <form action={upsertVideoAction} className="grid gap-4">
        <CsrfField />
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{videoFormError(error)}</p> : null}
        <Field label="影片名稱" name="title" required defaultValue={video?.title} />
        <TextArea label="影片描述" name="description" defaultValue={video?.description} />
        <MediaUploadField
          kind="video"
          label={video ? "替換影片檔案" : "影片檔案"}
          description="檔案會直接送往 Cloudflare Stream；應用程式不會接觸 provider token 或 stream key。上傳完成後仍要按下儲存，才會套用名稱與縮圖。"
          defaultResourceId={video?.id}
          resourceIdInputName="id"
          titleInputName="title"
          durationInputName="durationSec"
          estimatedMinutesInputName="estimatedMinutes"
        />
        {isExternalVideo ? (
          <details className="rounded-lg border border-border bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">進階：使用既有外部影片 URL</summary>
            <div className="mt-3">
              <Field label="影片 URL" name="videoUrl" defaultValue={video?.videoUrl} placeholder="https://..." />
            </div>
            <p className="mt-2 text-xs text-slate-500">URL 僅保留給既有 CDN 或搬遷內容；一般使用請直接上傳檔案。</p>
          </details>
        ) : (
          <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-sm text-slate-700">
            <p className="font-semibold">Cloudflare 播放來源</p>
            <p className="mt-1 text-xs text-slate-500">
              播放網址與 provider mapping 由受保護的 Cloudflare 整合流程管理，商店表單不會覆寫。
            </p>
          </div>
        )}
        <MediaUploadField
          kind="image"
          label="影片縮圖"
          description="可上傳縮圖，或從影片時間軸擷取畫面；裁切只會套用到縮圖，不會剪輯影片。"
          defaultUrl={video?.thumbnailUrl}
          defaultAssetId={video?.thumbnailAssetId}
          urlInputName="thumbnailUrl"
          assetIdInputName="thumbnailAssetId"
          allowExternalUrlFallback
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="長度秒數" name="durationSec" type="number" defaultValue={video?.durationSec ?? 0} readOnly />
          <Field label="估算用量分鐘" name="estimatedMinutes" type="number" defaultValue={video?.estimatedMinutes ?? 0} readOnly />
          <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3">
            <p className="text-sm font-semibold text-slate-700">Stream Key</p>
            <p className="mt-1 text-xs text-slate-500">
              {video?.liveStreamKey ? `已安全保存，streamKeyRef: ${video.id}` : "尚未建立 Live Input"}
            </p>
          </div>
        </div>
        {isExternalVideo ? (
          <SelectField label="狀態" name="status" defaultValue={video?.status ?? "ready"}>
            <option value="ready">ready</option>
            <option value="archived">archived</option>
          </SelectField>
        ) : (
          <VideoProviderStatus
            videoId={video.id}
            initial={{
              resourceId: video.id,
              status: video.status,
              cloudflareReadyToStream: video.cloudflareReadyToStream,
              durationSec: video.durationSec ?? 0,
              estimatedMinutes: video.estimatedMinutes ?? 0,
              thumbnailUrl: video.thumbnailUrl,
              videoUrl: video.videoUrl,
            }}
            durationInputName="durationSec"
            estimatedMinutesInputName="estimatedMinutes"
          />
        )}
        <SubmitButton />
      </form>
    </Card>
  );
}

function videoFormError(error: string) {
  if (error === "invalid_video") return "請先完成影片上傳，或在進階區提供有效的 HTTPS 影片 URL。";
  if (error === "invalid_image_asset") return "影片縮圖不是目前商家的已完成資產，請重新上傳或移除。";
  if (error === "not_found") return "找不到這支影片，可能已被移除或不屬於目前商家。";
  if (error === "video_processing") return "Cloudflare 尚未確認這支影片可播放；請等待狀態更新後再儲存或綁定直播。";
  return "影片資料無法儲存，請檢查後再試。";
}
