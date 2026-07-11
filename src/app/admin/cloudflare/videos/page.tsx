import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { getCloudflareStreamDiagnostics } from "@/lib/cloudflare-diagnostics";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

function statusTone(status: string, ready: boolean) {
  if (ready || status === "ready") return "green" as const;
  if (status === "failed") return "orange" as const;
  if (status === "processing") return "blue" as const;
  return "gray" as const;
}

export default async function AdminCloudflareVideosPage() {
  const auth = await requirePlatformAdmin();
  const diagnostics = getCloudflareStreamDiagnostics();
  const videos = await getDb().video.findMany({
    where: auth.isPlatformAdmin ? {} : { vendorId: auth.vendor?.id ?? "__none" },
    include: { vendor: true },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });

  return (
    <>
      <PageHeader
        title="Cloudflare 影片檢查"
        description="檢查 Stream UID、Live Input UID、ready 狀態與播放 URL；stream key 只顯示 reference。"
        action={<Link href="/videos" className="text-sm font-semibold text-primary hover:underline">返回影片庫</Link>}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-slate-500">影片總數</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{videos.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Ready</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{videos.filter((video) => video.cloudflareReadyToStream).length}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Live Input</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{videos.filter((video) => video.cloudflareLiveInputUid).length}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Processing</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{videos.filter((video) => video.status === "processing").length}</p>
        </Card>
      </div>

      <Card className="mb-6 border-blue-100 bg-gradient-to-br from-white to-blue-50">
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-950">Cloudflare Stream diagnostics</h2>
              <Badge tone={diagnostics.ok ? "green" : "orange"}>{diagnostics.ok ? "env ready" : "env incomplete"}</Badge>
            </div>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4 rounded-md bg-white/70 px-3 py-2">
                <span className="text-slate-500">Account ID</span>
                <span className="font-mono text-slate-800">{diagnostics.accountId.configured ? `${diagnostics.accountId.length} chars` : "missing"}</span>
              </div>
              <div className="flex justify-between gap-4 rounded-md bg-white/70 px-3 py-2">
                <span className="text-slate-500">Stream token</span>
                <span className="font-mono text-slate-800">{diagnostics.streamToken.shape}</span>
              </div>
              <div className="flex justify-between gap-4 rounded-md bg-white/70 px-3 py-2">
                <span className="text-slate-500">Webhook secret</span>
                <span className="font-mono text-slate-800">{diagnostics.webhookSecret.shape}</span>
              </div>
              <div className="rounded-md bg-white/70 px-3 py-2">
                <p className="text-slate-500">Webhook mode</p>
                <div className="mt-2 grid gap-2">
                  {diagnostics.webhookModes.map((mode) => (
                    <div key={mode.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-100 bg-white px-2 py-1.5">
                      <span className="font-mono text-xs text-slate-800">{mode.id}</span>
                      <Badge tone={mode.configured ? "green" : "orange"}>{mode.configured ? mode.header : "missing secret"}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md bg-white/70 px-3 py-2">
                <p className="text-slate-500">API base</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-800">{diagnostics.apiBase}</p>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-950">`code=10000 Authentication error` 排查順序</h3>
            <ol className="mt-3 grid gap-2 text-sm text-slate-700">
              {diagnostics.likelyAuthenticationErrorCauses.map((cause) => (
                <li key={cause} className="rounded-md border border-blue-100 bg-white/75 px-3 py-2">{cause}</li>
              ))}
            </ol>
            <div className="mt-4 rounded-md border border-border bg-white/75 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">App 目前呼叫的 endpoints</p>
              <div className="mt-2 grid gap-1">
                {diagnostics.endpoints.map((endpoint) => (
                  <p key={endpoint} className="break-all font-mono text-xs text-slate-600">{endpoint}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">影片</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">Stream UID</th>
                <th className="px-4 py-3">Live Input</th>
                <th className="px-4 py-3">Playback</th>
                <th className="px-4 py-3">更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {videos.map((video) => (
                <tr key={video.id} className="align-top">
                  <td className="px-4 py-4">
                    <p className="font-semibold text-slate-950">{video.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{video.vendor.name} · {video.sourceType}</p>
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={statusTone(video.status, video.cloudflareReadyToStream)}>
                      {video.cloudflareReadyToStream ? "ready" : video.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-4 font-mono text-xs text-slate-600">{video.cloudflareStreamUid ?? "-"}</td>
                  <td className="px-4 py-4">
                    <p className="font-mono text-xs text-slate-600">{video.cloudflareLiveInputUid ?? "-"}</p>
                    {video.liveStreamKey ? <p className="mt-1 text-xs text-slate-500">streamKeyRef: {video.id}</p> : null}
                  </td>
                  <td className="px-4 py-4">
                    {video.cloudflarePlaybackId ? (
                      <a href={video.videoUrl} className="break-all text-xs font-semibold text-primary hover:underline" target="_blank" rel="noreferrer">
                        {video.videoUrl}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">尚未建立</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-xs text-slate-500">{formatDateTime(video.updatedAt)}</td>
                </tr>
              ))}
              {videos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">尚未有 Cloudflare 影片 mapping。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
