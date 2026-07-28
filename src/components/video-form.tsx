import type { Video } from "@prisma/client";
import { upsertVideoAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, SelectField, SubmitButton, TextArea } from "@/components/ui";

export function VideoForm({ video }: { video?: Video }) {
  const isExternalVideo = !video || video.sourceType === "url";

  return (
    <Card>
      <form action={upsertVideoAction} className="grid gap-4">
        <CsrfField />
        {video ? <input type="hidden" name="id" value={video.id} /> : null}
        <Field label="影片名稱" name="title" required defaultValue={video?.title} />
        <TextArea label="影片描述" name="description" defaultValue={video?.description} />
        {isExternalVideo ? (
          <Field label="影片 URL" name="videoUrl" required defaultValue={video?.videoUrl} placeholder="https://..." />
        ) : (
          <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-sm text-slate-700">
            <p className="font-semibold">Cloudflare 播放來源</p>
            <p className="mt-1 text-xs text-slate-500">
              播放網址與 provider mapping 由受保護的 Cloudflare 整合流程管理，商店表單不會覆寫。
            </p>
          </div>
        )}
        <Field label="縮圖 URL" name="thumbnailUrl" defaultValue={video?.thumbnailUrl} placeholder="https://..." />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="長度秒數" name="durationSec" type="number" defaultValue={video?.durationSec ?? 0} />
          <Field label="估算用量分鐘" name="estimatedMinutes" type="number" defaultValue={video?.estimatedMinutes ?? 0} />
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
          <div className="rounded-lg border border-border bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-semibold">Provider 狀態：{video?.status ?? "processing"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {video?.cloudflareReadyToStream ? "Cloudflare 已可播放" : "等待 Cloudflare 狀態回呼"}
            </p>
          </div>
        )}
        <SubmitButton />
      </form>
    </Card>
  );
}
