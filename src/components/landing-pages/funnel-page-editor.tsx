"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { FunnelPageDocumentRenderer, type FunnelViewport } from "./funnel-page-document-renderer";
import { FunnelPopupPreview } from "./funnel-popup-preview";
import { FunnelEditorToolbar, type FunnelEditorView } from "./funnel-editor-toolbar";
import { EditorLibrary, FUNNEL_BLOCK_DRAG_TYPE, FUNNEL_ELEMENT_DRAG_TYPE, funnelNodeLabel } from "./funnel-editor-library";
import { NodeSettingsPanel, PageSettingsPanel, PanelHeader, PopupsPanel } from "./funnel-editor-panels";
import { editorShortcutFor, type EditorShortcut, type FunnelEditorChrome } from "./funnel-editor-chrome";
import { commerceViewForBinding, type FunnelCommerceProduct } from "@/lib/funnel-commerce";
import {
  createFunnelPageHistory,
  dispatchFunnelPageCommand,
  redoFunnelPageHistory,
  undoFunnelPageHistory,
  type FunnelPageCommand,
} from "@/lib/funnel-page-history";
import { getFunnelNodeDefinition, type FunnelNode, type FunnelNodeType, type PageDocument } from "@/lib/funnel-page-document";
import { instantiateBlock } from "@/lib/funnel-block-library";

type Props = { document: PageDocument; disabled?: boolean; onChange: (document: PageDocument) => void | boolean; stepIds?: readonly string[]; stepNames?: Readonly<Record<string, string>>; commerceProducts?: FunnelCommerceProduct[]; commerceEnabled?: boolean; chrome?: FunnelEditorChrome };
type History = ReturnType<typeof createFunnelPageHistory>;

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
function applyHistoryDirection(history: History, direction: "undo" | "redo") {
  if (direction === "undo") return undoFunnelPageHistory(history);
  return redoFunnelPageHistory(history);
}
/** Narrow screens open with the panel collapsed so it overlays instead of squeezing the canvas. */
function initiallyCollapsed() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1023px)").matches;
}

/** Window-level shortcuts; the latest handler always runs (no stale closures). */
function useEditorShortcuts(handle: (shortcut: EditorShortcut, event: KeyboardEvent) => void) {
  const handler = useRef(handle);
  useEffect(() => { handler.current = handle; });
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const shortcut = editorShortcutFor(event);
      if (shortcut) handler.current(shortcut, event);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
}

/** Parent echoes acknowledge local edits; a different document starts a fresh
 * editing session so old undo commands cannot overwrite a restored document. */
export function FunnelPageEditor(props: Props) {
  const [session, setSession] = useState(() => ({ input: props.document, present: props.document, version: 0 }));
  if (session.input !== props.document) {
    const echoed = JSON.stringify(session.present) === JSON.stringify(props.document);
    setSession({ input: props.document, present: props.document, version: session.version + (echoed ? 0 : 1) });
  }
  return <FunnelPageEditorSession {...props} key={session.version} onChange={(document) => {
    const accepted = props.onChange(document);
    if (accepted === false) return false;
    setSession((current) => ({ ...current, present: document }));
    return accepted;
  }} />;
}

type LeftView = "library" | "node" | FunnelEditorView;

// The session owns history, selection, the left panel view and the canvas viewport.
function FunnelPageEditorSession({ document, disabled = false, onChange, commerceProducts = [], commerceEnabled = false, stepIds, stepNames, chrome }: Props) {
  const [history, setHistory] = useState(() => createFunnelPageHistory(document));
  const historyRef = useRef(history);
  const [selectedId, setSelectedId] = useState<string>();
  const [viewport, setViewport] = useState<FunnelViewport>("desktop");
  const [leftView, setLeftView] = useState<LeftView>("library");
  const [previewPopupId, setPreviewPopupId] = useState<string>();
  const [editingPopupId, setEditingPopupId] = useState<string>();
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [previewing, setPreviewing] = useState(false);

  const editingPopup = history.present.popups.find((popup) => popup.id === editingPopupId);
  const activeRoot = editingPopup?.root ?? history.present.root;
  const path = useMemo(() => selectedId ? findPath(activeRoot, selectedId) : null, [activeRoot, selectedId]);
  const selected = path?.at(-1);
  const canvasDocument = useMemo(() => editingPopup ? { ...history.present, root: editingPopup.root, popups: [] } : history.present, [editingPopup, history.present]);
  const resolvedStepIds = stepIds ?? history.present.flow?.steps.map((step) => step.id);
  const resolvedStepNames = stepNames ?? Object.fromEntries((history.present.flow?.steps ?? []).map((step) => [step.id, step.name]));
  const views: FunnelEditorView[] = chrome?.versions ? ["popups", "page", "versions"] : ["popups", "page"];

  useEditorShortcuts((shortcut, event) => {
    if (shortcut === "save") {
      event.preventDefault();
      if (chrome && chrome.saveState === "dirty" && !chrome.saveBlocked) chrome.onSave();
      return;
    }
    if (previewing) return;
    if (shortcut === "undo" || shortcut === "redo") { event.preventDefault(); stepHistory(shortcut); }
    else if (shortcut === "delete" && selectedId && !disabled) { event.preventDefault(); removeSelected(); }
    else if (shortcut === "deselect" && (selectedId || leftView !== "library")) { event.preventDefault(); deselect(); }
  });

  // Legacy integration: older toolbars and QA harnesses dispatch window commands.
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
    publishHistory(dispatchFunnelPageCommand(historyRef.current, command));
  }

  function publishHistory(next: History) {
    if (next === historyRef.current) return;
    // Keep callbacks outside React state updaters: Strict Mode may replay them.
    // The outer multi-page store may reject broken cross-page references.
    // Publish history only after acceptance, so rejected content never ghosts.
    if (onChange(next.present) === false) return;
    historyRef.current = next;
    setHistory(next);
  }

  function add(type: FunnelNodeType) {
    const node = newNode(type);
    const selectedParent = selected && selected.children && getFunnelNodeDefinition(type).allowedParents.includes(selected.type) ? selected.id : null;
    const parentId = type === "section" ? null : selectedParent ?? findFirstAccepting(activeRoot, type);
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
    if (disabled) return;
    publishHistory(applyHistoryDirection(historyRef.current, direction));
  }

  function replaceDocument(next: PageDocument | null) {
    if (!next) return;
    commit({ type: "replace_document", document: next });
  }

  function inspect(id: string) {
    setSelectedId(id);
    setLeftView("node");
    setCollapsed(false);
  }
  function deselect() {
    setSelectedId(undefined);
    setLeftView("library");
  }
  function removeSelected() {
    if (!selectedId) return;
    commit({ type: "delete", nodeId: selectedId });
    deselect();
  }
  function toggleView(view: FunnelEditorView) {
    setCollapsed(false);
    setLeftView((current) => current === view ? (selected ? "node" : "library") : view);
  }
  function backToCanvasPanel() { setLeftView(selected ? "node" : "library"); }
  function editPopup(popupId: string) {
    setSelectedId(undefined);
    setEditingPopupId(popupId || undefined);
    if (popupId) setLeftView("library");
  }

  function renderPanel() {
    if (leftView === "page") return <PageSettingsPanel document={history.present} disabled={disabled} commerceEnabled={commerceEnabled} commerceProducts={commerceProducts} workspaceSettings={chrome?.pageSettings} onCommand={commit} onReplace={replaceDocument} onBack={backToCanvasPanel} />;
    if (leftView === "popups") return <PopupsPanel document={history.present} disabled={disabled} editingPopupId={editingPopupId} onReplace={replaceDocument} onEdit={editPopup} onPreview={setPreviewPopupId} onBack={backToCanvasPanel} />;
    if (leftView === "versions" && chrome?.versions) return <div><PanelHeader title="版本紀錄" onBack={backToCanvasPanel} />{chrome.versions}</div>;
    if (leftView === "node" && selected && path) return <NodeSettingsPanel node={selected} path={path} disabled={disabled} popups={history.present.popups} stepIds={resolvedStepIds} stepNames={resolvedStepNames} onCommand={commit} onBack={deselect} onDelete={removeSelected} />;
    return <EditorLibrary disabled={disabled} onAddElement={add} onAddBlock={addBlock} />;
  }
  function renderCanvas() {
    if (previewing && chrome?.renderPreview) return chrome.renderPreview(viewport);
    return <FunnelPageDocumentRenderer document={canvasDocument} commerce={commerceViewForBinding(canvasDocument.commerce, commerceProducts)} viewport={viewport} mode="editor" selectedNodeId={selectedId} onMoveNode={moveNode} onSelectNode={inspect} />;
  }

  const crumbs = path?.map((node) => ({ id: node.id, label: funnelNodeLabel(node.type) })) ?? [];
  const historyControls = { canUndo: !disabled && history.past.length > 0, canRedo: !disabled && history.future.length > 0, onUndo: () => stepHistory("undo"), onRedo: () => stepHistory("redo") };
  const toolbarView = leftView === "library" || leftView === "node" ? null : leftView;
  return <div data-funnel-page-editor className="flex h-full min-h-0 w-full flex-col bg-slate-100">
    <FunnelEditorToolbar chrome={chrome} history={historyControls} views={views} view={toolbarView} onToggleView={toggleView}
      crumbs={crumbs} context={editingPopup ? `彈出視窗：${editingPopup.name}` : undefined} onSelectCrumb={inspect}
      viewport={viewport} onViewport={setViewport} previewing={previewing} onTogglePreview={chrome?.renderPreview ? () => setPreviewing((value) => !value) : undefined} />
    <div className="relative flex min-h-0 flex-1">
      {previewing ? null : <EditorSidePanel collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)}>{renderPanel()}</EditorSidePanel>}
      <EditorCanvas previewing={previewing} viewport={viewport} popupName={editingPopup?.name} onExitPopup={() => editPopup("")} onDeselect={deselect} onDropElement={add} onDropBlock={addBlock}>{renderCanvas()}</EditorCanvas>
    </div>
    {previewPopupId ? <FunnelPopupPreview document={history.present} commerce={commerceViewForBinding(history.present.commerce, commerceProducts)} popupId={previewPopupId} viewport={viewport} previewEnabled onTriggerStatus={() => undefined} /> : null}
  </div>;
}

const panelWidth = "w-[min(20rem,calc(100vw-3rem))] lg:w-80";

/** EDT-LAYOUT-001 left panel with an edge toggle; below `lg` it overlays the canvas. */
function EditorSidePanel({ collapsed, onToggle, children }: { collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  const label = collapsed ? "展開左側面板" : "收合左側面板";
  return <>
    <aside id="funnel-editor-left-panel" aria-label="編輯面板" hidden={collapsed} className={`absolute inset-y-0 left-0 z-30 flex ${panelWidth} flex-col border-r border-slate-200 bg-white shadow-xl lg:static lg:z-auto lg:shrink-0 lg:shadow-none`}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
    <button type="button" aria-controls="funnel-editor-left-panel" aria-expanded={!collapsed} aria-label={label} title={label} onClick={onToggle}
      className={`absolute top-1/2 z-30 grid h-12 w-6 -translate-y-1/2 cursor-pointer place-items-center rounded-r-lg border border-l-0 border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${collapsed ? "left-0" : "left-[min(20rem,calc(100vw-3rem))] lg:left-80"}`}>
      {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
    </button>
  </>;
}

/** Scrollable canvas: full width up to the page max width, or the 375px device frame. */
function EditorCanvas({ previewing, viewport, popupName, onExitPopup, onDeselect, onDropElement, onDropBlock, children }: { previewing: boolean; viewport: FunnelViewport; popupName?: string; onExitPopup: () => void; onDeselect: () => void; onDropElement: (type: FunnelNodeType) => void; onDropBlock: (templateId: string) => void; children: React.ReactNode }) {
  return <div role="region" aria-label={previewing ? "預覽畫面" : "編輯畫布"} className="min-w-0 flex-1 overflow-auto px-4 py-5 lg:px-8"
    onClick={(event) => { if (!previewing && event.target === event.currentTarget) onDeselect(); }}
    onDragOver={(event) => { if (!previewing && event.dataTransfer.types.some((type) => type === FUNNEL_ELEMENT_DRAG_TYPE || type === FUNNEL_BLOCK_DRAG_TYPE)) event.preventDefault(); }}
    onDrop={(event) => {
      if (previewing) return;
      const type = event.dataTransfer.getData(FUNNEL_ELEMENT_DRAG_TYPE) as FunnelNodeType;
      const blockId = event.dataTransfer.getData(FUNNEL_BLOCK_DRAG_TYPE);
      if (type) { event.preventDefault(); onDropElement(type); } else if (blockId) { event.preventDefault(); onDropBlock(blockId); }
    }}>
    {popupName && !previewing ? <div className="mx-auto mb-3 flex max-w-[1440px] items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm"><span className="font-semibold text-violet-900">正在編輯彈出視窗：{popupName}</span><button type="button" className="min-h-9 cursor-pointer rounded-lg border border-violet-300 bg-white px-3 text-sm font-semibold text-violet-800 hover:bg-violet-100" onClick={onExitPopup}>返回頁面畫布</button></div> : null}
    <div className={`mx-auto min-h-full bg-white shadow-xl transition-[width] ${viewport === "mobile" ? "w-[375px] max-w-full overflow-hidden rounded-[2rem] border-[10px] border-slate-900" : "w-full max-w-[1440px]"}`}>{children}</div>
  </div>;
}
