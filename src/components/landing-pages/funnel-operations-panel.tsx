"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Eye, MoreHorizontal, Pencil, Plus, Settings, X } from "lucide-react";
import { landingPageAction } from "@/app/actions/landing-page-actions";
import { readFunnelOperations, updateFunnelOperations } from "@/app/actions/funnel-operations-actions";
import { FunnelAutomationSettings } from "@/components/landing-pages/funnel-automation-settings";
import { FunnelTemplateGalleryPicker } from "@/components/landing-pages/funnel-template-gallery-picker";
import { type FunnelOperations, type FunnelExperiment } from "@/lib/funnel-operations";
import type { FunnelOperationsEditor, FunnelReports } from "@/lib/funnel-operations-service";
import type { FunnelStepType } from "@/lib/funnel-flow";
import { instantiateFunnelTemplate, listFunnelTemplateGallery } from "@/lib/funnel-template-gallery";
import {
  addFunnelStepPage,
  getActiveFunnelStepPage,
  moveFunnelStepPage,
  removeFunnelStepPage,
  renameFunnelStepPage,
  replaceFunnelStepPage,
  setFunnelStepPathPage,
  switchFunnelStep,
  type FunnelStepPages,
} from "@/lib/funnel-step-pages";

const tabs = ["Configuration", "Automation Rules", "A/B test", "Stats", "Leads", "Sales", "Deadline settings"] as const;
type Tab = typeof tabs[number];
const control = "min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:opacity-50";
const button = `${control} cursor-pointer font-semibold hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300`;
type SettingsState = Pick<FunnelOperationsEditor, "name" | "slug" | "currency" | "operations">;
type Steps = FunnelOperationsEditor["steps"];
type EditableStepType = Exclude<FunnelStepType, "inactive_page">;

const stepTypeOptions: Array<{ group: string; items: Array<{ value: EditableStepType; label: string }> }> = [
  { group: "銷售", items: [{ value: "sales_page", label: "銷售頁" }, { value: "order_form", label: "訂單表單" }, { value: "upsell", label: "加購頁" }, { value: "downsell", label: "降價加購頁" }, { value: "thank_you_page", label: "感謝頁" }] },
  { group: "名單", items: [{ value: "opt_in_page", label: "名單頁" }, { value: "opt_in_thank_you_page", label: "名單感謝頁" }, { value: "inline_form", label: "內嵌表單" }, { value: "popup_form", label: "彈出表單" }, { value: "link_in_bio", label: "個人簡介連結頁" }] },
  { group: "資訊", items: [{ value: "info_page", label: "資訊頁" }, { value: "contact_us_page", label: "聯絡我們" }] },
  { group: "Webinar", items: [{ value: "webinar_registration_page", label: "Webinar 報名頁" }, { value: "webinar_thank_you_page", label: "Webinar 感謝頁" }, { value: "webinar_broadcast_page", label: "Webinar 播放頁" }] },
];

function editableSteps(content: FunnelStepPages): Steps {
  return content.flow.steps.filter((step) => !step.isSystem).map(({ id, name, path }) => ({ id, name, path }));
}

// One management surface coordinates the seven tabs and atomic step actions;
// splitting its state across sibling owners would make revision conflicts harder to guard.
// eslint-disable-next-line complexity
export function FunnelOperationsPanel({ initial, initialReports, initialStepId, csrfName, csrfToken }: { initial: FunnelOperationsEditor; initialReports: FunnelReports; initialStepId: string; csrfName: string; csrfToken: string }) {
  const router = useRouter();
  const initialContent = { ...initial.content, activeStepId: initialStepId };
  const [editor, setEditor] = useState(initial);
  const [content, setContent] = useState<FunnelStepPages>(initialContent);
  const [reports, setReports] = useState(initialReports);
  const [tab, setTab] = useState<Tab>("Configuration");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [changeTemplate, setChangeTemplate] = useState(false);
  const [newStepName, setNewStepName] = useState("新步驟");
  const [newStepPath, setNewStepPath] = useState("new-step");
  const [newStepType, setNewStepType] = useState<EditableStepType>(initial.content.flow.goal === "sell" ? "sales_page" : initial.content.flow.goal === "audience" ? "opt_in_page" : initial.content.flow.goal === "webinar" ? "webinar_registration_page" : "info_page");
  const [newStepSource, setNewStepSource] = useState<"blank" | "template">("template");
  const [newTemplateId, setNewTemplateId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [pending, setPending] = useState(false);
  const revisionRef = useRef(initial.revision);
  const inFlight = useRef(false);
  const active = getActiveFunnelStepPage(content);
  const activeStepType = active?.step.type;
  const templates = activeStepType ? listFunnelTemplateGallery(content.flow.goal, activeStepType) : [];
  const newTemplates = listFunnelTemplateGallery(content.flow.goal, newStepType);
  const effectiveSelectedTemplateId = templates.some((item) => item.id === selectedTemplateId)
    ? selectedTemplateId
    : active?.step.template.templateId ?? templates[0]?.id ?? "";
  const effectiveNewTemplateId = newTemplates.some((item) => item.id === newTemplateId)
    ? newTemplateId
    : newTemplates[0]?.id ?? "";
  const needsTemplate = Boolean(active && !active.step.isSystem && active.step.template.source === "template" && !active.step.template.templateId);
  const secondaryDisabled = !active || active.step.isSystem || needsTemplate;

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function change(patch: Partial<SettingsState>) { setEditor((value) => ({ ...value, ...patch })); setDirty(true); }
  function operations(next: FunnelOperations) { change({ operations: next }); }
  function runPending(task: () => Promise<void>) {
    setPending(true);
    void task().finally(() => setPending(false));
  }
  function navigate(href: string) {
    if (pending || inFlight.current) return;
    if (dirty && !window.confirm("尚有未儲存的設定，確定離開？")) return;
    router.push(href);
  }
  function selectStep(stepId: string) {
    if (dirty && !window.confirm("切換步驟會捨棄尚未儲存的欄位變更，確定繼續？")) return;
    const result = switchFunnelStep(content, stepId);
    if (!result.ok) { setMessage(result.error); return; }
    setContent(result.state); setDirty(false); setTab("Configuration"); setChangeTemplate(false);
    window.history.replaceState(null, "", `/landing-pages/${editor.pageId}/operations?step=${encodeURIComponent(stepId)}&tab=configuration`);
  }
  function persistContent(next: FunnelStepPages, successMessage: string) {
    setContent(next); setDirty(true);
    if (inFlight.current) { setMessage("前一個變更仍在儲存，請稍候再試。"); return; }
    inFlight.current = true;
    const data = new FormData();
    data.set(csrfName, csrfToken); data.set("operation", "save"); data.set("id", editor.pageId);
    data.set("revision", String(revisionRef.current)); data.set("name", editor.name); data.set("slug", editor.slug);
    data.set("formId", editor.formId ?? ""); data.set("liveId", editor.liveId ?? ""); data.set("content", JSON.stringify(next));
    runPending(async () => {
      try {
        const result = await landingPageAction({ status: "success", message: "" }, data);
        setMessage(result.status === "success" ? successMessage : result.message);
        if (result.status === "success" && result.revision) {
          revisionRef.current = result.revision;
          setEditor((value) => ({ ...value, revision: result.revision!, content: next, steps: editableSteps(next) }));
          setDirty(false);
        }
      } catch { setMessage("連線中斷，變更仍保留在畫面，請稍後重試。"); }
      finally { inFlight.current = false; }
    });
  }
  function reload() {
    if (dirty && !window.confirm("重新載入會捨棄這次尚未儲存的設定，確定繼續？")) return;
    runPending(async () => {
      try {
        const loaded = await readFunnelOperations(editor.pageId);
        revisionRef.current = loaded.editor.revision;
        setEditor(loaded.editor); setContent(loaded.editor.content); setReports(loaded.reports); setDirty(false); setMessage("已重新載入最新版本。");
      } catch { setMessage("無法重新載入，請稍後再試。"); }
    });
  }
  function saveSettings() {
    if (inFlight.current) return;
    inFlight.current = true;
    runPending(async () => {
      try {
        const data = new FormData(); data.set(csrfName, csrfToken);
        data.set("settings", JSON.stringify({ pageId: editor.pageId, revision: revisionRef.current, name: editor.name, slug: editor.slug, currency: editor.currency, operations: editor.operations }));
        const result = await updateFunnelOperations(data);
        setMessage(result.message);
        if (result.ok) {
          revisionRef.current = result.revision;
          setEditor((value) => ({ ...value, revision: result.revision, content: { ...content, flow: { ...content.flow, name: value.name, domain: value.slug, currency: value.currency } } }));
          setContent((value) => ({ ...value, flow: { ...value.flow, name: editor.name, domain: editor.slug, currency: editor.currency } }));
          setDirty(false); setSettingsOpen(false);
          try { const loaded = await readFunnelOperations(editor.pageId); setReports(loaded.reports); }
          catch { setMessage("設定已儲存，但報表尚未重新載入。"); }
        }
      } finally { inFlight.current = false; }
    });
  }
  function applyTemplate(templateId: string) {
    if (!active || active.step.isSystem) return;
    if (active.step.template.templateId && !window.confirm("更換模板會取代目前步驟的頁面內容，確定繼續？")) return;
    const result = replaceFunnelStepPage(content, active.step.id, instantiateFunnelTemplate(templateId, active.page.id), templateId);
    if (!result.ok) { setMessage(result.error); return; }
    setChangeTemplate(false); persistContent(result.state, "模板已套用；現在可進入 Edit Page 編輯內容。");
  }
  function saveActiveMetadata() {
    if (!active || active.step.isSystem) return;
    const renamed = renameFunnelStepPage(content, active.step.id, active.step.name);
    if (!renamed.ok) { setMessage(renamed.error); return; }
    const pathed = setFunnelStepPathPage(renamed.state, active.step.id, active.step.path);
    if (!pathed.ok) { setMessage(pathed.error); return; }
    persistContent(pathed.state, "步驟設定已自動儲存。");
  }
  function addStep() {
    const ordinal = content.flow.steps.filter((step) => !step.isSystem).length + 1;
    const input = { id: `step_${crypto.randomUUID().replace(/-/gu, "").slice(0, 24)}`, name: newStepName.trim(), path: newStepPath.trim() || `step-${ordinal}`, type: newStepType, templateSource: newStepSource, ...(newStepSource === "template" && effectiveNewTemplateId ? { templateId: effectiveNewTemplateId } : {}) } as const;
    const added = addFunnelStepPage(content, input);
    if (!added.ok) { setMessage(added.error); return; }
    const created = added.state.flow.steps.find((step) => !content.flow.steps.some((existing) => existing.id === step.id));
    if (!created) return;
    let next = added.state;
    if (newStepSource === "template" && effectiveNewTemplateId) {
      const page = next.pages[created.id];
      if (!page) return;
      const replaced = replaceFunnelStepPage(next, created.id, instantiateFunnelTemplate(effectiveNewTemplateId, page.id), effectiveNewTemplateId);
      if (!replaced.ok) { setMessage(replaced.error); return; }
      next = replaced.state;
    }
    const selected = switchFunnelStep(next, created.id);
    if (selected.ok) next = selected.state;
    setAddOpen(false); setTab("Configuration");
    window.history.replaceState(null, "", `/landing-pages/${editor.pageId}/operations?step=${encodeURIComponent(created.id)}&tab=configuration`);
    persistContent(next, "新步驟已建立。");
  }

  return <section aria-label="Funnel 管理" className="min-w-0 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="min-w-0"><p className="text-xs font-semibold text-slate-500"><Link href="/landing-pages" className="hover:text-blue-700">Funnels</Link> <span aria-hidden>›</span> {editor.name}</p><h1 className="mt-1 truncate text-2xl font-bold text-slate-950">{editor.name}</h1><p className="mt-1 text-sm text-slate-500">{content.flow.goal} · revision {editor.revision}</p></div>
      <div className="flex flex-wrap gap-2"><Link href={`/lp/${editor.slug}`} target="_blank" className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-sky-600"><Eye size={17} />查看 Funnel</Link><button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-sky-600"><Settings size={17} />Funnel settings</button></div>
    </header>
    <div className="grid min-h-[70dvh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100dvh-13rem)] lg:min-h-[36rem] lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside aria-label="Funnel steps" className="flex min-h-0 flex-col border-b border-slate-200 bg-white lg:border-r lg:border-b-0">
        <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-auto">{content.flow.steps.map((step, index) => <article key={step.id} className={content.activeStepId === step.id ? "bg-sky-50" : "bg-white hover:bg-slate-50"}>
          <div className="flex items-start gap-2 px-4 py-4"><button type="button" onClick={() => selectStep(step.id)} className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><strong className="block truncate text-sm text-slate-900">{step.name}</strong><span className="mt-1 block text-xs text-slate-500">{step.isSystem ? "Funnel 停用時顯示" : step.type}</span></button>{!step.isSystem ? <div className="flex gap-1"><button type="button" aria-label={`上移 ${step.name}`} disabled={pending || index === 0} onClick={() => { const result = moveFunnelStepPage(content, step.id, Math.max(0, index - 1)); if (result.ok) persistContent(result.state, "步驟順序已儲存。"); }} className="cursor-pointer rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30">↑</button><button type="button" aria-label={`移除 ${step.name}`} disabled={pending} onClick={() => { if (!window.confirm(`確定移除「${step.name}」及其頁面內容？`)) return; const result = removeFunnelStepPage(content, step.id); if (result.ok) persistContent(result.state, "步驟已移除。"); else setMessage(result.error); }} className="cursor-pointer rounded p-1 text-red-600 hover:bg-red-50">×</button></div> : <MoreHorizontal size={17} className="text-slate-400" />}</div>
        </article>)}</div>
        <button type="button" onClick={() => setAddOpen(true)} className="m-3 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-sky-600 transition-colors hover:bg-sky-50"><Plus size={17} />Add step</button>
      </aside>
      <div className="min-w-0 overflow-auto">
        <nav aria-label="Funnel 次要分頁" className="flex min-w-max border-b border-slate-200 px-4">{tabs.map((item) => <button type="button" key={item} disabled={item !== "Configuration" && secondaryDisabled} aria-pressed={tab === item} className={`cursor-pointer border-b-2 px-4 py-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:text-slate-300 ${tab === item ? "border-sky-500 text-slate-950" : "border-transparent text-slate-500 hover:text-slate-900"}`} onClick={() => setTab(item)}>{item}</button>)}</nav>
        <div className="p-5 sm:p-7">
          {tab === "Configuration" ? <ConfigurationPanel active={active} content={content} editor={editor} templates={templates} selectedTemplateId={effectiveSelectedTemplateId} needsTemplate={needsTemplate} changeTemplate={changeTemplate} disabled={pending} setContent={(next) => { setContent(next); setDirty(true); }} setSelectedTemplateId={setSelectedTemplateId} setChangeTemplate={setChangeTemplate} onBlur={saveActiveMetadata} onApply={applyTemplate} navigate={navigate} /> : null}
          {tab === "Automation Rules" ? <FunnelAutomationSettings pageId={editor.pageId} csrfName={csrfName} csrfToken={csrfToken} /> : null}
          {tab !== "Configuration" && tab !== "Automation Rules" ? <fieldset disabled={pending} className="space-y-4"><legend className="mb-4 text-lg font-bold">{tab}</legend>{tab === "A/B test" ? <ExperimentSettings value={editor.operations.experiment} steps={editor.steps} onChange={(experiment) => operations({ ...editor.operations, experiment })} /> : null}{tab === "Deadline settings" ? <DeadlineSettings value={editor.operations.deadline} steps={editor.steps} onChange={(deadline) => operations({ ...editor.operations, deadline })} /> : null}{tab === "Stats" || tab === "Leads" || tab === "Sales" ? <ReportSettings tab={tab} editor={editor} reports={reports} onChange={operations} /> : null}<SettingsFooter pending={pending} dirty={dirty} save={saveSettings} reload={reload} /></fieldset> : null}
          {message ? <p role="status" className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">{message}</p> : null}
        </div>
      </div>
    </div>
    {settingsOpen ? <div role="dialog" aria-modal="true" aria-labelledby="funnel-settings-title" className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/60 p-4"><div className="max-h-[90dvh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between gap-4"><div><h2 id="funnel-settings-title" className="text-xl font-bold">Funnel settings</h2><p className="mt-1 text-sm text-slate-500">管理整個 Funnel 的名稱、網址與幣別。</p></div><button type="button" aria-label="關閉 Funnel settings" onClick={() => setSettingsOpen(false)} className="cursor-pointer rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button></div><GlobalSettings editor={editor} change={change} /><SettingsFooter pending={pending} dirty={dirty} save={saveSettings} reload={reload} /></div></div> : null}
    {addOpen ? <AddStepDialog goal={content.flow.goal} name={newStepName} path={newStepPath} type={newStepType} source={newStepSource} templateId={effectiveNewTemplateId} templates={newTemplates} disabled={pending} onName={setNewStepName} onPath={setNewStepPath} onType={setNewStepType} onSource={setNewStepSource} onTemplate={setNewTemplateId} onClose={() => setAddOpen(false)} onSave={addStep} /> : null}
  </section>;
}

function ConfigurationPanel({ active, content, editor, templates, selectedTemplateId, needsTemplate, changeTemplate, disabled, setContent, setSelectedTemplateId, setChangeTemplate, onBlur, onApply, navigate }: { active: ReturnType<typeof getActiveFunnelStepPage>; content: FunnelStepPages; editor: FunnelOperationsEditor; templates: ReturnType<typeof listFunnelTemplateGallery>; selectedTemplateId: string; needsTemplate: boolean; changeTemplate: boolean; disabled: boolean; setContent: (next: FunnelStepPages) => void; setSelectedTemplateId: (id: string) => void; setChangeTemplate: (value: boolean) => void; onBlur: () => void; onApply: (id: string) => void; navigate: (href: string) => void }) {
  if (!active || active.step.isSystem) return <div className="grid min-h-[28rem] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center"><div className="max-w-md p-8"><h2 className="text-xl font-bold text-slate-900">尚未建立 Funnel step</h2><p className="mt-2 text-sm leading-6 text-slate-500">Custom Funnel 會從空白流程開始。請使用左側的 Add step 選擇頁面類型，再決定套用模板或從空白開始。</p></div></div>;
  if (needsTemplate || changeTemplate) return <div><div className="mb-5"><p className="text-xs font-bold uppercase tracking-wider text-sky-600">Configuration</p><h2 className="mt-1 text-xl font-bold">為「{active.step.name}」選擇模板</h2><p className="mt-2 text-sm text-slate-500">模板已依 {content.flow.goal} 與 {active.step.type} 過濾。完整預覽後再套用。</p></div>{templates.length ? <FunnelTemplateGalleryPicker templates={templates} selectedId={selectedTemplateId} disabled={disabled} onSelect={setSelectedTemplateId} onApply={onApply} /> : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">這個 step type 沒有相容模板。請新增步驟時選擇「從空白開始」。</div>}{changeTemplate ? <button type="button" onClick={() => setChangeTemplate(false)} className={`${button} mt-4`}>取消更換模板</button> : null}</div>;
  const nextName = (name: string) => { const result = renameFunnelStepPage(content, active.step.id, name); if (result.ok) setContent(result.state); };
  const nextPath = (path: string) => { const result = setFunnelStepPathPage(content, active.step.id, path); if (result.ok) setContent(result.state); };
  return <div><div className="mb-6"><p className="text-xs font-bold uppercase tracking-wider text-sky-600">Configuration</p><h2 className="mt-1 text-xl font-bold text-slate-950">{active.step.name}</h2></div><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_14rem]"><div className="space-y-5"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">名稱 *<input className={control} value={active.step.name} disabled={disabled} onChange={(event) => nextName(event.currentTarget.value)} onBlur={onBlur} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">URL Path *<div className="flex min-h-10 overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100"><span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">/lp/{editor.slug}/</span><input aria-label="步驟 URL Path" className="min-w-0 flex-1 px-3 text-sm outline-none" value={active.step.path} disabled={disabled} onChange={(event) => nextPath(event.currentTarget.value)} onBlur={onBlur} /></div></label><div className="border-t border-slate-200 pt-5"><p className="text-sm text-slate-500">模板：{active.step.template.templateId ?? "從空白開始"}</p></div></div><div className="grid content-start gap-3"><Link href={`/lp/${editor.slug}/${active.step.path}`} target="_blank" className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 text-sm font-bold text-white hover:bg-sky-600"><ExternalLink size={17} />查看 Funnel step</Link><button type="button" disabled={disabled} onClick={() => navigate(`/landing-pages/${editor.pageId}?step=${encodeURIComponent(active.step.id)}`)} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 text-sm font-bold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"><Pencil size={17} />Edit Page</button>{templates.length ? <button type="button" disabled={disabled} onClick={() => setChangeTemplate(true)} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 text-sm font-bold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"><Settings size={17} />更換模板</button> : null}</div></div></div>;
}

function SettingsFooter({ pending, dirty, save, reload }: { pending: boolean; dirty: boolean; save: () => void; reload: () => void }) {
  return <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-4"><button type="button" disabled={pending || !dirty} className={`${button} border-blue-600 text-blue-700`} onClick={save}>儲存設定</button><button type="button" disabled={pending} className={button} onClick={reload}>重新載入</button><span className="text-sm text-slate-500">{pending ? "處理中…" : dirty ? "尚未儲存" : "已儲存"}</span></div>;
}

function AddStepDialog({ goal, name, path, type, source, templateId, templates, disabled, onName, onPath, onType, onSource, onTemplate, onClose, onSave }: { goal: FunnelStepPages["flow"]["goal"]; name: string; path: string; type: EditableStepType; source: "blank" | "template"; templateId: string; templates: ReturnType<typeof listFunnelTemplateGallery>; disabled: boolean; onName: (value: string) => void; onPath: (value: string) => void; onType: (value: EditableStepType) => void; onSource: (value: "blank" | "template") => void; onTemplate: (value: string) => void; onClose: () => void; onSave: () => void }) {
  const allowedGroups = stepTypeOptions.filter((group) => goal === "webinar" ? group.group === "Webinar" || group.group === "資訊" : group.group !== "Webinar");
  const canSave = Boolean(name.trim() && path.trim() && (source === "blank" || templateId));
  return <div role="dialog" aria-modal="true" aria-labelledby="add-step-title" className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/60 p-4"><div className="max-h-[90dvh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between gap-3"><div><h2 id="add-step-title" className="text-xl font-bold">Add step</h2><p className="mt-1 text-sm text-slate-500">選擇頁面類型與起始方式後一次建立，避免留下半完成步驟。</p></div><button type="button" aria-label="關閉 Add step" onClick={onClose} className="cursor-pointer rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button></div><div className="grid gap-4"><label className="grid gap-1 text-sm font-semibold">名稱 *<input className={control} value={name} onChange={(event) => onName(event.currentTarget.value)} /></label><label className="grid gap-1 text-sm font-semibold">URL Path *<input className={control} value={path} onChange={(event) => onPath(event.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/gu, ""))} /></label><label className="grid gap-1 text-sm font-semibold">Type *<select className={control} value={type} onChange={(event) => onType(event.currentTarget.value as EditableStepType)}>{allowedGroups.map((group) => <optgroup key={group.group} label={group.group}>{group.items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup>)}</select></label><fieldset><legend className="text-sm font-semibold">起始內容 *</legend><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 p-3"><input type="radio" checked={source === "template"} onChange={() => onSource("template")} />選擇模板</label><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 p-3"><input type="radio" checked={source === "blank"} onChange={() => onSource("blank")} />從空白開始</label></div></fieldset>{source === "template" ? <label className="grid gap-1 text-sm font-semibold">相容模板<select className={control} value={templateId} onChange={(event) => onTemplate(event.currentTarget.value)}><option value="">請選擇模板</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>{templates.length === 0 ? <span className="font-normal text-amber-700">這個類型目前沒有模板，請改選從空白開始。</span> : null}</label> : null}</div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className={button}>取消</button><button type="button" disabled={disabled || !canSave} onClick={onSave} className="min-h-10 cursor-pointer rounded-lg bg-blue-700 px-5 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40">儲存</button></div></div></div>;
}

function GlobalSettings({ editor, change }: { editor: FunnelOperationsEditor; change: (patch: Partial<SettingsState>) => void }) {
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
