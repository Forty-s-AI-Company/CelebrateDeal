export default function VideoDetailLoading() {
  return (
    <section aria-busy="true" aria-live="polite" aria-labelledby="video-detail-loading-title" className="grid gap-5">
      <div className="grid gap-2">
        <h1 id="video-detail-loading-title" className="text-2xl font-semibold text-slate-950">正在載入影片</h1>
        <p className="text-sm text-slate-500">正在讀取影片資訊與播放狀態。</p>
      </div>
      <span role="status" className="sr-only">正在載入影片內容，請稍候。</span>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]" aria-hidden="true">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="aspect-video animate-pulse motion-reduce:animate-none bg-slate-200" />
          <div className="grid gap-3 p-6">
            <div className="h-6 w-2/3 animate-pulse motion-reduce:animate-none rounded bg-slate-200" />
            <div className="h-20 animate-pulse motion-reduce:animate-none rounded bg-slate-100" />
          </div>
        </div>
        <div className="h-56 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-white" />
      </div>
    </section>
  );
}
