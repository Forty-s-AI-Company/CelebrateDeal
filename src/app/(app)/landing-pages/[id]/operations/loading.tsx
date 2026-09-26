/** Let client navigation settle while the scoped Funnel editor and reports load. */
export default function FunnelOperationsLoading() {
  return (
    <main className="mx-auto max-w-6xl py-8" aria-busy="true" aria-label="正在載入 Funnel 管理頁">
      <div className="h-8 w-52 animate-pulse motion-reduce:animate-none rounded-lg bg-slate-200" aria-hidden="true" />
      <div className="mt-6 grid gap-4 md:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-slate-100" />
        ))}
      </div>
      <p className="mt-6 text-sm text-slate-600">正在載入 Funnel 管理頁…</p>
    </main>
  );
}
