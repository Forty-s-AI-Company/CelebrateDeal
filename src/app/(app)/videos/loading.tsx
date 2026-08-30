export default function VideosLoading() {
  return (
    <section aria-busy="true" aria-live="polite" aria-labelledby="videos-loading-title" className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 id="videos-loading-title" className="text-2xl font-semibold text-slate-950">正在載入影片庫</h1>
          <p className="text-sm text-slate-500">正在整理影片與處理狀態。</p>
        </div>
        <div className="h-11 w-24 animate-pulse motion-reduce:animate-none rounded-md bg-slate-200" aria-hidden="true" />
      </div>
      <span role="status" className="sr-only">正在載入影片庫，請稍候。</span>
      <div className="rounded-xl border border-slate-200 bg-white p-5" aria-hidden="true">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div className="h-11 animate-pulse motion-reduce:animate-none rounded-md bg-slate-100" />
          <div className="h-11 animate-pulse motion-reduce:animate-none rounded-md bg-slate-100" />
          <div className="h-11 animate-pulse motion-reduce:animate-none rounded-md bg-slate-200" />
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse motion-reduce:animate-none rounded-lg border border-slate-100 bg-slate-50" />
        ))}
      </div>
    </section>
  );
}
