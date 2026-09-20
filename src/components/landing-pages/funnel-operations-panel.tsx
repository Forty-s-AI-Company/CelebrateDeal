"use client";

import { useState } from "react";
import { readFunnelOperations, updateFunnelOperations } from "@/app/actions/funnel-operations-actions";
import type { FunnelOperations, FunnelExperiment } from "@/lib/funnel-operations";
import type { FunnelOperationsEditor, FunnelReports } from "@/lib/funnel-operations-service";

type Props = { initial: FunnelOperationsEditor; initialReports: FunnelReports; initialStepId: string; csrfName: string; csrfToken: string };
const tabs = ["A/B test", "Stats", "Leads", "Sales", "Deadline settings"] as const;

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
    const result = await updateFunnelOperations(data);
    setPending(false);
    if (!result.ok) { setMessage(result.message); return; }
    setRevision(result.revision); setEditor((value) => ({ ...value, ...patch, revision: result.revision, operations }));
    setMessage(result.message);
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
        <label>Control<select className="ml-2 rounded border p-2" value={editor.operations.experiment?.controlStepId ?? ""} onChange={(event) => updateExperiment(editor.operations.experiment ? { ...editor.operations.experiment, controlStepId: event.target.value } : null)}>{editor.steps.map((step) => <option key={step.id} value={step.id}>{step.name}</option>)}</select></label>
        <label>Variant<select className="ml-2 rounded border p-2" value={editor.operations.experiment?.variantStepId ?? ""} onChange={(event) => updateExperiment(editor.operations.experiment ? { ...editor.operations.experiment, variantStepId: event.target.value } : null)}>{editor.steps.map((step) => <option key={step.id} value={step.id}>{step.name}</option>)}</select></label>
      </div> : null}
      {tab === "Deadline settings" ? <div className="mt-5 grid gap-4">
        <label className="flex gap-2"><input type="checkbox" checked={editor.operations.deadline.enabled} onChange={(event) => void save({ ...editor.operations, deadline: { ...editor.operations.deadline, enabled: event.target.checked } })} />啟用到期設定</label>
        <label>Behavior<select className="ml-2 rounded border p-2" value={editor.operations.deadline.behavior} onChange={(event) => void save({ ...editor.operations, deadline: { ...editor.operations.deadline, behavior: event.target.value as FunnelOperations["deadline"]["behavior"] } })}><option value="closed">關閉</option><option value="redirect">導向</option></select></label>
      </div> : null}
      {tab === "Stats" ? <ReportTable rows={reports.stats.map((row) => ({ label: row.name, values: [row.pageViews, row.visitors, row.submissions, row.conversionRate === null ? "—" : `${(row.conversionRate * 100).toFixed(1)}%`] }))} /> : null}
      {tab === "Leads" ? <ReportTable rows={reports.leads.map((row) => ({ label: row.stepId, values: [row.submissionId, row.verificationStatus, row.createdAt] }))} /> : null}
      {tab === "Sales" ? <ReportTable rows={reports.sales.map((row) => ({ label: row.orderNumber, values: [row.status, row.currency, row.paidAmountCents, row.stepId] }))} /> : null}
      <button type="button" disabled={pending} className="mt-6 min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white" onClick={async () => { const next = await readFunnelOperations(editor.pageId); setEditor(next.editor); setReports(next.reports); setRevision(next.editor.revision); setMessage("已重新載入。"); }}>重新載入</button>
    </section>
  </main>;
}

function ReportTable({ rows }: { rows: Array<{ label: string; values: unknown[] }> }) {
  return <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><tbody>{rows.map((row) => <tr key={row.label} className="border-t"><th className="p-2 font-semibold">{row.label}</th>{row.values.map((value, index) => <td key={index} className="p-2">{String(value)}</td>)}</tr>)}</tbody></table></div>;
}
