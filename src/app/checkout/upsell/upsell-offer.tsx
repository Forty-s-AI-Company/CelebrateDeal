"use client";

import { useState } from "react";
import { formatPostPurchaseAmount, type PostPurchaseOffer } from "@/lib/post-purchase-offer";

export function UpsellOffer({ grantId, initialOffer }: { grantId: string; initialOffer: PostPurchaseOffer }) {
  const [offer] = useState(initialOffer);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function decide(decision: "accept" | "decline") {
    if (pending) return;
    setPending(true);
    setStatus(decision === "accept" ? "正在建立安全加購入口…" : "正在處理你的選擇…");
    try {
      const response = await fetch("/api/checkout/upsell", {
        method: "POST",
        headers: { "content-type": "application/json", "x-celebratedeal-client": "web" },
        body: JSON.stringify({ grantId, decision, kind: offer.kind }),
      });
      const body = await response.json() as { checkoutHref?: string; next?: "downsell" | "complete" };
      if (!response.ok) throw new Error("unavailable");
      if (body.checkoutHref) {
        window.location.assign(body.checkoutHref);
        return;
      }
      if (body.next === "downsell" && offer.kind === "upsell") {
        // The server intentionally does not trust a client-selected product;
        // reload to obtain the separately configured, tenant-bound downsell.
        window.location.assign(`${window.location.pathname}?grant=${encodeURIComponent(grantId)}&offer=downsell`);
        return;
      }
      window.location.assign("/checkout/result");
    } catch {
      setStatus("目前無法處理這項優惠；尚未建立任何加購訂單，請稍後再試。 ");
      setPending(false);
    }
  }

  const title = offer.kind === "upsell" ? "🎉 恭喜購課！這裡有你的專屬特權" : "等等，還有一個更輕量的方案";
  const acceptLabel = offer.kind === "upsell" ? "立即用優惠價加購" : "選擇這個限時方案";
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-white px-4 py-10 sm:py-16">
      <section className="mx-auto max-w-2xl rounded-3xl border border-amber-200 bg-white p-6 shadow-xl shadow-amber-100/70 sm:p-10" aria-labelledby="upsell-title">
        <p className="text-sm font-black tracking-wide text-orange-700">付款完成後專屬優惠</p>
        <h1 id="upsell-title" className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
        <p className="mt-5 text-lg leading-8 text-slate-700">
          {offer.kind === "upsell" ? "把學習成果再往前推一步。" : "保留現在最需要的支持，依然能穩穩往前。"}
        </p>
        <div className="mt-7 rounded-2xl border-2 border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50 p-6">
          <p className="text-xl font-black text-slate-950">{offer.productName}</p>
          <p className="mt-3 text-sm font-semibold text-slate-600">本次只要補差價</p>
          <p className="mt-1 text-4xl font-black text-orange-700">{formatPostPurchaseAmount(offer.amountCents, offer.currency)}</p>
          {offer.discountCents > 0 ? <p className="mt-2 text-sm text-slate-600">已套用專屬折抵</p> : null}
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-600">點擊後會沿用已驗證的買家聯絡資料建立新的加購結帳；付款仍在金流商安全頁完成，不會重複扣原訂單。</p>
        <div className="mt-7 grid gap-3">
          <button type="button" onClick={() => decide("accept")} disabled={pending} className="min-h-12 rounded-xl bg-orange-600 px-5 py-3 text-base font-black text-white hover:bg-orange-700 disabled:opacity-60">{acceptLabel} →</button>
          <button type="button" onClick={() => decide("decline")} disabled={pending} className="min-h-11 rounded-xl px-5 py-3 text-sm font-bold text-slate-600 underline underline-offset-4 hover:text-slate-950 disabled:opacity-60">{offer.kind === "upsell" ? "先不用，看看另一個方案" : "放棄此優惠，前往學員中心"}</button>
        </div>
        <p role="status" aria-live="polite" className="mt-4 min-h-6 text-center text-sm font-semibold text-slate-600">{status}</p>
      </section>
    </main>
  );
}
