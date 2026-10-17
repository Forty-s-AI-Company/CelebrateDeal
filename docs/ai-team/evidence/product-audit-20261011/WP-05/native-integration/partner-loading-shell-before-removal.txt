export default function Loading() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8" aria-busy="true" aria-live="polite">
      <div className="mx-auto h-80 w-full max-w-3xl animate-pulse rounded-2xl bg-slate-200" />
      <span className="sr-only">正在載入合作夥伴頁面</span>
    </main>
  );
}
