export default function ProtectedAppLoading() {
  return (
    <section aria-busy="true" aria-live="polite" aria-labelledby="protected-app-loading-title" className="grid gap-6">
      <div>
        <h1 id="protected-app-loading-title" className="text-2xl font-semibold text-slate-950">正在載入工作區</h1>
        <p className="mt-2 text-sm text-slate-600">正在整理頁面資料，請稍候。</p>
      </div>
      <span role="status" className="sr-only">正在載入工作區內容，請稍候。</span>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-white" />
        ))}
      </div>
    </section>
  );
}
