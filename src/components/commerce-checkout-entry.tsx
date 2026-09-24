"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CommerceCheckoutForm, type CommerceCheckoutFormProps } from "@/components/commerce-checkout-form";
import { CommerceCheckoutRecoveryResponseSchema } from "@/lib/commerce-checkout";
import {
  clearCheckoutIdempotencyKey,
  clearCheckoutRecoveryRecord,
  readCheckoutIdempotencyKey,
  readCheckoutRecoveryRecord,
} from "@/lib/checkout-idempotency";

type Recovery = typeof CommerceCheckoutRecoveryResponseSchema._output;
type Summary = { vendorName?: string; description?: string | null; imageUrl?: string | null };
const fulfillmentLabels = {
  physical: "實體商品 · 付款後由商家安排出貨",
  digital: "數位內容 · 付款後由商家提供存取權",
  service: "預約服務 · 付款後由商家聯繫排程",
  course: "課程 · 付款後由商家開通權益",
};

function formatPrice(priceCents: number, currency: string) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency }).format(priceCents / 100);
}
type State =
  | { kind: "loading" | "unavailable" | "finished" | "error" }
  | { kind: "current" }
  | { kind: "recovered"; terms: Recovery };

function CheckoutContent({ state, current, externalCheckoutUrl, retry, startNewCheckout }: {
  state: State;
  current?: CommerceCheckoutFormProps;
  externalCheckoutUrl?: string;
  retry: () => void;
  startNewCheckout: () => void;
}) {
  if (state.kind === "current" && current) return <CommerceCheckoutForm key="current" {...current} />;
  if (state.kind === "recovered") return <>
    <p className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">已找到原本的待付款訂單。請重新填入與原訂單相同的聯絡、收件、發票及自訂資料；系統會取回原付款方式，不會再建立新訂單。</p>
    <CommerceCheckoutForm key="recovered" {...state.terms} recoveryOnly />
  </>;
  if (state.kind === "loading") return <p role="status" className="text-sm text-slate-600">正在檢查是否有可恢復的訂單…</p>;
  if (state.kind === "error") return <div role="alert" className="space-y-3 text-sm text-slate-700"><p>暫時無法確認原訂單，請稍後再試。尚未建立新訂單。</p><button type="button" className="font-semibold text-blue-700 underline" onClick={retry}>重新檢查</button></div>;
  if (state.kind === "finished") return <div role="status" className="space-y-3 text-sm text-slate-700"><p>原結帳請求已結束。請先查看訂單狀態，避免重複付款。</p>{current ? <button type="button" className="font-semibold text-blue-700 underline" onClick={startNewCheckout}>確認後開始新訂單</button> : null}</div>;
  return <div role="status" className="space-y-3 text-sm text-slate-700"><p>目前無法建立新訂單，也找不到這個瀏覽器先前建立的待付款訂單。</p>{externalCheckoutUrl ? <a className="font-semibold text-blue-700 underline" href={externalCheckoutUrl}>前往商家指定的結帳頁</a> : null}</div>;
}

export function CommerceCheckoutEntry({
  current,
  externalCheckoutUrl,
  summary,
}: {
  current?: CommerceCheckoutFormProps;
  externalCheckoutUrl?: string;
  summary?: Summary;
}) {
  // Defer mutable catalog display until the pending-order lookup finishes.
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  function startNewCheckout() {
    if (!current) return;
    try {
      clearCheckoutIdempotencyKey(window.sessionStorage, current.vendorId, current.productId);
      clearCheckoutRecoveryRecord(window.sessionStorage, window.location.pathname);
      const url = new URL(window.location.href);
      url.searchParams.delete("resume");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // Storage cleanup is best effort; a new admission still validates scope.
    }
    setState({ kind: "current" });
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let record;
      try {
        record = readCheckoutRecoveryRecord(window.sessionStorage, window.location.pathname);
        if (record && readCheckoutIdempotencyKey(window.sessionStorage, record.vendorId, record.productId) !== record.idempotencyKey) {
          record = null;
        }
      } catch {
        record = null;
      }
      if (!record) {
        if (!cancelled) setState({ kind: current ? "current" : "unavailable" });
        return;
      }
      try {
        const response = await fetch("/api/payments/checkout/recovery", {
          method: "POST",
          headers: { "content-type": "application/json", "x-celebratedeal-client": "web" },
          body: JSON.stringify(record),
        });
        if (cancelled) return;
        if (response.status === 404) {
          setState({ kind: current ? "current" : "unavailable" });
          return;
        }
        if (response.status === 409) {
          setState({ kind: "finished" });
          return;
        }
        const parsed = response.ok ? CommerceCheckoutRecoveryResponseSchema.safeParse(await response.json()) : null;
        if (!parsed?.success || parsed.data.vendorId !== record.vendorId || parsed.data.productId !== record.productId) {
          setState({ kind: "error" });
          return;
        }
        setState({ kind: "recovered", terms: parsed.data });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [attempt, current]);

  const terms = state.kind === "recovered" ? state.terms : state.kind === "current" ? current : undefined;
  const form = <CheckoutContent state={state} current={current} externalCheckoutUrl={externalCheckoutUrl} retry={() => setAttempt((value) => value + 1)} startNewCheckout={startNewCheckout} />;

  if (!summary) return form;
  const total = terms?.priceCents !== undefined && terms.currency
    ? formatPrice(terms.priceCents + (state.kind === "recovered" && terms.initialOrderBumpSelected ? terms.orderBump?.priceCents ?? 0 : 0), terms.currency)
    : undefined;
  return <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start">
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="checkout-product-title">
      {state.kind === "current" && summary.imageUrl ? <div className="relative aspect-[4/3] bg-slate-100"><Image src={summary.imageUrl} alt={terms?.productName ?? "商品"} fill unoptimized className="object-cover" priority /></div> : null}
      <div className="p-5 sm:p-6">
        {state.kind === "current" && summary.vendorName ? <p className="text-sm font-semibold text-blue-700">{summary.vendorName}</p> : null}
        <h1 id="checkout-product-title" className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{terms?.productName ?? "結帳訂單"}</h1>
        {total ? <p className="mt-3 text-2xl font-black text-slate-950">{total}</p> : null}
        {terms ? <p className="mt-2 text-sm font-medium text-slate-600">{fulfillmentLabels[terms.fulfillmentType]}</p> : null}
        {state.kind === "current" && summary.description ? <p className="mt-5 whitespace-pre-line text-sm leading-7 text-slate-600">{summary.description}</p> : null}
        {terms && total ? <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><p className="font-semibold">訂單摘要</p><div className="mt-2 flex items-center justify-between gap-4"><span>{terms.productName} × 1{state.kind === "recovered" && terms.initialOrderBumpSelected && terms.orderBump ? `＋${terms.orderBump.title}` : ""}</span><span className="font-bold">{total}</span></div></div> : null}
      </div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="checkout-form-title"><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">安全結帳</p><h2 id="checkout-form-title" className="mt-2 text-2xl font-black text-slate-950">確認購買資料</h2><p className="mt-2 mb-6 text-sm leading-6 text-slate-600">先建立可追蹤訂單，再前往金流商付款。重新送出相同請求不會重複建立訂單。</p>{form}</section>
  </div>;
}
