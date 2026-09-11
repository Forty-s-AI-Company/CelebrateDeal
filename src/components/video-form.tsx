import type { Video } from "@prisma/client";
import { upsertVideoAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { MediaUploadField } from "@/components/media-upload-field";
import { VideoProviderStatus } from "@/components/video-provider-status";
import Link from "next/link";
import { AdvancedSettings, Field, FormActions, FormLayout, FormSection, SelectField, SubmitButton, TextArea } from "@/components/ui";

type VideoWithImageAsset = Video & { thumbnailAssetId?: string | null };

export function VideoForm({ video, error }: { video?: VideoWithImageAsset; error?: string }) {
  const isExternalVideo = !video || video.sourceType === "url";

  return (
    <FormLayout>
      <form action={upsertVideoAction} className="grid gap-5">
        <CsrfField />
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{videoFormError(error)}</p> : null}
        <FormSection title="基本資料" description="這些資訊會顯示在影片庫，方便團隊辨識與搜尋素材。">
          <div className="grid gap-4">
            <Field label="影片名稱" name="title" required defaultValue={video?.title} />
            <TextArea label="影片描述" name="description" defaultValue={video?.description} />
          </div>
        </FormSection>
        <FormSection title="影片內容" description="上傳完成後仍需儲存，系統才會把名稱、縮圖與影片資料一起套用。">
          <MediaUploadField
            kind="video"
            label={video ? "替換影片檔案" : "影片檔案"}
            description="檔案會安全上傳並自動處理成可播放格式。上傳期間可以取消或重試。"
            defaultResourceId={video?.id}
            resourceIdInputName="id"
            titleInputName="title"
            durationInputName="durationSec"
            estimatedMinutesInputName="estimatedMinutes"
          />
        </FormSection>
        <FormSection title="封面縮圖" description="清楚的縮圖能讓團隊更快找到素材，也會用於部分公開預覽。">
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
        </FormSection>
        <AdvancedSettings description="外部影片來源、系統計算資訊與素材狀態，一般上傳不需調整。">
          {isExternalVideo ? <>
            <Field label="既有外部影片網址" name="videoUrl" defaultValue={video?.videoUrl} placeholder="https://..." />
            <p className="-mt-2 text-xs text-slate-500">僅供既有 CDN 或搬遷內容使用；一般素材請直接上傳檔案。</p>
          </> : (
          <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-sm text-slate-700">
            <p className="font-semibold">播放來源已由系統管理</p>
            <p className="mt-1 text-xs text-slate-500">
              Cloudflare 播放來源與服務對應會自動維護，這個表單不會覆寫。
            </p>
          </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
          <Field label="系統偵測長度（秒）" name="durationSec" type="number" defaultValue={video?.durationSec ?? 0} readOnly />
          <Field label="系統估算用量（分鐘）" name="estimatedMinutes" type="number" defaultValue={video?.estimatedMinutes ?? 0} readOnly />
          <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3">
            <p className="text-sm font-semibold text-slate-700">直播輸入連線</p>
            <p className="mt-1 text-xs text-slate-500">
              {video?.liveStreamKey ? "已安全連線，敏感資訊不會顯示在此頁。" : "尚未建立直播輸入來源。"}
            </p>
          </div>
          </div>
        {isExternalVideo ? (
          <SelectField label="素材狀態" name="status" defaultValue={video?.status ?? "ready"}>
            <option value="ready">可播放</option>
            <option value="archived">已封存</option>
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
        </AdvancedSettings>
        <FormActions>
          <Link href="/videos" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</Link>
          <SubmitButton>{video ? "儲存變更" : "儲存影片"}</SubmitButton>
        </FormActions>
      </form>
    </FormLayout>
  );
}

function videoFormError(error: string) {
  if (error === "invalid_video") return "請先完成影片上傳，或在進階區提供有效的 HTTPS 影片 URL。";
  if (error === "invalid_image_asset") return "影片縮圖不是目前商家的已完成資產，請重新上傳或移除。";
  if (error === "not_found") return "找不到這支影片，可能已被移除或不屬於目前商家。";
  if (error === "video_processing") return "Cloudflare 尚未確認這支影片可播放；請等待狀態更新後再儲存或綁定直播。";
  return "影片資料無法儲存，請檢查後再試。";
}
