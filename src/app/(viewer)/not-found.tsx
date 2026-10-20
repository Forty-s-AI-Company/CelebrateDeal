import Link from "next/link";
import { HistoryBackButton } from "@/components/history-back-button";

export default function ViewerNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm" role="status">
        <h1 className="text-sm font-semibold tracking-widest text-slate-500">404</h1>
        <h2 className="mt-1 text-xl font-bold text-slate-950">找不到這個頁面</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">這場直播可能尚未開放、已經結束，或連結不完整。請向主辦單位確認最新的直播連結。</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <HistoryBackButton />
          <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
            回首頁
          </Link>
        </div>
      </section>
    </main>
  );
}
