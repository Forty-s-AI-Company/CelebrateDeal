export default function FormSubmissionsLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="grid gap-4">
      <span className="sr-only">正在載入報名名單。</span>
      <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-36 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}
