import Link from "next/link";

export default function CommerceCheckoutNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4">
      <section role="status" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
        <h1 className="text-2xl font-black text-slate-950">這個商品目前無法購買</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">商品可能已下架，或結帳連結不完整。系統沒有建立訂單，也不會向你收款。</p>
        <Link href="/" className="mt-6 inline-flex rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">回到首頁</Link>
      </section>
    </main>
  );
}
