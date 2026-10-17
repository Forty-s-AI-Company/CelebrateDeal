export default function DashboardKpisLoading() {
  return (
    <section data-dashboard-scope="kpis-shell" aria-busy="true" aria-live="polite" aria-label="正在載入 Dashboard KPI" className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse motion-reduce:animate-none rounded-xl border border-slate-200 bg-slate-100" />
        ))}
      </div>
    </section>
  );
}
