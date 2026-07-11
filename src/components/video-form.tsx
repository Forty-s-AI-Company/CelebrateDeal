import type { Video } from "@prisma/client";
import { upsertVideoAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, SubmitButton, TextArea } from "@/components/ui";

export function VideoForm({ video }: { video?: Video }) {
  const providerManaged = Boolean(video && video.sourceType !== "url");
  return (
    <Card>
      <form action={upsertVideoAction} className="grid gap-4">
        <CsrfField />
        {video ? <input type="hidden" name="id" value={video.id} /> : null}
        <Field label="影片名稱" name="title" required defaultValue={video?.title} />
        <TextArea label="影片描述" name="description" defaultValue={video?.description} />
        {providerManaged ? (
          <div className="grid gap-3 rounded-md border border-blue-100 bg-blue-50 p-4 text-sm">
            <div className="flex items-center justify-between gap-3"><span className="font-semibold text-slate-900">Cloudflare mapping</span><span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-700">{video?.status}</span></div>
            <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2"><div><dt>來源</dt><dd className="mt-1 font-mono text-slate-900">{video?.sourceType}</dd></div><div><dt>Playback reference</dt><dd className="mt-1 truncate font-mono text-slate-900">{video?.cloudflarePlaybackId ?? "等待 webhook"}</dd></div></dl>
            <p className="text-xs text-slate-500">播放 UID、ready 狀態與 URL 只由 Cloudflare API／webhook 更新。</p>
          </div>
        ) : <Field label="外部影片 URL" name="videoUrl" required defaultValue={video?.videoUrl} placeholder="https://..." />}
        <Field label="縮圖 URL" name="thumbnailUrl" defaultValue={video?.thumbnailUrl} placeholder="https://..." />
        {!providerManaged ? <div className="grid gap-4 md:grid-cols-2">
          <Field label="長度秒數" name="durationSec" type="number" defaultValue={video?.durationSec ?? 0} />
          <Field label="估算用量分鐘" name="estimatedMinutes" type="number" defaultValue={video?.estimatedMinutes ?? 0} />
        </div> : null}
        <SubmitButton />
      </form>
    </Card>
  );
}
