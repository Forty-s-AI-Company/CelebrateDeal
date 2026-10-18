export default function RootLoading() {
  return (
    <main aria-busy="true" aria-live="polite" aria-labelledby="root-loading-title" className="mx-auto grid min-h-[40vh] w-full min-w-0 max-w-5xl content-start gap-5 overflow-x-hidden px-4 py-8">
      <span id="root-loading-title" role="status" className="sr-only">正在載入頁面，請稍候。</span>
      <div className="h-8 w-56 max-w-full animate-pulse motion-reduce:animate-none rounded bg-slate-200" aria-hidden="true" />
      <div className="h-4 w-full max-w-96 animate-pulse motion-reduce:animate-none rounded bg-slate-100" aria-hidden="true" />
      <div className="grid min-w-0 gap-4 md:grid-cols-2" aria-hidden="true">
        <div className="h-36 min-w-0 w-full animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-white" />
        <div className="h-36 min-w-0 w-full animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-white" />
      </div>
    </main>
  );
}
