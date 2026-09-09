export default function DashboardKpisLoading() {
  return (
    <section data-dashboard-scope="kpis-shell" aria-busy="true" aria-live="polite" aria-label="正在載入 Dashboard KPI" className="grid gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
        <div className="min-h-44 rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] md:col-span-2">
          <div className="h-4 w-28 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
          <div className="mt-7 grid gap-6 sm:grid-cols-2 sm:divide-x sm:divide-slate-200">
            {Array.from({ length: 2 }, (_, index) => (
              <div key={index} className={index === 1 ? "sm:pl-6" : undefined}>
                <div className="h-3 w-32 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
                <div className="mt-3 h-10 w-24 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
                <div className="mt-3 h-5 w-36 animate-pulse rounded-full bg-slate-200/70 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </div>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="min-h-44 rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <div className="h-3 w-24 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
            <div className="mt-6 h-9 w-20 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
            <div className="mt-4 h-5 w-32 animate-pulse rounded-full bg-slate-200/70 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)]" aria-hidden="true">
        <div className="h-3 w-32 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
        <div className="mt-3 h-6 w-52 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
        <div className="mt-2 h-4 w-full max-w-2xl animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
        <div className="mt-6 grid items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:pb-9">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="contents">
              <div className={`min-h-44 rounded-xl border border-slate-200 bg-white p-4 ${["lg:mt-0", "lg:mt-3", "lg:mt-6", "lg:mt-9"][index]}`}>
                <div className="h-3 w-28 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
                <div className="mt-3 h-4 w-24 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
                <div className="mt-5 h-8 w-16 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
                <div className="mt-4 h-2 w-full animate-pulse rounded-full bg-slate-200/70 motion-reduce:animate-none" />
                <div className="mt-3 h-5 w-20 animate-pulse rounded-full bg-slate-200/70 motion-reduce:animate-none" />
              </div>
              {index < 3 ? <div className="mx-auto h-5 w-5 animate-pulse rounded-full bg-slate-200/70 motion-reduce:animate-none lg:my-auto" /> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
