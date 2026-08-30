export default function Loading() {
  return (
    <div aria-busy="true" aria-label="正在載入 Stream 使用量對帳" className="animate-pulse space-y-6">
      <div className="h-8 w-56 rounded bg-slate-200" />
      <div className="h-72 rounded-lg border border-border bg-slate-100" />
      <div className="h-80 rounded-lg border border-border bg-slate-100" />
      <span className="sr-only" role="status">正在載入 Stream 使用量對帳…</span>
    </div>
  );
}
