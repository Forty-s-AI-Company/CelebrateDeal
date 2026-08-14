export default function BuyerSupportRequestsLoading() {
  return (
    <main aria-busy="true" aria-live="polite" className="mx-auto max-w-5xl px-4 py-12">
      <p role="status" className="rounded-md border border-border bg-white p-5 text-sm text-slate-600">正在安全讀取客服案件…</p>
    </main>
  );
}
