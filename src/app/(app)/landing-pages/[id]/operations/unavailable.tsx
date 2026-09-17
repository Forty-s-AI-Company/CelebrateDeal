import Link from "next/link";

/** Expected scope failures reveal neither the resource nor another tenant. */
export default function FunnelOperationsUnavailable() {
  return <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 text-center">
    <h1 className="text-xl font-bold">無法開啟 Funnel</h1>
    <p className="mt-3 text-slate-600">找不到這個 Funnel，或你沒有存取權限。</p>
    <Link href="/landing-pages" className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 font-semibold">返回 Funnel 列表</Link>
  </section>;
}
