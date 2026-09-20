"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { landingPageAction } from "@/app/actions/landing-page-actions";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";

export type FunnelGoal = "audience" | "sell" | "custom" | "webinar";

const GOALS: Array<{ id: FunnelGoal; title: string; description: string; disabled?: boolean }> = [
  { id: "audience", title: "建立名單", description: "收集 Email，預設建立名單頁與感謝頁流程。" },
  { id: "sell", title: "銷售商品或服務", description: "建立訂單與感謝頁；正式付款會在完成商品與金流設定後啟用。" },
  { id: "custom", title: "自訂 Funnel", description: "從空白流程開始，自行加入資訊、表單或銷售頁。" },
  { id: "webinar", title: "自動化 Webinar", description: "建立報名、感謝與播放頁，串接既有活動並設定播放與重播期間。" },
];

export function FunnelGoalPicker({ csrfName, csrfToken, initialGoal, initialName = "", initialSlug = "", initialCurrency = "TWD" }: { csrfName: string; csrfToken: string; initialGoal?: FunnelGoal; initialName?: string; initialSlug?: string; initialCurrency?: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [domain, setDomain] = useState(initialSlug);
  const [currency, setCurrency] = useState(initialCurrency);
  const [goal, setGoal] = useState<FunnelGoal | undefined>(initialGoal);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const selected = GOALS.find((item) => item.id === goal);
  const ready = Boolean(name.trim() && domain.trim() && goal && !selected?.disabled);
  function createFunnel() {
    if (!ready || !goal || inFlight.current) return;
    const content = createGoalFunnelStepPages({ id: "funnel_flow", name: name.trim(), goal, domain: domain.trim(), currency });
    if (!content) { setMessage("Funnel 初始資料無法建立，請檢查名稱與網址。"); return; }
    inFlight.current = true;
    const data = new FormData();
    data.set(csrfName, csrfToken);
    data.set("operation", "create");
    data.set("revision", "1");
    data.set("name", name.trim());
    data.set("slug", domain.trim());
    data.set("formId", "");
    data.set("liveId", "");
    data.set("content", JSON.stringify(content));
    startTransition(async () => {
      try {
        const result = await landingPageAction({ status: "success", message: "" }, data);
        setMessage(result.message);
        if (result.status === "success" && result.id) router.push(`/landing-pages/${result.id}/operations`);
      } catch { setMessage("連線中斷，Funnel 尚未建立，請稍後再試。"); }
      finally { inFlight.current = false; }
    });
  }
  const field = "mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  return <main className="mx-auto max-w-5xl py-8">
    <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Create funnel</p>
    <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">建立新的 Funnel</h1>
    <p className="mt-2 text-slate-600">先設定基本資料與用途；建立後會進入 Funnel 管理與模板選擇。</p>
    <div className="mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
      <label className="text-sm font-semibold text-slate-700">名稱 *<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} className={field} placeholder="例如：秋季新品名單頁" /></label>
      <label className="text-sm font-semibold text-slate-700">Funnel 網址 *<div className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-300 bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100"><span className="pl-3 text-sm text-slate-400">/lp/</span><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={domain} onChange={(event) => setDomain(event.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, ""))} className="min-w-0 flex-1 bg-transparent px-1 pr-3 text-sm outline-none" placeholder="autumn-launch" /></div></label>
      <label className="text-sm font-semibold text-slate-700">幣別<select value={currency} onChange={(event) => setCurrency(event.target.value)} className={field}><option value="TWD">新台幣 TWD</option><option value="USD">美元 USD</option><option value="EUR">歐元 EUR</option><option value="JPY">日圓 JPY</option></select><span className="mt-1 block text-xs font-normal text-slate-500">此為建頁偏好；實際結帳幣別以綁定商品為準，不會自動換匯。</span></label>
    </div>
    <fieldset className="mt-8"><legend className="text-lg font-bold text-slate-950">選擇 Funnel 目標 *</legend><div className="mt-3 grid gap-4 md:grid-cols-2">{GOALS.map((item) => <button key={item.id} type="button" aria-pressed={goal === item.id} onClick={() => setGoal(item.id)} className={`rounded-2xl border p-5 text-left transition ${goal === item.id ? "border-blue-600 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-blue-300"}`}><span className="flex items-center justify-between gap-3"><strong className="text-base text-slate-950">{item.title}</strong>{item.disabled ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">開發中</span> : null}</span><span className="mt-2 block text-sm leading-6 text-slate-600">{item.description}</span></button>)}</div></fieldset>
    {selected?.disabled ? <p role="status" className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">自動化 Webinar 目前仍在開發中，完成編輯、排程與播放流程後會開放建立。</p> : null}
    {message ? <p role="status" className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">{message}</p> : null}
    <div className="mt-8 flex justify-end"><button type="button" disabled={!ready || pending} onClick={createFunnel} className="min-h-11 cursor-pointer rounded-xl bg-blue-700 px-6 font-semibold text-white transition-colors duration-200 hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">{pending ? "建立中…" : "儲存"}</button></div>
  </main>;
}
