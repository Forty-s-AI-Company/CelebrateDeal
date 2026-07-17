export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm" role="status">
        <h1 className="text-xl font-bold text-slate-950">找不到此公開頁</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">請確認連結是否正確。</p>
      </section>
    </main>
  );
}
