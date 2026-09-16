"use client";

import { useState } from "react";
import { FunnelPageEditor } from "@/components/landing-pages/funnel-page-editor";
import { instantiateFunnelTemplate, listFunnelTemplateGallery, type FunnelTemplateGoal } from "@/lib/funnel-template-gallery";
import {
  addFunnelStepPage,
  getActiveFunnelStepPage,
  moveFunnelStepPage,
  removeFunnelStepPage,
  renameFunnelStepPage,
  replaceFunnelStepPage,
  setFunnelStepPathPage,
  switchFunnelStep,
  type FunnelStepPageMutationResult,
  type FunnelStepPages,
} from "@/lib/funnel-step-pages";

export function FunnelStepPagesEditor({ state, disabled = false, onChange }: { state: FunnelStepPages; disabled?: boolean; onChange: (state: FunnelStepPages) => void }) {
  const templateGoal: FunnelTemplateGoal = state.flow.goal === "webinar" ? "custom" : state.flow.goal;
  const templates = listFunnelTemplateGallery(templateGoal);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const active = getActiveFunnelStepPage(state);
  const commit = (result: FunnelStepPageMutationResult) => { if (result.ok) onChange(result.state); };
  if (!active) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">Funnel steps 資料無法通過驗證。</p>;
  const editableSteps = state.flow.steps.filter((step) => !step.isSystem);
  return <div className="grid min-h-0 grid-cols-[15rem_minmax(0,1fr)] overflow-hidden">
    <aside className="min-h-0 overflow-auto border-r border-slate-200 bg-slate-50 p-3" aria-label="Funnel steps">
      <div className="mb-3"><p className="text-xs font-bold uppercase tracking-wider text-blue-700">Funnel steps</p><h2 className="mt-1 font-bold text-slate-950">{state.flow.name}</h2></div>
      <div className="grid gap-2">{state.flow.steps.map((step, index) => <article key={step.id} className={`rounded-xl border p-2 ${state.activeStepId === step.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}>
        <button type="button" onClick={() => commit(switchFunnelStep(state, step.id))} className="w-full text-left"><span className="block text-sm font-bold text-slate-800">{step.name}</span><span className="mt-0.5 block font-mono text-[11px] text-slate-500">/{step.path}</span></button>
        {!step.isSystem ? <div className="mt-2 grid grid-cols-3 gap-1"><button type="button" aria-label={`上移 ${step.name}`} disabled={disabled || index === 0} onClick={() => commit(moveFunnelStepPage(state, step.id, index - 1))} className="rounded border bg-white py-1 text-xs disabled:opacity-40">↑</button><button type="button" aria-label={`下移 ${step.name}`} disabled={disabled || index >= editableSteps.length - 1} onClick={() => commit(moveFunnelStepPage(state, step.id, index + 1))} className="rounded border bg-white py-1 text-xs disabled:opacity-40">↓</button><button type="button" aria-label={`移除 ${step.name}`} disabled={disabled} onClick={() => { if (window.confirm(`確定移除「${step.name}」及其頁面內容？`)) commit(removeFunnelStepPage(state, step.id)); }} className="rounded border bg-white py-1 text-xs text-red-700 disabled:opacity-40">×</button></div> : <p className="mt-2 text-[11px] text-slate-500">系統頁，只能預覽</p>}
      </article>)}</div>
      <button type="button" disabled={disabled} onClick={() => commit(addFunnelStepPage(state, { name: "新資訊頁", path: `info-${state.flow.steps.length}`, type: "info_page", templateSource: "blank" }))} className="mt-3 min-h-10 w-full rounded-lg border border-blue-200 bg-white text-sm font-bold text-blue-700 disabled:opacity-40">＋ 新增步驟</button>
      {!active.step.isSystem ? <label className="mt-4 grid gap-1 text-xs font-semibold text-slate-600">步驟名稱<input className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={active.step.name} disabled={disabled} onChange={(event) => commit(renameFunnelStepPage(state, active.step.id, event.currentTarget.value))} /></label> : null}
      {!active.step.isSystem ? <label className="mt-3 grid gap-1 text-xs font-semibold text-slate-600">URL Path<input aria-label="步驟 URL Path" className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 font-mono text-sm" value={active.step.path} disabled={disabled} onChange={(event) => commit(setFunnelStepPathPage(state, active.step.id, event.currentTarget.value))} /></label> : null}
      {!active.step.isSystem ? <div className="mt-4 border-t border-slate-200 pt-4"><label className="grid gap-1 text-xs font-semibold text-slate-600">套用完整模板<select aria-label="Funnel 模板" className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={templateId} disabled={disabled} onChange={(event) => setTemplateId(event.currentTarget.value)}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.status === "limited" ? "（功能限制）" : ""}</option>)}</select></label><button type="button" disabled={disabled || !templateId} onClick={() => { const template = templates.find((item) => item.id === templateId); if (!template || !window.confirm(`套用「${template.name}」會取代目前步驟內容，確定繼續？`)) return; commit(replaceFunnelStepPage(state, active.step.id, instantiateFunnelTemplate(template.id, active.page.id))); }} className="mt-2 min-h-9 w-full rounded-lg bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-40">取代目前步驟內容</button><p className="mt-2 text-[11px] leading-4 text-slate-500">模板會展開為可獨立編輯節點。付款模板只提供停用版面，不會建立付款流程。</p></div> : null}
    </aside>
    <div className="min-h-0 overflow-auto"><FunnelPageEditor key={state.activeStepId} document={active.page} disabled={disabled || !active.editable} onChange={(page) => commit(replaceFunnelStepPage(state, active.step.id, page))} /></div>
  </div>;
}
