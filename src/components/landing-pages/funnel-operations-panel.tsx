"use client";

import { useState } from "react";
import { FunnelAutomationSettings } from "@/components/landing-pages/funnel-automation-settings";
import { readFunnelOperations, updateFunnelOperations } from "@/app/actions/funnel-operations-actions";
import type { FunnelOperations, FunnelExperiment } from "@/lib/funnel-operations";
import type { FunnelOperationsEditor, FunnelReports } from "@/lib/funnel-operations-service";

type Props = { initial: FunnelOperationsEditor; initialReports: FunnelReports; initialStepId: string; csrfName: string; csrfToken: string };
const tabs = ["A/B test", "Automation Rules", "Stats", "Leads", "Sales", "Deadline settings"] as const;

export function FunnelOperationsPanel({ initial, initialReports, initialStepId, csrfName, csrfToken }: Props) {
  const [editor, setEditor] = useState(initial);
  const [reports, setReports] = useState(initialReports);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Stats");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(initial.revision);

  async function save(operations: FunnelOperations, patch: Partial<FunnelOperationsEditor> = {}) {
    setPending(true); setMessage("");
    const data = new FormData(); data.set(csrfName, csrfToken); data.set("settings", JSON.stringify({ pageId: editor.pageId, revision, name: patch.name ?? editor.name, slug: patch.slug ?? editor.slug, currency: patch.currency ?? editor.currency, operations }));
    try {
      const result = await updateFunnelOperations(data);
      if (!result.ok) { setMessage("設定無法儲存，請重新載入後再試。"); return; }
      setRevision(result.revision); setEditor((value) => ({ ...value, ...patch, revision: result.revision, operations }));
      setMessage("設定已儲存。");
    } catch { setMessage("設定無法儲存，請重新載入後再試。"); } finally { setPending(false); }
  }

  function updateExperiment(experiment: FunnelExperiment | null) { void save({ ...editor.operations, experiment }); }
  return <main className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-[16rem_1fr]">
    <aside className="rounded-2xl border border-slate-200 bg-white p-3" aria-label="Funnel operations tabs">
      <h1 className="px-3 py-2 text-lg font-bold">{editor.name}</h1>
      <p className="px-3 pb-3 text-xs text-slate-500">revision {revision} · step {initialStepId}</p>
      <nav className="grid gap-1">{tabs.map((item) => <button key={item} type="button" onClick={() => setTab(item)} aria-current={tab === item ? "page" : undefined} className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-slate-50">{item}</button>)}</nav>
    </aside>
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-xl font-bold">{tab}</h2>
      {message ? <p role="status" className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{message}</p> : null}
      {tab === "A/B test" ? <div className="mt-5 grid gap-4">
        <p className="text-sm text-slate-600">只允許已發布且非系統步驟參與實驗。</p>
        {!editor.operations.experiment ? <button type="button" disabled={editor.steps.length < 2 || pending} className="min-h-11 rounded-lg bg-slate-900 px-4 text-white" onClick={() => updateExperiment({ id: crypto.randomUUID(), status: "draft", controlStepId: editor.steps[0]?.id ?? "", variantStepId: editor.steps[1]?.id ?? "", controlWeight: 50, variantWeight: 50, winner: null })}>建立 A/B 實驗</button> : <>
          <label>Control<select className="ml-2 rounded border p-2" value={editor.operations.experiment.controlStepId} disabled={pending || editor.operations.experiment.status === "winner"} onChange={(event) => updateExperiment({ ...editor.operations.experiment!, controlStepId: event.target.value })}>{editor.steps.map((step) => <option key={step.id} value={step.id}>{step.name}</option>)}</select></label>
          <label>Variant<select className="ml-2 rounded border p-2" value={editor.operations.experiment.variantStepId} disabled={pending || editor.operations.experiment.status === "winner"} onChange={(event) => updateExperiment({ ...editor.operations.experiment!, variantStepId: event.target.value })}>{editor.steps.map((step) => <option key={step.id} value={step.id}>{step.name}</option>)}</select></label>
          <label>Control weight<input className="ml-2 rounded border p-2" type="number" min="0" max="100" value={editor.operations.experiment.controlWeight} disabled={pending || editor.operations.experiment.status === "winner"} onChange={(event) => updateExperiment({ ...editor.operations.experiment!, controlWeight: Number(event.target.value), variantWeight: 100 - Number(event.target.value) })} /></label>
          <label>Status<select className="ml-2 rounded border p-2" value={editor.operations.experiment.status} disabled={pending} onChange={(event) => updateExperiment({ ...editor.operations.experiment!, status: event.target.value as FunnelExperiment["status"], winner: event.target.value === "winner" ? editor.operations.experiment!.winner ?? "control" : null })}><option value="draft">draft</option><option value="running">running</option><option value="stopped">stopped</option><option value="winner">winner</option></select></label>
          {editor.operations.experiment.status === "winner" ? <label>Winner<select className="ml-2 rounded border p-2" value={editor.operations.experiment.winner ?? "control"} onChange={(event) => updateExperiment({ ...editor.operations.experiment!, winner: event.target.value as "control" | "variant" })}><option value="control">control</option><option value="variant">variant</option></select></label> : null}
        </>}
      </div> : null}
      {tab === "Automation Rules" ? <div className="mt-5"><FunnelAutomationSettings pageId={editor.pageId} csrfName={csrfName} csrfToken={csrfToken} /></div> : null}
      {tab === "Deadline settings" ? <div className="mt-5 grid gap-4">
        <label className="flex gap-2"><input type="checkbox" checked={editor.operations.deadline.enabled} onChange={(event) => void save({ ...editor.operations, deadline: { ...editor.operations.deadline, enabled: event.target.checked } })} />啟用到期設定</label>
        <label>Timezone<input className="ml-2 rounded border p-2" value={editor.operations.deadline.timezone} onChange={(event) => void save({ ...editor.operations, deadline: { ...editor.operations.deadline, timezone: event.target.value } })} /></label>
        <label>Expires at<input className="ml-2 rounded border p-2" type="datetime-local" value={editor.operations.deadline.expiresAt?.slice(0, 16) ?? ""} onChange={(event) => void save({ ...editor.operations, deadline: { ...editor.operations.deadline, expiresAt: event.target.value ? new Date(event.target.value).toISOString() : null } })} /></label>
        <label>Behavior<select className="ml-2 rounded border p-2" value={editor.operations.deadline.behavior} onChange={(event) => void save({ ...editor.operations, deadline: { ...editor.operations.deadline, behavior: event.target.value as FunnelOperations["deadline"]["behavior"] } })}><option value="closed">關閉</option><option value="redirect">導向</option></select></label>
        {editor.operations.deadline.behavior === "redirect" ? <label>Redirect<select className="ml-2 rounded border p-2" value={editor.operations.deadline.redirectPath} onChange={(event) => void save({ ...editor.operations, deadline: { ...editor.operations.deadline, redirectPath: event.target.value } })}>{editor.steps.filter((_, index) => index > 0).map((step) => <option key={step.id} value={step.path}>{step.name}</option>)}</select></label> : null}
      </div> : null}
      {tab === "Stats" ? <ReportTable rows={reports.stats.map((row) => ({ label: row.name, values: [row.pageViews, row.visitors, row.submissions, row.conversionRate === null ? "—" : `${(row.conversionRate * 100).toFixed(1)}%`] }))} /> : null}
      {tab === "Leads" ? <ReportTable rows={reports.leads.map((row) => ({ label: row.stepId, values: [row.submissionId, row.verificationStatus, row.createdAt] }))} /> : null}
      {tab === "Sales" ? <ReportTable rows={reports.sales.map((row) => ({ label: row.orderNumber, values: [row.status, row.currency, row.paidAmountCents, row.stepId] }))} /> : null}
      <button type="button" disabled={pending} className="mt-6 min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white" onClick={async () => { setPending(true); try { const next = await readFunnelOperations(editor.pageId); setEditor(next.editor); setReports(next.reports); setRevision(next.editor.revision); setMessage("已重新載入。"); } catch { setMessage("無法重新載入，請稍後再試。"); } finally { setPending(false); } }}>重新載入</button>
    </section>
  </main>;
}

function ReportTable({ rows }: { rows: Array<{ label: string; values: unknown[] }> }) {
  return <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><tbody>{rows.map((row) => <tr key={row.label} className="border-t"><th className="p-2 font-semibold">{row.label}</th>{row.values.map((value, index) => <td key={index} className="p-2">{String(value)}</td>)}</tr>)}</tbody></table></div>;
}
