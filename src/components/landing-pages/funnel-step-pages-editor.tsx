"use client";

import { useState } from "react";
import type { FunnelCommerceProduct } from "@/lib/funnel-commerce";
import { FunnelPageEditor } from "@/components/landing-pages/funnel-page-editor";
import { instantiateFunnelTemplate, listFunnelTemplateGallery, type FunnelTemplateGoal } from "@/lib/funnel-template-gallery";
import type { FunnelStepType } from "@/lib/funnel-flow";
import { createFunnelStepPagesHistory, recordFunnelStepPages, redoFunnelStepPages, undoFunnelStepPages } from "@/lib/funnel-step-pages-history";
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
  type FunnelStepPersistenceMutation,
} from "@/lib/funnel-step-pages";

export function FunnelStepPagesEditor({ state, disabled = false, onChange, onStepMutation, commerceProducts }: { state: FunnelStepPages; disabled?: boolean; onChange: (state: FunnelStepPages) => void; onStepMutation?: (state: FunnelStepPages, mutation: FunnelStepPersistenceMutation) => void; commerceProducts?: FunnelCommerceProduct[] }) {
  const templateGoal: FunnelTemplateGoal = state.flow.goal;
  const templates = listFunnelTemplateGallery(templateGoal);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [newStepType, setNewStepType] = useState<Exclude<FunnelStepType, "inactive_page">>(state.flow.goal === "sell" ? "sales_page" : state.flow.goal === "audience" ? "opt_in_page" : "info_page");
  const [newStepSource, setNewStepSource] = useState<"blank" | "template">("blank");
  const [flowHistory, setFlowHistory] = useState(createFunnelStepPagesHistory);
  const active = getActiveFunnelStepPage(state);
  const commit = (result: FunnelStepPageMutationResult, record = true, mutation?: FunnelStepPersistenceMutation) => {
    if (!result.ok) return;
    if (record) {
      setFlowHistory((history) => recordFunnelStepPages(history, state));
    }
    if (mutation && onStepMutation) onStepMutation(result.state, mutation);
    else onChange(result.state);
  };
  const undoFlow = () => {
    const result = undoFunnelStepPages(flowHistory, state);
    if (!result) return;
    setFlowHistory(result.history);
    onChange(result.state);
  };
  const redoFlow = () => {
    const result = redoFunnelStepPages(flowHistory, state);
    if (!result) return;
    setFlowHistory(result.history);
    onChange(result.state);
  };
  if (!active) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">Funnel steps 資料無法通過驗證。</p>;
  const editableSteps = state.flow.steps.filter((step) => !step.isSystem);
  const addStep = () => {
    const ordinal = editableSteps.length + 1;
    const input = { id: `step_${crypto.randomUUID().replace(/-/gu, "").slice(0, 24)}`, name: "新步驟", path: `step-${ordinal}`, type: newStepType, templateSource: newStepSource, ...(newStepSource === "template" && templateId ? { templateId } : {}) } as const;
    const added = addFunnelStepPage(state, input);
    if (!added.ok) return;
    const created = added.state.flow.steps.find((step) => !state.flow.steps.some((old) => old.id === step.id));
    if (!created || newStepSource !== "template" || !templateId) return commit(added, true, { type: "add", input });
    const page = added.state.pages[created.id];
    if (!page) return;
    const replaced = replaceFunnelStepPage(added.state, created.id, instantiateFunnelTemplate(templateId, page.id), templateId);
    if (replaced.ok) {
      onStepMutation?.(added.state, { type: "add", input });
      commit(replaced);
    }
  };
  return <div className="grid min-h-0 grid-cols-[15rem_minmax(0,1fr)] overflow-hidden">
    <aside className="min-h-0 overflow-auto border-r border-slate-200 bg-slate-50 p-3" aria-label="Funnel steps">
      <div className="mb-3"><p className="text-xs font-bold uppercase tracking-wider text-blue-700">Funnel steps</p><h2 className="mt-1 font-bold text-slate-950">{state.flow.name}</h2></div>
      <div className="mb-3 grid grid-cols-2 gap-2"><button type="button" disabled={disabled || flowHistory.past.length === 0} onClick={undoFlow} className="min-h-9 rounded-lg border border-slate-300 bg-white text-xs font-bold disabled:opacity-40">流程 Undo</button><button type="button" disabled={disabled || flowHistory.future.length === 0} onClick={redoFlow} className="min-h-9 rounded-lg border border-slate-300 bg-white text-xs font-bold disabled:opacity-40">流程 Redo</button></div>
      <div className="grid gap-2">{state.flow.steps.map((step, index) => <article key={step.id} className={`rounded-xl border p-2 ${state.activeStepId === step.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}>
        <button type="button" onClick={() => commit(switchFunnelStep(state, step.id), false)} className="w-full text-left"><span className="block text-sm font-bold text-slate-800">{step.name}</span><span className="mt-0.5 block font-mono text-[11px] text-slate-500">/{step.path}</span></button>
        {!step.isSystem ? <div className="mt-2 grid grid-cols-3 gap-1"><button type="button" aria-label={`上移 ${step.name}`} disabled={disabled || index === 0} onClick={() => commit(moveFunnelStepPage(state, step.id, index - 1), true, { type: "move", stepId: step.id, toIndex: index - 1 })} className="rounded border bg-white py-1 text-xs disabled:opacity-40">↑</button><button type="button" aria-label={`下移 ${step.name}`} disabled={disabled || index >= editableSteps.length - 1} onClick={() => commit(moveFunnelStepPage(state, step.id, index + 1), true, { type: "move", stepId: step.id, toIndex: index + 1 })} className="rounded border bg-white py-1 text-xs disabled:opacity-40">↓</button><button type="button" aria-label={`移除 ${step.name}`} disabled={disabled} onClick={() => { if (window.confirm(`確定移除「${step.name}」及其頁面內容？`)) commit(removeFunnelStepPage(state, step.id), true, { type: "remove", stepId: step.id }); }} className="rounded border bg-white py-1 text-xs text-red-700 disabled:opacity-40">×</button></div> : <p className="mt-2 text-[11px] text-slate-500">系統頁，只能預覽</p>}
      </article>)}</div>
      <div className="mt-3 grid gap-2 rounded-xl border border-blue-100 bg-blue-50 p-2"><label className="grid gap-1 text-xs font-semibold text-slate-600">新步驟類型<select className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={newStepType} disabled={disabled} onChange={(event) => setNewStepType(event.currentTarget.value as Exclude<FunnelStepType, "inactive_page">)}>{state.flow.goal === "webinar" ? <><option value="webinar_registration_page">Webinar 報名頁</option><option value="webinar_thank_you_page">Webinar 感謝頁</option><option value="webinar_broadcast_page">Webinar 播放頁</option></> : null}<option value="info_page">資訊頁</option><option value="contact_us_page">聯絡我們</option><option value="opt_in_page">名單頁</option><option value="opt_in_thank_you_page">名單感謝頁</option><option value="sales_page">銷售頁</option><option value="order_form">訂單表單</option><option value="upsell">加購頁</option><option value="downsell">降價加購頁</option><option value="thank_you_page">感謝頁</option><option value="inline_form">內嵌表單</option><option value="popup_form">彈出表單</option><option value="link_in_bio">個人簡介連結頁</option></select></label><label className="grid gap-1 text-xs font-semibold text-slate-600">起始內容<select className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={newStepSource} disabled={disabled} onChange={(event) => setNewStepSource(event.currentTarget.value as "blank" | "template")}><option value="blank">空白頁</option><option value="template">套用目前模板</option></select></label><button type="button" disabled={disabled} onClick={addStep} className="min-h-10 w-full rounded-lg border border-blue-200 bg-white text-sm font-bold text-blue-700 disabled:opacity-40">＋ 新增步驟</button></div>
      {!active.step.isSystem ? <label className="mt-4 grid gap-1 text-xs font-semibold text-slate-600">步驟名稱<input className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={active.step.name} disabled={disabled} onChange={(event) => commit(renameFunnelStepPage(state, active.step.id, event.currentTarget.value), true, { type: "rename", stepId: active.step.id, name: event.currentTarget.value })} /></label> : null}
      {!active.step.isSystem ? <label className="mt-3 grid gap-1 text-xs font-semibold text-slate-600">URL Path<input aria-label="步驟 URL Path" className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 font-mono text-sm" value={active.step.path} disabled={disabled} onChange={(event) => commit(setFunnelStepPathPage(state, active.step.id, event.currentTarget.value), true, { type: "set_path", stepId: active.step.id, path: event.currentTarget.value })} /></label> : null}
      {!active.step.isSystem ? <div className="mt-4 border-t border-slate-200 pt-4"><label className="grid gap-1 text-xs font-semibold text-slate-600">套用完整模板<select aria-label="Funnel 模板" className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={templateId} disabled={disabled} onChange={(event) => setTemplateId(event.currentTarget.value)}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.status === "limited" ? "（功能限制）" : ""}</option>)}</select></label>{templates.find((item) => item.id === templateId) ? <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2"><div className="flex gap-1">{templates.find((item) => item.id === templateId)!.preview.palette.map((color) => <span key={color} className="h-4 flex-1 rounded" style={{ backgroundColor: color }} />)}</div><strong className="mt-2 block text-xs text-slate-800">{templates.find((item) => item.id === templateId)!.preview.headline}</strong><p className="mt-1 text-[11px] leading-4 text-slate-500">{templates.find((item) => item.id === templateId)!.description}</p></div> : null}<button type="button" disabled={disabled || !templateId} onClick={() => { const template = templates.find((item) => item.id === templateId); if (!template || !window.confirm(`套用「${template.name}」會取代目前步驟內容，確定繼續？`)) return; commit(replaceFunnelStepPage(state, active.step.id, instantiateFunnelTemplate(template.id, active.page.id), template.id)); }} className="mt-2 min-h-9 w-full rounded-lg bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-40">取代目前步驟內容</button><p className="mt-2 text-[11px] leading-4 text-slate-500">模板會展開為可獨立編輯節點。付款元件需在訂單步驟的頁面設定綁定商品，再儲存並發布。</p></div> : null}
    </aside>
    <div className="min-h-0 overflow-auto"><FunnelPageEditor key={state.activeStepId} document={active.page} commerceProducts={commerceProducts} commerceEnabled={active.step.type === "order_form"} disabled={disabled || !active.editable} onChange={(page) => commit(replaceFunnelStepPage(state, active.step.id, page), false)} /></div>
  </div>;
}
