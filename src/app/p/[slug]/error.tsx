"use client";

export default function Error() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm" role="alert">
        <h1 className="text-xl font-bold text-slate-950">頁面暫時無法載入</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">請稍後再試。</p>
      </section>
    </main>
  );
}
