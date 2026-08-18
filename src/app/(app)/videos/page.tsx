import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

const videoStatuses = ["ready", "processing", "error", "archived"] as const;
type VideoStatus = (typeof videoStatuses)[number];

const statusLabels: Record<VideoStatus, string> = {
  ready: "可播放",
  processing: "處理中",
  error: "處理失敗",
  archived: "已封存",
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | string[] | undefined): VideoStatus | null {
  const candidate = firstQueryValue(value);
  return videoStatuses.includes(candidate as VideoStatus) ? candidate as VideoStatus : null;
}

function formatDuration(durationSec: number) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return "尚未提供時長";

  const totalSeconds = Math.floor(durationSec);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function statusTone(status: string): "blue" | "orange" | "gray" | "green" | "red" {
  if (status === "ready") return "green";
  if (status === "processing") return "orange";
  if (status === "error") return "red";
  return "gray";
}

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
}) {
  const vendor = await requireVendorManager();
  const query = await searchParams;
  const search = (firstQueryValue(query.q)?.trim() ?? "").slice(0, 128);
  const status = parseStatus(query.status);
  const videos = await getDb().video.findMany({
    where: {
      vendorId: vendor.id,
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const hasFilters = Boolean(search || status);

  return (
    <>
      <PageHeader title="影片庫" description="管理直播回放、預錄影片與可綁定到直播間的播放素材。" action={<ButtonLink href="/videos/new"><Plus size={16} />新增影片</ButtonLink>} />
      <Card className="mb-5">
        <form method="get" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto_auto] md:items-end">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            搜尋影片
            <input
              name="q"
              defaultValue={search}
              maxLength={128}
              placeholder="搜尋名稱或描述"
              className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            影片狀態
            <select
              name="status"
              defaultValue={status ?? ""}
              className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
            >
              <option value="">全部狀態</option>
              {videoStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
            </select>
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark">套用篩選</button>
          {hasFilters ? <Link href="/videos" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">清除篩選</Link> : null}
        </form>
      </Card>
      {videos.length === 0 ? (
        <EmptyState
          title={hasFilters ? "找不到符合條件的影片" : "還沒有影片"}
          description={hasFilters ? "請調整搜尋文字或狀態條件後再試。" : "先新增一支影片，直播間就能綁定播放內容。"}
          action={hasFilters ? <Link href="/videos" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-slate-700">清除篩選</Link> : <ButtonLink href="/videos/new">新增影片</ButtonLink>}
        />
      ) : (
        <Card>
          <div className="grid gap-3">
            {videos.map((video) => {
              const knownStatus = parseStatus(video.status);
              return (
                <article key={video.id} className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-slate-950 [overflow-wrap:anywhere]">{video.title}</h2>
                      <Badge tone={statusTone(video.status)}>{knownStatus ? statusLabels[knownStatus] : "未知狀態"}</Badge>
                    </div>
                    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
                      <div><dt className="inline">影片長度：</dt><dd className="inline">{formatDuration(video.durationSec)}</dd></div>
                      <div><dt className="inline">來源：</dt><dd className="inline">{video.sourceType === "cloudflare_stream" ? "Cloudflare Stream" : "外部影片"}</dd></div>
                    </dl>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Link href={`/videos/${encodeURIComponent(video.id)}/edit`} className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-white transition hover:bg-primary-dark">編輯</Link>
                    <Link href={`/videos/${encodeURIComponent(video.id)}/preview`} className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">預覽</Link>
                  </div>
                </article>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}
