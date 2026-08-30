export default function DashboardLoading() {
  return (
    <main data-dashboard-scope="route-shell" aria-busy="true" aria-live="polite" aria-labelledby="dashboard-loading-title" className="grid gap-6">
      <div>
        <h1 id="dashboard-loading-title" className="text-2xl font-semibold text-slate-950">正在載入營運總覽</h1>
        <p className="mt-2 text-sm text-slate-500">正在整理報名、觀看、訂單與 Email 寄送狀態。</p>
      </div>
      <span role="status" className="sr-only">正在載入 Dashboard，請稍候。</span>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-slate-100" />
        ))}
      </div>
    </main>
  );
}
