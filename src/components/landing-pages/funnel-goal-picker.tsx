"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type FunnelGoal = "audience" | "sell" | "custom" | "webinar";

const GOALS: Array<{ id: FunnelGoal; title: string; description: string; disabled?: boolean }> = [
  { id: "audience", title: "建立名單", description: "收集 Email，預設建立名單頁與感謝頁流程。" },
  { id: "sell", title: "銷售商品或服務", description: "建立訂單與感謝頁；付款串接目前維持方案限制。" },
  { id: "custom", title: "自訂 Funnel", description: "從空白流程開始，自行加入資訊、表單或銷售頁。" },
  { id: "webinar", title: "自動化 Webinar", description: "實測帳戶受 Webinar 方案限制，後續流程仍待驗證。", disabled: true },
];

export function FunnelGoalPicker() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [currency, setCurrency] = useState("TWD");
  const [goal, setGoal] = useState<FunnelGoal>();
  const selected = GOALS.find((item) => item.id === goal);
  const ready = Boolean(name.trim() && domain.trim() && goal && !selected?.disabled);
  function continueToEditor() {
    if (!ready || !goal) return;
    const query = new URLSearchParams({ goal, name: name.trim(), slug: domain.trim(), currency });
    router.push(`/landing-pages/new?${query.toString()}`);
  }
  const field = "mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  return <main className="mx-auto max-w-5xl py-8">
    <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Create funnel</p>
    <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">建立新的 Funnel</h1>
    <p className="mt-2 text-slate-600">先設定基本資料與用途，再進入全畫面編輯器。</p>
    <div className="mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
      <label className="text-sm font-semibold text-slate-700">名稱 *<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} className={field} placeholder="例如：秋季新品名單頁" /></label>
      <label className="text-sm font-semibold text-slate-700">Funnel 網址 *<div className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-300 bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100"><span className="pl-3 text-sm text-slate-400">/lp/</span><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={domain} onChange={(event) => setDomain(event.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, ""))} className="min-w-0 flex-1 bg-transparent px-1 pr-3 text-sm outline-none" placeholder="autumn-launch" /></div></label>
      <label className="text-sm font-semibold text-slate-700">幣別<select value={currency} onChange={(event) => setCurrency(event.target.value)} className={field}><option value="TWD">新台幣 TWD</option><option value="USD">美元 USD</option><option value="EUR">歐元 EUR</option><option value="JPY">日圓 JPY</option></select><span className="mt-1 block text-xs font-normal text-slate-500">目前僅保存建頁選擇；正式付款尚未啟用。</span></label>
    </div>
    <fieldset className="mt-8"><legend className="text-lg font-bold text-slate-950">選擇 Funnel 目標 *</legend><div className="mt-3 grid gap-4 md:grid-cols-2">{GOALS.map((item) => <button key={item.id} type="button" aria-pressed={goal === item.id} onClick={() => setGoal(item.id)} className={`rounded-2xl border p-5 text-left transition ${goal === item.id ? "border-blue-600 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-blue-300"}`}><span className="flex items-center justify-between gap-3"><strong className="text-base text-slate-950">{item.title}</strong>{item.disabled ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">方案限制</span> : null}</span><span className="mt-2 block text-sm leading-6 text-slate-600">{item.description}</span></button>)}</div></fieldset>
    {selected?.disabled ? <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Webinar 在 systeme.io 實測中被方案配額阻擋，預設 steps、模板與排程行為尚未驗證，因此 CelebrateDeal 目前不允許建立，避免產生半完成資料。</p> : null}
    <div className="mt-8 flex justify-end"><button type="button" disabled={!ready} onClick={continueToEditor} className="min-h-11 rounded-xl bg-blue-700 px-6 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40">儲存並進入編輯器</button></div>
  </main>;
}
