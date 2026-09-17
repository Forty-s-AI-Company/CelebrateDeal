"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { readFunnelOperations, updateFunnelOperations } from "@/app/actions/funnel-operations-actions";
import { FunnelAutomationSettings } from "@/components/landing-pages/funnel-automation-settings";
import { type FunnelOperations, type FunnelExperiment } from "@/lib/funnel-operations";
import type { FunnelOperationsEditor, FunnelReports } from "@/lib/funnel-operations-service";

const tabs = ["Automation Rules", "A/B Test", "Stats", "Leads", "Sales", "Deadline Settings", "Funnel Settings"] as const;
type Tab = typeof tabs[number];
const control = "min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
const button = `${control} font-semibold hover:bg-slate-50`;
type Settings = Pick<FunnelOperationsEditor, "name" | "slug" | "currency" | "operations">;
type Steps = FunnelOperationsEditor["steps"];

export function FunnelOperationsPanel({ initial, initialReports, csrfName, csrfToken }: { initial: FunnelOperationsEditor; initialReports: FunnelReports; csrfName: string; csrfToken: string }) {
  const [editor, setEditor] = useState(initial);
  const [reports, setReports] = useState(initialReports);
  const [tab, setTab] = useState<Tab>("Funnel Settings");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function change(patch: Partial<Settings>) { setEditor((value) => ({ ...value, ...patch })); setDirty(true); }
  function operations(next: FunnelOperations) { change({ operations: next }); }
  function reload() {
    if (dirty && !window.confirm("重新載入會捨棄這次尚未儲存的設定，確定繼續？")) return;
    startTransition(async () => {
      try { const loaded = await readFunnelOperations(editor.pageId); setEditor(loaded.editor); setReports(loaded.reports); setDirty(false); setMessage("已重新載入最新版本。"); }
      catch { setMessage("無法重新載入，請稍後再試。"); }
    });
  }
  function save() {
    startTransition(async () => {
      const data = new FormData(); data.set(csrfName, csrfToken);
      data.set("settings", JSON.stringify({ pageId: editor.pageId, revision: editor.revision, name: editor.name, slug: editor.slug, currency: editor.currency, operations: editor.operations }));
      const result = await updateFunnelOperations(data);
      setMessage(result.message);
      if (result.ok) {
        setEditor((value) => ({ ...value, revision: result.revision })); setDirty(false);
        try { const loaded = await readFunnelOperations(editor.pageId); setReports(loaded.reports); }
        catch { setMessage("設定已儲存，但報表尚未重新載入。"); }
      }
    });
  }
  return <section aria-label="Funnel 管理" className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">{editor.name}</h1><p className="text-sm text-slate-500">Funnel 管理 · revision {editor.revision}</p></div><Link href={`/landing-pages/${editor.pageId}`} className={button}>返回頁面編輯器</Link></header>
    <nav aria-label="Funnel 次要分頁" className="flex flex-wrap gap-2">{tabs.map((item) => <button type="button" key={item} aria-pressed={tab === item} className={`${button} ${tab === item ? "border-blue-600 text-blue-700" : ""}`} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === "Automation Rules" ? <FunnelAutomationSettings pageId={editor.pageId} csrfName={csrfName} csrfToken={csrfToken} /> : <fieldset disabled={pending} className="space-y-4">
      <legend className="mb-4 text-lg font-bold">{tab}</legend>
      {tab === "Funnel Settings" ? <GlobalSettings editor={editor} change={change} /> : null}
      {tab === "A/B Test" ? <ExperimentSettings value={editor.operations.experiment} steps={editor.steps} onChange={(experiment) => operations({ ...editor.operations, experiment })} /> : null}
      {tab === "Deadline Settings" ? <DeadlineSettings value={editor.operations.deadline} steps={editor.steps} onChange={(deadline) => operations({ ...editor.operations, deadline })} /> : null}
      {tab === "Stats" || tab === "Leads" || tab === "Sales" ? <ReportSettings tab={tab} editor={editor} reports={reports} onChange={operations} /> : null}
      <div className="flex flex-wrap items-center gap-3 border-t pt-4"><button type="button" className={`${button} border-blue-600 text-blue-700`} onClick={save}>儲存設定</button><button type="button" className={button} onClick={reload}>重新載入</button><span className="text-sm text-slate-500">{pending ? "處理中…" : dirty ? "尚未儲存" : "已儲存"}</span></div>
    </fieldset>}
    {message ? <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm">{message}</p> : null}
  </section>;
}

function GlobalSettings({ editor, change }: { editor: FunnelOperationsEditor; change: (patch: Partial<Settings>) => void }) {
  return <div className="grid max-w-2xl gap-4">
    <label className="grid gap-1 text-sm">名稱<input className={control} value={editor.name} onChange={(event) => change({ name: event.target.value })} maxLength={160} /></label>
    <label className="grid gap-1 text-sm">Domain / slug<input className={control} value={editor.slug} disabled={editor.status === "published"} onChange={(event) => change({ slug: event.target.value })} /><span className="text-slate-500">公開網址：/lp/{editor.slug}。已發布的 slug 須先取消發布才能修改。此設定不會綁定自訂網域。</span></label>
    <label className="grid gap-1 text-sm">Currency<select className={control} value={editor.currency} onChange={(event) => change({ currency: event.target.value })}>{["TWD", "USD", "EUR", "JPY", "HKD", "SGD"].map((currency) => <option key={currency}>{currency}</option>)}</select><span className="text-slate-500">須與商品幣別一致，不會換算既有價格或訂單。</span></label>
  </div>;
}

function StepSelect({ label, value, steps, disabled, onChange }: { label: string; value: string; steps: Steps; disabled?: boolean; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-sm">{label}<select className={control} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">請選擇步驟</option>{steps.map((step) => <option key={step.id} value={step.id}>{step.name} · {step.path}</option>)}</select></label>;
}

function ExperimentSettings({ value, steps, onChange }: { value: FunnelExperiment | null; steps: Steps; onChange: (value: FunnelExperiment | null) => void }) {
  const locked = Boolean(value && value.status !== "draft");
  function create() {
    onChange({ id: crypto.randomUUID(), status: "draft", controlStepId: steps[0]?.id ?? "", variantStepId: steps[1]?.id ?? "", controlWeight: 50, variantWeight: 50, winner: null });
  }
  if (!value) return <div className="space-y-3"><p>選擇已建立的兩個步驟作為 Control 與 Variant；先發布頁面再開始實驗。</p><button type="button" className={button} disabled={steps.length < 2} onClick={create}>建立 A/B 實驗</button></div>;
  return <div className="grid max-w-2xl gap-4">
    <p className="text-sm">實驗 {value.id} · 狀態：<strong>{value.status}</strong>{value.winner ? ` · Winner: ${value.winner}` : ""}</p>
    <StepSelect label="Control" value={value.controlStepId} steps={steps} disabled={locked} onChange={(controlStepId) => onChange({ ...value, controlStepId })} />
    <StepSelect label="Variant" value={value.variantStepId} steps={steps} disabled={locked} onChange={(variantStepId) => onChange({ ...value, variantStepId })} />
    <div className="grid grid-cols-2 gap-3">{(["control", "variant"] as const).map((arm) => <label key={arm} className="grid gap-1 text-sm">{arm === "control" ? "Control 權重" : "Variant 權重"}<input className={control} type="number" min={0} max={100} disabled={locked} value={value[`${arm}Weight`]} onChange={(event) => onChange({ ...value, [`${arm}Weight`]: Number(event.target.value) })} /></label>)}</div>
    <p className={value.controlWeight + value.variantWeight !== 100 ? "text-red-700" : "text-slate-500"}>權重合計：{value.controlWeight + value.variantWeight} / 100。相同訪客在同一實驗維持相同組別；開始後配置鎖定。</p>
    <div className="flex flex-wrap gap-2">
      {value.status === "draft" ? <button type="button" className={button} onClick={() => onChange({ ...value, status: "running" })}>開始實驗</button> : null}
      {value.status === "running" ? <button type="button" className={button} onClick={() => onChange({ ...value, status: "stopped" })}>停止實驗</button> : null}
      {value.status === "running" || value.status === "stopped" ? (["control", "variant"] as const).map((winner) => <button type="button" key={winner} className={button} onClick={() => onChange({ ...value, status: "winner", winner })}>選定 {winner} 為 Winner</button>) : null}
      {value.status === "stopped" || value.status === "winner" ? <button type="button" className={button} onClick={create}>建立新實驗</button> : null}
    </div><p className="text-sm text-slate-500">按「儲存設定」後生效。停止後回到 Control，Winner 會固定使用勝出組別。</p>
  </div>;
}

function DeadlineSettings({ value, steps, onChange }: { value: FunnelOperations["deadline"]; steps: Steps; onChange: (value: FunnelOperations["deadline"]) => void }) {
  let local = "尚未設定";
  try { if (value.expiresAt) local = new Intl.DateTimeFormat("zh-TW", { dateStyle: "full", timeStyle: "long", timeZone: value.timezone }).format(new Date(value.expiresAt)); } catch { local = "時間或時區無效"; }
  return <div className="grid max-w-2xl gap-4">
    <label className="flex items-center gap-2"><input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />啟用截止時間</label>
    <label className="grid gap-1 text-sm">時區<input className={control} value={value.timezone} onChange={(event) => onChange({ ...value, timezone: event.target.value })} placeholder="Asia/Taipei" /></label>
    <label className="grid gap-1 text-sm">截止時間（含時區偏移）<input className={control} value={value.expiresAt ?? ""} onChange={(event) => onChange({ ...value, expiresAt: event.target.value || null })} placeholder="2026-12-31T23:59:00+08:00" /><span className="text-slate-500">例如 2026-12-31T23:59:00+08:00；DST 地區請明確填入當時 offset。</span></label>
    {/* ICU punctuation can differ between Node and Chromium even with the same
        locale/time zone. The persisted ISO value remains the source of truth. */}
    <p className="text-sm" suppressHydrationWarning>指定時區顯示：{local}</p>
    <label className="grid gap-1 text-sm">截止行為<select className={control} value={value.behavior} onChange={(event) => onChange({ ...value, behavior: event.target.value as "closed" | "redirect" })}><option value="closed">顯示已截止</option><option value="redirect">導向指定步驟</option></select></label>
    {value.behavior === "redirect" ? <label className="grid gap-1 text-sm">過期導向<select className={control} value={value.redirectPath} onChange={(event) => onChange({ ...value, redirectPath: event.target.value })}><option value="">請選擇已發布步驟</option>{steps.slice(1).map((step) => <option key={step.id} value={step.path}>{step.name} · {step.path}</option>)}</select></label> : null}
    <p className="text-sm text-slate-500">截止瞬間即生效，公開頁及提交／結帳均由伺服器判定。到期導向頁可繼續閱讀，不能繼續提交或結帳。</p>
  </div>;
}

function ReportSettings({ tab, editor, reports, onChange }: { tab: "Stats" | "Leads" | "Sales"; editor: FunnelOperationsEditor; reports: FunnelReports; onChange: (operations: FunnelOperations) => void }) {
  const key = tab.toLowerCase() as "stats" | "leads" | "sales";
  const filter = editor.operations.reports[key];
  function change(patch: Partial<typeof filter>) { onChange({ ...editor.operations, reports: { ...editor.operations.reports, [key]: { ...filter, ...patch } } }); }
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3"><label className="grid gap-1 text-sm">報表步驟<select className={control} value={filter.stepId} onChange={(event) => change({ stepId: event.target.value })}><option value="">全部步驟</option>{editor.steps.map((step) => <option key={step.id} value={step.id}>{step.name}</option>)}</select></label><label className="grid gap-1 text-sm">最近天數<input className={control} type="number" min={1} max={90} value={filter.days} onChange={(event) => change({ days: Number(event.target.value) })} /></label></div>
    <p className="text-sm text-slate-500">儲存後套用篩選條件。以下為已儲存條件的結果，更新時間：{reports.generatedAt}。來源紀錄唯讀。</p>
    {tab === "Stats" ? <StatsReport reports={reports} /> : tab === "Leads" ? <LeadsReport reports={reports} /> : <SalesReport reports={reports} />}
  </div>;
}
function StatsReport({ reports }: { reports: FunnelReports }) {
  return <div className="overflow-auto"><p className="mb-3 text-sm">Page view 為伺服器公開頁交付紀錄，包含重新整理；conversion 為同一匿名訪客依序到達下一步，非成交。未取得匿名識別的瀏覽不計入。</p>{reports.statsTruncated ? <p role="alert">已達 10,000 筆上限，以下為部分資料，請縮短日期範圍。</p> : null}
    <table className="w-full text-left text-sm"><thead><tr>{["Step", "Page view", "訪客", "Submission", "Step conversion", "Drop-off"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{reports.stats.map((row) => <tr key={row.stepId} className="border-t"><td className="p-2">{row.name}</td><td>{row.pageViews}</td><td>{row.visitors}</td><td>{row.submissions}</td><td>{row.conversionRate === null ? "—" : `${(row.conversionRate * 100).toFixed(1)}% (${row.conversions})`}</td><td>{row.dropOff ?? "—"}</td></tr>)}</tbody></table>
    <div className="mt-4">{reports.experiments.map((row) => <p key={`${row.id}-${row.arm}`} className="text-sm">實驗 {row.id} · {row.arm} · Page view {row.pageViews} · Submission {row.submissions}</p>)}</div>
    <details className="mt-4"><summary>檢視來源事件 ID（前 20 筆）</summary>{reports.sources.map((source) => <p key={source.id} className="break-all font-mono text-xs">{source.id} · {source.stepId} · {source.createdAt}</p>)}</details>
  </div>;
}
function LeadsReport({ reports }: { reports: FunnelReports }) {
  return <div className="overflow-auto"><p className="mb-3 text-sm">只列出伺服器驗證 Funnel 來源後建立的提交紀錄；不顯示姓名、Email、電話或表單答案。</p>{reports.leadsTruncated ? <p role="alert">顯示最新 100 筆，請縮短日期或選擇步驟。</p> : null}<table className="w-full text-left text-sm"><thead><tr>{["Funnel", "Step", "時間", "Submission ID", "驗證狀態"].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{reports.leads.map((row) => <tr className="border-t" key={row.id}><td className="p-2">{row.pageId}</td><td>{row.stepId}</td><td>{row.createdAt}</td><td className="font-mono">{row.submissionId}</td><td>{row.verificationStatus}</td></tr>)}</tbody></table>{!reports.leads.length ? <p className="p-3">此範圍尚無可信提交紀錄。</p> : null}</div>;
}
function SalesReport({ reports }: { reports: FunnelReports }) {
  return <div className="overflow-auto"><p className="mb-3 text-sm">來源為 CommerceOrder／PaymentTransaction 的已付款 projection，排除測試訂單；退款另列，不將不同幣別相加。</p>{reports.salesTruncated ? <p role="alert">顯示最新 100 筆，請縮短日期或選擇步驟。</p> : null}<table className="w-full text-left text-sm"><thead><tr>{["Order", "Step", "付款時間", "Currency", "已付／退款（分）", "Order／Payment 狀態", "Payment ID"].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{reports.sales.map((row) => <tr className="border-t" key={row.id}><td className="p-2"><span>{row.orderNumber}</span><small className="block">{row.id}</small></td><td>{row.stepId}</td><td>{row.paidAt}</td><td>{row.currency}</td><td>{row.paidAmountCents} / {row.refundedAmountCents}</td><td>{row.status} / {row.paymentStatus}</td><td className="font-mono">{row.paymentId}</td></tr>)}</tbody></table>{!reports.sales.length ? <p className="p-3">此範圍尚無已付款訂單。</p> : null}</div>;
}
