import type { Video } from "@prisma/client";
import { upsertVideoAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, SelectField, SubmitButton, TextArea } from "@/components/ui";

export function VideoForm({ video }: { video?: Video }) {
  return (
    <Card>
      <form action={upsertVideoAction} className="grid gap-4">
        <CsrfField />
        {video ? <input type="hidden" name="id" value={video.id} /> : null}
        <Field label="影片名稱" name="title" required defaultValue={video?.title} />
        <TextArea label="影片描述" name="description" defaultValue={video?.description} />
        <SelectField label="來源類型" name="sourceType" defaultValue={video?.sourceType ?? "url"}>
          <option value="cloudflare_stream">Cloudflare Stream VOD</option>
          <option value="cloudflare_live">Cloudflare Stream Live Input</option>
          <option value="url">外部 URL fallback</option>
        </SelectField>
        <Field label="影片 URL" name="videoUrl" required defaultValue={video?.videoUrl} placeholder="https://..." />
        <Field label="縮圖 URL" name="thumbnailUrl" defaultValue={video?.thumbnailUrl} placeholder="https://..." />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="長度秒數" name="durationSec" type="number" defaultValue={video?.durationSec ?? 0} />
          <Field label="估算用量分鐘" name="estimatedMinutes" type="number" defaultValue={video?.estimatedMinutes ?? 0} />
          <Field label="Stream Video UID" name="cloudflareStreamUid" defaultValue={video?.cloudflareStreamUid} />
          <Field label="Live Input UID" name="cloudflareLiveInputUid" defaultValue={video?.cloudflareLiveInputUid} />
          <Field label="Playback ID" name="cloudflarePlaybackId" defaultValue={video?.cloudflarePlaybackId} />
          <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3">
            <p className="text-sm font-semibold text-slate-700">Stream Key</p>
            <p className="mt-1 text-xs text-slate-500">
              {video?.liveStreamKey ? `已安全保存，streamKeyRef: ${video.id}` : "尚未建立 Live Input"}
            </p>
          </div>
        </div>
        <Field label="Live Input 狀態" name="liveInputStatus" defaultValue={video?.liveInputStatus} placeholder="connected / idle" />
        <SelectField label="狀態" name="status" defaultValue={video?.status ?? "ready"}>
          <option value="ready">ready</option>
          <option value="processing">processing</option>
          <option value="archived">archived</option>
        </SelectField>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input name="cloudflareReadyToStream" type="checkbox" defaultChecked={video?.cloudflareReadyToStream ?? false} className="h-4 w-4 accent-blue-600" />
          Cloudflare ready to stream
        </label>
        <SubmitButton />
      </form>
    </Card>
  );
}
