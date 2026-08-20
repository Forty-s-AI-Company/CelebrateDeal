export default function DashboardDetailsLoading() {
  return (
    <div data-dashboard-scope="details-shell" role="status" aria-busy="true" aria-live="polite" aria-label="正在載入 Dashboard 明細" className="grid gap-6">
      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="h-72 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-white" />
        <div className="h-72 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-white" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-56 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-white" />
        <div className="h-56 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-white" />
        <div className="h-56 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-white" />
      </div>
    </div>
  );
}
