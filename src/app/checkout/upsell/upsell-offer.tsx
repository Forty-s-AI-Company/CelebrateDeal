"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPostPurchaseAmount, type PostPurchaseOffer } from "@/lib/post-purchase-offer";

export function UpsellOffer({ grantId, vendorId, initialOffer: offer, csrfToken }: {
  grantId: string; vendorId: string; initialOffer: PostPurchaseOffer; csrfToken: string;
}) {
  const router = useRouter();
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  async function decide(decision: "accept" | "decline") {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 8_000);
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/checkout/upsell", { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-celebratedeal-client": "web", "x-csrf-token": csrfToken },
        body: JSON.stringify({ grantId, kind: offer.kind, decision }), signal: controller.signal });
      if (!response.ok) throw new Error("unavailable");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object") throw new Error("invalid-response");
      if (decision === "accept" && "checkoutHref" in body && typeof body.checkoutHref === "string") {
        const target = new URL(body.checkoutHref, window.location.origin);
        if (target.origin !== window.location.origin || target.pathname !== `/checkout/${encodeURIComponent(vendorId)}/${encodeURIComponent(offer.productId)}`
          || target.searchParams.get("postPurchase") !== "1" || !/^ppu1\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{43}$/u.test(target.searchParams.get("postPurchaseToken") ?? "")) throw new Error("invalid-handoff");
        router.push(`${target.pathname}${target.search}`);
      } else if (decision === "decline" && "next" in body && body.next === "downsell" && offer.kind === "upsell") {
        router.push(`/checkout/upsell?grant=${encodeURIComponent(grantId)}&offer=downsell`);
      } else if (decision === "decline" && "next" in body && body.next === "complete") router.push("/checkout/result");
      else throw new Error("invalid-response");
    } catch {
      // A lost response creates no payment here. Reconfirm this same offer;
      // actual checkout still requires its own admission and explicit submit.
      if (!controller.signal.aborted || request.current === controller) setError("目前無法確認加購選擇，請稍後重試或先查看原訂單。");
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setPending(false); }
    }
  }

  return <main className="mx-auto max-w-xl px-4 py-12" aria-labelledby="upsell-title">
    <p className="text-sm font-semibold text-blue-700">{offer.kind === "upsell" ? "購買後升級" : "另一個加購方案"}</p>
    <h1 id="upsell-title" className="mt-3 text-2xl font-bold">{offer.productName}</h1>
    <p className="mt-4 text-slate-700">原訂單已付款金額將折抵本次升級，需再支付 {formatPostPurchaseAmount(offer.amountCents, offer.currency)}。</p>
    <p className="mt-2 text-sm text-slate-600">每筆原訂單只能使用一次折抵。原訂單退款後，升級方案的權益也會停止。</p>
    <div className="mt-6 flex flex-wrap gap-3"><button type="button" disabled={pending} onClick={() => void decide("accept")} className="min-h-11 rounded-lg bg-blue-700 px-5 text-white disabled:opacity-50">確認加購，前往結帳</button>
      <button type="button" disabled={pending} onClick={() => void decide("decline")} className="min-h-11 rounded-lg border px-5 disabled:opacity-50">暫時不用</button></div>
    {pending ? <p role="status" className="mt-4">正在確認選擇…</p> : null}
    {error ? <p role="alert" className="mt-4 text-red-700">{error}</p> : null}
    <Link className="mt-6 inline-block underline" href="/checkout/result">查看原訂單</Link>
  </main>;
}
