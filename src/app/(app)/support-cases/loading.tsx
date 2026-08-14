export default function SupportCasesLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="grid gap-4">
      <p className="text-sm font-medium text-slate-600">正在載入客服案件…</p>
      {[0, 1, 2].map((item) => <div key={item} aria-hidden="true" className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />)}
    </div>
  );
}
