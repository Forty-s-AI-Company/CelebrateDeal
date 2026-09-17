"use client";

import { useEffect, useMemo, useState } from "react";
import { FunnelPageDocumentRenderer, type FunnelViewport } from "./funnel-page-document-renderer";
import { FunnelPopupPreview } from "./funnel-popup-preview";
import { FunnelElementInspector } from "./funnel-element-inspector";
import {
  createFunnelPageHistory,
  dispatchFunnelPageCommand,
  redoFunnelPageHistory,
  undoFunnelPageHistory,
  type FunnelPageCommand,
} from "@/lib/funnel-page-history";
import { getFunnelNodeDefinition, type FunnelNode, type FunnelNodeType, type PageDocument } from "@/lib/funnel-page-document";
import { FUNNEL_BLOCK_REGISTRY, instantiateBlock } from "@/lib/funnel-block-library";
import { createFunnelPopup, deleteFunnelPopup, updateFunnelPopup, validatePopupTrigger } from "@/lib/funnel-popup";
import { FUNNEL_TEMPLATE_TRANSACTION_TEMPLATES, changeFunnelTemplate } from "@/lib/funnel-template-transaction";
import { addFunnelStep, getFunnelSecondaryTabs, moveFunnelStep, removeFunnelStep, renameFunnelStep, setFunnelStepPath, type FunnelFlowMutationResult } from "@/lib/funnel-flow";

type Props = { document: PageDocument; disabled?: boolean; onChange: (document: PageDocument) => void };

const palette: Array<{ type: FunnelNodeType; label: string }> = [
  { type: "section", label: "Section" }, { type: "row", label: "Row" },
  { type: "columns_2", label: "2 欄" }, { type: "columns_3", label: "3 欄" }, { type: "columns_4", label: "4 欄" },
  { type: "text", label: "文字" }, { type: "headline", label: "標題" }, { type: "image", label: "圖片" },
  { type: "button", label: "按鈕" }, { type: "bulleted_list", label: "項目清單" },
  { type: "content_box", label: "內容盒" }, { type: "horizontal_line", label: "水平線" },
  { type: "video", label: "影片" }, { type: "audio", label: "音訊" }, { type: "carousel", label: "輪播" },
  { type: "form", label: "表單" }, { type: "form_input", label: "表單欄位" }, { type: "checkbox", label: "核取方塊" },
  { type: "calendar", label: "行事曆" }, { type: "x_share_button", label: "X 分享" }, { type: "survey", label: "問卷" },
  { type: "countdown", label: "倒數計時" }, { type: "menu", label: "選單" }, { type: "faq", label: "FAQ" },
  { type: "raw_html", label: "Raw HTML" }, { type: "recaptcha", label: "reCAPTCHA" },
  { type: "payment_button", label: "付款按鈕" }, { type: "payment_method", label: "付款方式" }, { type: "offer_price", label: "方案價格" },
];

function nodeId(type: FunnelNodeType) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replaceAll("-", "").slice(0, 12) : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `${type}_${suffix}`;
}

function newNode(type: FunnelNodeType): FunnelNode {
  const props: Record<string, unknown> = type === "text" ? { text: "新的文字內容" }
    : type === "headline" ? { text: "新的標題", level: "h2" }
      : type === "image" ? { src: "/images/funnel-templates/low-barrier-lead-magnet.svg", alt: "" }
        : type === "button" ? { label: "立即行動" }
          : type === "bulleted_list" ? { items: ["第一個重點", "第二個重點"] }
            : {};
  return {
    schemaVersion: 1, id: nodeId(type), type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {},
    ...(getFunnelNodeDefinition(type).children ? { children: [] } : {}),
  };
}

function findPath(nodes: FunnelNode[], id: string, path: FunnelNode[] = []): FunnelNode[] | null {
  for (const node of nodes) {
    const next = [...path, node];
    if (node.id === id) return next;
    const nested = node.children ? findPath(node.children, id, next) : null;
    if (nested) return nested;
  }
  return null;
}

function findFirstAccepting(nodes: FunnelNode[], type: FunnelNodeType): string | null {
  for (const node of nodes) {
    if (getFunnelNodeDefinition(type).allowedParents.includes(node.type) && node.children) return node.id;
    const nested = node.children ? findFirstAccepting(node.children, type) : null;
    if (nested) return nested;
  }
  return null;
}
function findNodeLocation(nodes: FunnelNode[], id: string, parentId: string | null = null): { node: FunnelNode; parentId: string | null; index: number } | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.id === id) return { node, parentId, index };
    const nested = node.children ? findNodeLocation(node.children, id, node.id) : null;
    if (nested) return nested;
  }
  return null;
}
function capabilityBadge(status: string) { return status === "limited" ? "功能未啟用" : "待驗證"; }
function applyHistoryDirection(history: ReturnType<typeof createFunnelPageHistory>, direction: "undo" | "redo") {
  if (direction === "undo") return undoFunnelPageHistory(history);
  return redoFunnelPageHistory(history);
}
function PaletteButton({ item, disabled, onAdd }: { item: (typeof palette)[number]; disabled: boolean; onAdd: (type: FunnelNodeType) => void }) {
  const capability = getFunnelNodeDefinition(item.type).capability;
  const unavailable = capability.status !== "available";
  return <button draggable={!disabled && !unavailable} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-celebratedeal-funnel-element", item.type); }} disabled={disabled || unavailable} title={unavailable ? capability.reason : undefined} className="min-h-16 rounded-xl border border-slate-200 bg-white p-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" onClick={() => onAdd(item.type)}>{item.label}{unavailable ? <span className="mt-1 block text-[10px] font-medium text-amber-700">{capabilityBadge(capability.status)}</span> : null}</button>;
}
function BlockCapability({ limited }: { limited: boolean }) { return limited ? <span className="mt-1 block text-[10px] font-semibold text-amber-700">付款功能尚未啟用</span> : null; }
// The editor coordinates the palette, history, inspector, templates, Popups and canvas in one persisted session.
// eslint-disable-next-line complexity -- one session boundary owns the mutually exclusive editor panels.
export function FunnelPageEditor({ document, disabled = false, onChange }: Props) {
  const [history, setHistory] = useState(() => createFunnelPageHistory(document));
  const [selectedId, setSelectedId] = useState<string>();
  const [viewport, setViewport] = useState<FunnelViewport>("desktop");
  const [panel, setPanel] = useState<"elements" | "blocks" | "settings" | "page" | "popups" | "templates" | "flow">("elements");
  const [previewPopupId, setPreviewPopupId] = useState<string>();
  const [editingPopupId, setEditingPopupId] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [elementQuery, setElementQuery] = useState("");

  const editingPopup = history.present.popups.find((popup) => popup.id === editingPopupId);
  const activeRoot = editingPopup?.root ?? history.present.root;
  const path = useMemo(() => selectedId ? findPath(activeRoot, selectedId) : null, [activeRoot, selectedId]);
  const selected = path?.at(-1);
  const canvasDocument = useMemo(() => editingPopup ? { ...history.present, root: editingPopup.root, popups: [] } : history.present, [editingPopup, history.present]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        stepHistory(event.shiftKey ? "redo" : "undo");
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        commit({ type: "delete", nodeId: selectedId });
        setSelectedId(undefined);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  useEffect(() => {
    const command = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === "undo" || detail === "redo") stepHistory(detail);
      else if (detail === "desktop" || detail === "mobile") setViewport(detail);
    };
    window.addEventListener("celebratedeal:funnel-command", command);
    return () => window.removeEventListener("celebratedeal:funnel-command", command);
  });

  function commit(command: FunnelPageCommand) {
    if (disabled) return;
    setHistory((current) => {
      const next = dispatchFunnelPageCommand(current, command);
      if (next !== current) onChange(next.present);
      return next;
    });
  }

  function add(type: FunnelNodeType) {
    const node = newNode(type);
    const selectedParent = selected && selected.children && getFunnelNodeDefinition(type).allowedParents.includes(selected.type) ? selected.id : null;
    const targetRoot = editingPopup?.root ?? history.present.root;
    const parentId = type === "section" ? null : selectedParent ?? findFirstAccepting(targetRoot, type);
    commit({ type: "add", node, parentId, popupId: editingPopup?.id ?? null });
    setSelectedId(node.id);
  }

  function addBlock(templateId: string) {
    const block = instantiateBlock(templateId);
    commit({ type: "add", node: block, parentId: null, popupId: editingPopup?.id ?? null });
    setSelectedId(block.id);
  }

  function moveNode(sourceNodeId: string, targetNodeId: string) {
    const source = findNodeLocation(activeRoot, sourceNodeId);
    const target = findNodeLocation(activeRoot, targetNodeId);
    if (!source || !target) return;
    const targetAccepts = Boolean(target.node.children) && getFunnelNodeDefinition(source.node.type).allowedParents.includes(target.node.type);
    commit({ type: "move", nodeId: sourceNodeId, toParentId: targetAccepts ? target.node.id : target.parentId, index: targetAccepts ? target.node.children?.length : target.index });
  }

  function stepHistory(direction: "undo" | "redo") {
    setHistory((current) => {
      const next = applyHistoryDirection(current, direction);
      if (next !== current) onChange(next.present);
      return next;
    });
  }

  function replaceDocument(next: PageDocument | null) {
    if (!next) return;
    commit({ type: "replace_document", document: next });
  }

  function changeTemplate(templateId: string) {
    const preview = changeFunnelTemplate(history.present, { templateId });
    if (!preview.ok) { window.alert(preview.error ?? "此模板目前無法套用。"); return; }
    if (!preview.impact || !window.confirm(`${preview.impact.warning}\n\n目前 ${preview.impact.previousRootCount} 個區段將替換為 ${preview.impact.nextRootCount} 個區段。`)) return;
    const applied = changeFunnelTemplate(history.present, { templateId, confirm: true });
    if (applied.ok) { setSelectedId(undefined); replaceDocument(applied.document); }
  }

  function commitFlow(result: FunnelFlowMutationResult) {
    if (result.ok) commit({ type: "update_flow", flow: result.flow });
  }

  const control = "min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40";
  const visiblePalette = palette.filter((item) => `${item.label} ${item.type}`.toLocaleLowerCase("zh-TW").includes(elementQuery.trim().toLocaleLowerCase("zh-TW")));
  return <section className={`grid min-h-[calc(100dvh-10rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${sidebarCollapsed ? "grid-cols-[3.5rem_minmax(0,1fr)]" : "grid-cols-[18rem_minmax(0,1fr)]"}`}>
    <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50">
      <button type="button" aria-label={sidebarCollapsed ? "展開左側面板" : "收合左側面板"} onClick={() => setSidebarCollapsed((value) => !value)} className="m-2 min-h-10 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-700">{sidebarCollapsed ? "→" : "← 收合"}</button>
      {sidebarCollapsed ? null : <>
      <div className="grid grid-cols-3 gap-1 border-b border-slate-200 p-2">
        <button className={`${control} ${panel === "elements" ? "border-blue-600 text-blue-700" : ""}`} onClick={() => setPanel("elements")}>Elements</button>
        <button className={`${control} ${panel === "blocks" ? "border-blue-600 text-blue-700" : ""}`} onClick={() => setPanel("blocks")}>Blocks</button>
        <button className={`${control} ${panel === "settings" ? "border-blue-600 text-blue-700" : ""}`} onClick={() => setPanel("settings")}>設定</button>
        <button id="funnel-page-settings-tab" className={`${control} ${panel === "page" ? "border-blue-600 text-blue-700" : ""}`} onClick={() => setPanel("page")}>頁面</button>
        <button id="funnel-popups-tab" className={`${control} ${panel === "popups" ? "border-blue-600 text-blue-700" : ""}`} onClick={() => setPanel("popups")}>Popups</button>
        <button className={`${control} ${panel === "templates" ? "border-blue-600 text-blue-700" : ""}`} onClick={() => setPanel("templates")}>換模板</button>
        <button className={`${control} ${panel === "flow" ? "border-blue-600 text-blue-700" : ""}`} disabled={!history.present.flow} onClick={() => setPanel("flow")}>流程</button>
      </div>
      <div className="flex items-center gap-2 border-b border-slate-200 p-2">
        <button className={control} disabled={!history.past.length} onClick={() => stepHistory("undo")}>Undo</button>
        <button className={control} disabled={!history.future.length} onClick={() => stepHistory("redo")}>Redo</button>
        <button className={control} onClick={() => setViewport(viewport === "desktop" ? "mobile" : "desktop")}>{viewport === "desktop" ? "桌機" : "手機"}</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {panel === "elements" ? <div className="grid gap-2"><input aria-label="搜尋 Elements" value={elementQuery} onChange={(event) => setElementQuery(event.currentTarget.value)} placeholder="搜尋元件" className={control} /><div className="grid grid-cols-2 gap-2">{visiblePalette.map((item) => <PaletteButton key={item.type} item={item} disabled={disabled} onAdd={add} />)}</div>{!visiblePalette.length ? <p className="py-6 text-center text-sm text-slate-500">找不到符合的元件。</p> : null}</div> : panel === "blocks" ? <div className="grid gap-2">{Object.values(FUNNEL_BLOCK_REGISTRY).map((block) => <button key={block.id} draggable={!disabled} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-celebratedeal-funnel-block", block.id); }} disabled={disabled} className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-blue-400" onClick={() => addBlock(block.id)}><span className="block text-sm font-bold text-slate-800">{block.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{block.description}</span><BlockCapability limited={Boolean(block.capability)} /></button>)}</div> : panel === "flow" && history.present.flow ? <div className="grid gap-3"><div><h2 className="font-bold">Funnel 流程</h2><p className="mt-1 text-xs text-slate-500">{history.present.flow.name} · {history.present.flow.currency}</p></div>{history.present.flow.steps.map((step, index) => <article key={step.id} className="grid gap-2 rounded-xl border bg-white p-3"><input aria-label={`${step.name} 名稱`} disabled={step.isSystem} className={control} value={step.name} onChange={(event) => commitFlow(renameFunnelStep(history.present.flow!, step.id, event.currentTarget.value))} /><label className="text-xs text-slate-500">URL Path<input disabled={step.isSystem} className={control} value={step.path} onChange={(event) => commitFlow(setFunnelStepPath(history.present.flow!, step.id, event.currentTarget.value))} /></label>{!step.isSystem ? <div className="grid grid-cols-3 gap-1"><button className={control} disabled={index === 0} onClick={() => commitFlow(moveFunnelStep(history.present.flow!, step.id, index - 1))}>上移</button><button className={control} disabled={index >= history.present.flow!.steps.length - 2} onClick={() => commitFlow(moveFunnelStep(history.present.flow!, step.id, index + 1))}>下移</button><button className={`${control} text-red-700`} onClick={() => { if (window.confirm(`確定移除「${step.name}」？`)) commitFlow(removeFunnelStep(history.present.flow!, step.id)); }}>移除</button></div> : <p className="text-xs text-slate-500">系統停用頁</p>}</article>)}<button className={control} onClick={() => commitFlow(addFunnelStep(history.present.flow!, { name: "新資訊頁", path: `info-${history.present.flow!.steps.length}`, type: "info_page", templateSource: "blank" }))}>＋ 新增資訊頁</button><h3 className="mt-2 font-bold">次要分頁狀態</h3>{getFunnelSecondaryTabs(history.present.flow).map((tab) => <div key={tab.id} className="rounded-lg border border-slate-200 p-2 text-xs"><strong>{tab.label}</strong><span className={`ml-2 ${tab.capability.status === "available" ? "text-emerald-700" : "text-amber-700"}`}>{tab.capability.status}</span><p className="mt-1 text-slate-500">{tab.capability.reason}</p></div>)}</div> : panel === "templates" ? <div className="grid gap-3"><h2 className="font-bold">更換頁面模板</h2><p className="text-xs leading-5 text-amber-800">套用後會替換目前畫布與 Popup；頁面名稱、版本及設定會保留。</p>{Object.values(FUNNEL_TEMPLATE_TRANSACTION_TEMPLATES).map((template) => <button key={template.id} disabled={disabled || template.status !== "available"} title={template.reason} className="rounded-xl border border-slate-200 bg-white p-3 text-left disabled:cursor-not-allowed disabled:bg-slate-100" onClick={() => changeTemplate(template.id)}><span className="font-bold text-slate-800">{template.name}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{template.description}</span>{template.status !== "available" ? <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">待驗證</span> : null}</button>)}</div> : panel === "popups" ? <div className="grid gap-3">
          <div className="flex items-center justify-between"><h2 className="font-bold">Popups</h2><button className={control} onClick={() => replaceDocument(createFunnelPopup(history.present, { name: `Popup ${history.present.popups.length + 1}` }))}>＋ 新增</button></div>
          {!history.present.popups.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">尚未建立 Popup。</p> : history.present.popups.map((popup) => { const auto = validatePopupTrigger(popup, "automatic_delay"); const exit = validatePopupTrigger(popup, "exit_intent"); return <article key={popup.id} className="grid gap-2 rounded-xl border bg-white p-3"><input className={control} value={popup.name} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { name: event.currentTarget.value }))} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={popup.settings.openAutomatically} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { settings: { openAutomatically: event.currentTarget.checked } }))} />自動開啟</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={popup.settings.showCloseButton} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { settings: { showCloseButton: event.currentTarget.checked } }))} />顯示關閉按鈕</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={popup.settings.openOnExitIntent} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { settings: { openOnExitIntent: event.currentTarget.checked } }))} />Exit intent（待驗證，不會觸發）</label><label className="grid gap-1 text-xs">顯示延遲（秒）<input className={control} type="number" min="0" value={popup.settings.automaticDelaySeconds} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { settings: { automaticDelaySeconds: Number(event.currentTarget.value) } }))} /></label><label className="grid gap-1 text-xs">背景色<input className={control} value={popup.settings.backgroundColor} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { settings: { backgroundColor: event.currentTarget.value } }))} /></label><label className="grid gap-1 text-xs">Padding<input type="number" min="0" className={control} value={popup.settings.padding} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { settings: { padding: Number(event.currentTarget.value) } }))} /></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs">Border<input type="number" min="0" className={control} value={popup.settings.borderWidth} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { settings: { borderWidth: Number(event.currentTarget.value) } }))} /></label><label className="grid gap-1 text-xs">Shadow<select className={control} value={popup.settings.shadow} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { settings: { shadow: event.currentTarget.value as typeof popup.settings.shadow } }))}><option value="none">無</option><option value="soft">柔和</option><option value="medium">中等</option><option value="strong">明顯</option></select></label></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={popup.pageId === history.present.id} onChange={(event) => replaceDocument(updateFunnelPopup(history.present, popup.id, { pageId: event.currentTarget.checked ? history.present.id : undefined }))} />只綁定目前頁面</label><p className="text-[11px] text-slate-500">自動顯示：{auto.executable ? `${auto.delayMs}ms` : auto.reason}</p><p className="text-[11px] text-amber-700">Exit intent：{exit.reason}</p><p className="text-[11px] text-slate-500">寬度與圓角可進入「編輯」後選取 Popup Section 調整。</p><div className="grid grid-cols-3 gap-2"><button className={control} onClick={() => { setEditingPopupId(popup.id); setSelectedId(undefined); }}>編輯</button><button className={control} onClick={() => setPreviewPopupId(popup.id)}>預覽</button><button className={`${control} text-red-700`} onClick={() => { if (editingPopupId === popup.id) setEditingPopupId(undefined); replaceDocument(deleteFunnelPopup(history.present, popup.id)); }}>刪除</button></div></article>; })}
        </div> : panel === "page" ? <div className="grid gap-4">
          <h2 className="text-base font-bold">頁面設定</h2>
          <label className="grid gap-1 text-sm font-semibold">語言<select className={control} value={history.present.settings.language} onChange={(event) => commit({ type: "update_settings", settings: { language: event.currentTarget.value as PageDocument["settings"]["language"] } })}><option value="zh-TW">繁體中文</option><option value="en">English</option><option value="ja">日本語</option></select></label>
          <label className="grid gap-1 text-sm font-semibold">SEO 標題<input className={control} value={history.present.settings.seo.title ?? ""} onChange={(event) => commit({ type: "update_settings", settings: { seo: { ...history.present.settings.seo, title: event.currentTarget.value } } })} /></label>
          <label className="grid gap-1 text-sm font-semibold">SEO 描述<textarea className={control} value={history.present.settings.seo.description ?? ""} onChange={(event) => commit({ type: "update_settings", settings: { seo: { ...history.present.settings.seo, description: event.currentTarget.value } } })} /></label>
          <label className="grid gap-1 text-sm font-semibold">背景色<input className={control} value={history.present.settings.background.color} onChange={(event) => commit({ type: "update_settings", settings: { background: { ...history.present.settings.background, color: event.currentTarget.value } } })} /></label>
          <label className="grid gap-1 text-sm font-semibold">內文字型<input className={control} value={history.present.settings.typography.bodyFont} onChange={(event) => commit({ type: "update_settings", settings: { typography: { ...history.present.settings.typography, bodyFont: event.currentTarget.value } } })} /></label>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Tracking：{history.present.settings.tracking.reason}<br />Affiliate：{history.present.settings.affiliate.reason}</div>
        </div> : selected ? <div className="grid gap-4">
          <div><p className="text-xs font-bold text-slate-500">Breadcrumb</p><p className="mt-1 text-sm text-slate-700">{path?.map((item) => getFunnelNodeDefinition(item.type).label).join(" › ")}</p></div>
          <FunnelElementInspector node={selected} disabled={disabled} popupIds={history.present.popups.map((popup) => popup.id)} onCommand={commit} />
          <div className="grid grid-cols-2 gap-2"><button className={control} onClick={() => commit({ type: "move_up", nodeId: selected.id })}>上移</button><button className={control} onClick={() => commit({ type: "move_down", nodeId: selected.id })}>下移</button><button className={control} onClick={() => commit({ type: "duplicate", nodeId: selected.id })}>複製</button><button className={`${control} text-red-700`} onClick={() => { commit({ type: "delete", nodeId: selected.id }); setSelectedId(undefined); }}>刪除</button></div>
        </div> : <p className="text-sm text-slate-500">請先在畫布選取節點。</p>}
      </div>
      </>}
    </aside>
    <div className="min-h-0 overflow-auto bg-slate-200/70 p-5" onDragOver={(event) => { if (event.dataTransfer.types.some((type) => type.includes("celebratedeal-funnel-element") || type.includes("celebratedeal-funnel-block"))) event.preventDefault(); }} onDrop={(event) => { const type = event.dataTransfer.getData("application/x-celebratedeal-funnel-element") as FunnelNodeType; const blockId = event.dataTransfer.getData("application/x-celebratedeal-funnel-block"); if (type) { event.preventDefault(); add(type); } else if (blockId) { event.preventDefault(); addBlock(blockId); } }}>
      <div className="mx-auto mb-3 flex max-w-[1440px] items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><span className="font-semibold text-slate-700">{editingPopup ? `正在編輯 Popup：${editingPopup.name}` : "正在編輯頁面"}</span>{editingPopup ? <button type="button" className={control} onClick={() => { setEditingPopupId(undefined); setSelectedId(undefined); }}>返回頁面畫布</button> : null}</div>
      <div className={`mx-auto min-h-full bg-white shadow-xl transition-[width] ${viewport === "mobile" ? "w-[375px] max-w-full rounded-[2rem] border-[10px] border-slate-900" : "w-full max-w-[1440px]"}`}>
        <FunnelPageDocumentRenderer document={canvasDocument} viewport={viewport} mode="editor" selectedNodeId={selectedId} onMoveNode={moveNode} onSelectNode={(id) => { setSelectedId(id); setPanel("settings"); }} />
      </div>
    </div>
    {previewPopupId ? <FunnelPopupPreview document={history.present} popupId={previewPopupId} viewport={viewport} previewEnabled onTriggerStatus={() => undefined} /> : null}
  </section>;
}
