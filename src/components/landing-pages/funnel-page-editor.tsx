"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { FunnelPageDocumentRenderer, type FunnelInlineEditingBinding, type FunnelNodeSelectDetail, type FunnelViewport } from "./funnel-page-document-renderer";
import { FunnelPopupPreview } from "./funnel-popup-preview";
import { FunnelEditorToolbar, type FunnelEditorView } from "./funnel-editor-toolbar";
import { EditorLibrary, funnelNodeLabel } from "./funnel-editor-library";
import { NodeSettingsPanel, PageSettingsPanel, PanelHeader, PopupsPanel } from "./funnel-editor-panels";
import { editorShortcutFor, type EditorShortcut, type FunnelEditorChrome } from "./funnel-editor-chrome";
import { EditorCanvas, FunnelNodeToolbar, startNodeDrag } from "./funnel-editor-canvas-view";
import { endFunnelDrag } from "./funnel-editor-drag";
import { commerceViewForBinding, type FunnelCommerceProduct } from "@/lib/funnel-commerce";
import { funnelDropCommand, type FunnelDragPayload, type FunnelDropTarget } from "@/lib/funnel-editor-canvas";
import { funnelInlineField, funnelInlineTextCommand, isFunnelInlineEditable } from "@/lib/funnel-inline-text";
import {
  createFunnelPageHistory,
  dispatchFunnelPageCommand,
  redoFunnelPageHistory,
  undoFunnelPageHistory,
  type FunnelPageCommand,
} from "@/lib/funnel-page-history";
import { getFunnelNodeDefinition, type FunnelNode, type FunnelNodeType, type PageDocument } from "@/lib/funnel-page-document";
import { instantiateBlock } from "@/lib/funnel-block-library";
import { funnelShowcaseDefaultProps, funnelShowcaseDefaultStyle } from "@/lib/funnel-showcase-defaults";

type Props = { document: PageDocument; disabled?: boolean; onChange: (document: PageDocument) => void | boolean; stepIds?: readonly string[]; stepNames?: Readonly<Record<string, string>>; commerceProducts?: FunnelCommerceProduct[]; commerceEnabled?: boolean; chrome?: FunnelEditorChrome };
type History = ReturnType<typeof createFunnelPageHistory>;

function nodeId(type: FunnelNodeType) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replaceAll("-", "").slice(0, 12) : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `${type}_${suffix}`;
}

function newNode(type: FunnelNodeType): FunnelNode {
  const props: Record<string, unknown> = type === "text" ? { text: "新的文字內容" }
    : type === "headline" ? { text: "新的標題", level: "h2" }
      : type === "image" ? { src: "/placeholder.svg", alt: "" }
        : type === "button" ? { label: "立即行動" }
          : type === "bulleted_list" ? { items: ["第一個重點", "第二個重點"] }
            : funnelShowcaseDefaultProps(type) ?? {};
  return {
    schemaVersion: 1, id: nodeId(type), type, props, style: funnelShowcaseDefaultStyle(type), overrides: {}, visible: true, actions: [], attributes: {},
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
type InlineEditState = { nodeId: string; itemIndex?: number; caret?: { x: number; y: number } };

/** Selected node with its ancestry and position among its siblings. */
function selectionContext(root: FunnelNode[], selectedId: string | undefined) {
  const path = selectedId ? findPath(root, selectedId) : null;
  const selected = path?.at(-1);
  const selectedParent = path && path.length > 1 ? path.at(-2) : undefined;
  const siblings = selected ? selectedParent?.children ?? root : [];
  const selectedIndex = selected ? siblings.findIndex((node) => node.id === selected.id) : -1;
  return { path, selected, selectedParent, siblings, selectedIndex };
}

// The session owns history, selection, inline editing, the left panel view and the canvas viewport.
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
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const canvasRegion = useRef<HTMLDivElement>(null);
  const canvasContainer = useRef<HTMLDivElement>(null);

  const editingPopup = history.present.popups.find((popup) => popup.id === editingPopupId);
  const activeRoot = editingPopup?.root ?? history.present.root;
  const { path, selected, selectedParent, siblings, selectedIndex } = useMemo(() => selectionContext(activeRoot, selectedId), [activeRoot, selectedId]);
  const canvasDocument = useMemo(() => editingPopup ? { ...history.present, root: editingPopup.root, popups: [] } : history.present, [editingPopup, history.present]);
  const layoutKey = useMemo(() => ({ canvasDocument, viewport, inlineEdit }), [canvasDocument, viewport, inlineEdit]);
  const resolvedStepIds = stepIds ?? history.present.flow?.steps.map((step) => step.id);
  const resolvedStepNames = stepNames ?? Object.fromEntries((history.present.flow?.steps ?? []).map((step) => [step.id, step.name]));
  const views: FunnelEditorView[] = chrome?.versions ? ["popups", "page", "versions"] : ["popups", "page"];

  useEditorShortcuts((shortcut, event) => {
    // While text is being edited on the canvas, keys belong to the text (Ctrl+S only stops the browser dialog).
    if (inlineEdit) {
      if (shortcut === "save") event.preventDefault();
      return;
    }
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
      if ((detail === "undo" || detail === "redo") && !inlineEdit) stepHistory(detail);
      else if (detail === "desktop" || detail === "mobile") setViewport(detail);
    };
    window.addEventListener("celebratedeal:funnel-command", command);
    return () => window.removeEventListener("celebratedeal:funnel-command", command);
  });

  function announce(message: string) { setAnnouncement(message); }

  /** Applies one command; true only when the document changed and the owner accepted it. */
  function commit(command: FunnelPageCommand): boolean {
    if (disabled) return false;
    return publishHistory(dispatchFunnelPageCommand(historyRef.current, command));
  }

  function publishHistory(next: History): boolean {
    if (next === historyRef.current) return false;
    // Keep callbacks outside React state updaters: Strict Mode may replay them.
    // The outer multi-page store may reject broken cross-page references.
    // Publish history only after acceptance, so rejected content never ghosts.
    if (onChange(next.present) === false) return false;
    historyRef.current = next;
    setHistory(next);
    return true;
  }

  function select(id: string | undefined) {
    setInlineEdit(null);
    setSelectedId(id);
  }

  function add(type: FunnelNodeType) {
    const node = newNode(type);
    const selectedParentId = selected && selected.children && getFunnelNodeDefinition(type).allowedParents.includes(selected.type) ? selected.id : null;
    // Page-level elements (navigation bar, divider) go to the page root unless a container that accepts them is selected; a new navigation bar starts at the top.
    const pageLevel = type === "nav_bar" || type === "shape_divider";
    const parentId = type === "section" || (pageLevel && !selectedParentId) ? null : selectedParentId ?? findFirstAccepting(activeRoot, type);
    const index = type === "nav_bar" && parentId === null ? 0 : undefined;
    if (commit({ type: "add", node, parentId, popupId: editingPopup?.id ?? null, index })) select(node.id);
  }

  function addBlock(templateId: string) {
    const block = instantiateBlock(templateId);
    if (commit({ type: "add", node: block, parentId: null, popupId: editingPopup?.id ?? null })) select(block.id);
  }

  /** EDT-INT-002: one drop, one history command; the dropped node becomes the selection. */
  function dropOnCanvas(target: FunnelDropTarget, payload: FunnelDragPayload) {
    let node: FunnelNode | undefined;
    try {
      node = payload.kind === "element" ? newNode(payload.nodeType) : payload.kind === "block" ? instantiateBlock(payload.templateId) : undefined;
    } catch {
      node = undefined;
    }
    const command = funnelDropCommand(target, payload, editingPopup?.id ?? null, node);
    const label = funnelNodeLabel(payload.nodeType);
    if (!command || !commit(command)) { announce(`無法把${label}放在這個位置`); return; }
    select(payload.kind === "node" ? payload.nodeId : node!.id);
    announce(payload.kind === "node" ? `已移動${label}` : `已加入${label}`);
  }

  function stepHistory(direction: "undo" | "redo") {
    if (disabled) return;
    setInlineEdit(null);
    publishHistory(applyHistoryDirection(historyRef.current, direction));
  }

  function replaceDocument(next: PageDocument | null) {
    if (!next) return;
    commit({ type: "replace_document", document: next });
  }

  function inspect(id: string) {
    select(id);
    setLeftView("node");
    setCollapsed(false);
  }
  function deselect() {
    select(undefined);
    setLeftView("library");
  }

  /** Double-click, a click on the already selected node, or the toolbar's 編輯文字 starts inline editing. */
  function startInlineEdit(id: string, detail?: FunnelNodeSelectDetail): boolean {
    const node = findPath(activeRoot, id)?.at(-1);
    if (!node || disabled || previewing) return false;
    const itemIndex = node.type === "bulleted_list" ? detail?.itemIndex : undefined;
    if (!funnelInlineField(node.type, itemIndex)) return false;
    setSelectedId(id);
    setInlineEdit({ nodeId: id, itemIndex, caret: detail?.point });
    return true;
  }

  /**
   * The first click on a node always selects it and opens its settings, even
   * when it is already selected because it was just added from the library;
   * a further click on that node (settings open) starts inline editing.
   */
  function selectFromCanvas(id: string, detail?: FunnelNodeSelectDetail) {
    if (inlineEdit?.nodeId === id && inlineEdit.itemIndex === detail?.itemIndex) return;
    if (id === selectedId && leftView === "node" && startInlineEdit(id, detail)) return;
    inspect(id);
  }

  function inlineBinding(): FunnelInlineEditingBinding | undefined {
    if (!inlineEdit || previewing) return undefined;
    return {
      nodeId: inlineEdit.nodeId,
      itemIndex: inlineEdit.itemIndex,
      caret: inlineEdit.caret,
      onCommit: (value, context) => {
        const node = findPath(activeRoot, inlineEdit.nodeId)?.at(-1);
        const field = node ? funnelInlineField(node.type, inlineEdit.itemIndex) : null;
        setInlineEdit(null);
        if (!node || !field) return;
        const command = funnelInlineTextCommand({ node, field, viewport, previous: context.previous, value, items: context.items });
        if (command && commit(command)) announce(`已更新${funnelNodeLabel(node.type)}文字`);
      },
      onCancel: () => setInlineEdit(null),
    };
  }

  function removeSelected() {
    if (!selectedId || !selected) return;
    const label = funnelNodeLabel(selected.type);
    const removed = commit({ type: "delete", nodeId: selectedId });
    deselect();
    if (!removed) return;
    announce(`已刪除${label}，可按 Ctrl+Z 復原`);
    // The toolbar and settings that held focus are gone; keep keyboard users on the canvas.
    canvasRegion.current?.focus({ preventScroll: true });
  }
  function moveSelected(direction: "up" | "down") {
    if (!selected) return;
    if (commit({ type: direction === "up" ? "move_up" : "move_down", nodeId: selected.id })) announce(`已${direction === "up" ? "上移" : "下移"}${funnelNodeLabel(selected.type)}`);
  }
  /** The copy lands right after the original and becomes the selection; focus stays on the clicked button. */
  function duplicateSelected() {
    if (!selected || selectedIndex < 0) return;
    const label = funnelNodeLabel(selected.type);
    const copyId = nodeId(selected.type);
    if (commit({ type: "duplicate", nodeId: selected.id, newId: copyId, index: selectedIndex + 1 })) {
      select(copyId);
      announce(`已複製${label}，目前選取複本`);
    } else announce(`無法複製${label}，請確認 HTML ID 沒有重複`);
  }
  function selectParentNode() {
    if (selectedParent) inspect(selectedParent.id);
  }

  function toggleView(view: FunnelEditorView) {
    setCollapsed(false);
    setLeftView((current) => current === view ? (selected ? "node" : "library") : view);
  }
  function backToCanvasPanel() { setLeftView(selected ? "node" : "library"); }
  function editPopup(popupId: string) {
    select(undefined);
    setEditingPopupId(popupId || undefined);
    if (popupId) setLeftView("library");
  }

  function renderPanel() {
    if (leftView === "page") return <PageSettingsPanel document={history.present} disabled={disabled} commerceEnabled={commerceEnabled} commerceProducts={commerceProducts} workspaceSettings={chrome?.pageSettings} onCommand={commit} onReplace={replaceDocument} onBack={backToCanvasPanel} />;
    if (leftView === "popups") return <PopupsPanel document={history.present} disabled={disabled} editingPopupId={editingPopupId} onReplace={replaceDocument} onEdit={editPopup} onPreview={setPreviewPopupId} onBack={backToCanvasPanel} />;
    if (leftView === "versions" && chrome?.versions) return <div><PanelHeader title="版本紀錄" onBack={backToCanvasPanel} />{chrome.versions}</div>;
    if (leftView === "node" && selected && path) return <NodeSettingsPanel node={selected} path={path} disabled={disabled} viewport={viewport} popups={history.present.popups} stepIds={resolvedStepIds} stepNames={resolvedStepNames} onCommand={commit} onBack={deselect} onDuplicate={duplicateSelected} onDelete={removeSelected} />;
    return <EditorLibrary disabled={disabled} settings={history.present.settings} onAddElement={add} onAddBlock={addBlock} />;
  }
  function renderCanvas() {
    if (previewing && chrome?.renderPreview) return chrome.renderPreview(viewport);
    return <FunnelPageDocumentRenderer document={canvasDocument} commerce={commerceViewForBinding(canvasDocument.commerce, commerceProducts)} viewport={viewport} mode="editor" selectedNodeId={selectedId} onSelectNode={selectFromCanvas} inlineEditing={inlineBinding()} />;
  }
  function renderNodeToolbar() {
    if (!selected || previewing) return undefined;
    const node = selected;
    return <FunnelNodeToolbar label={funnelNodeLabel(node.type)} disabled={disabled}
      canMoveUp={selectedIndex > 0} canMoveDown={selectedIndex >= 0 && selectedIndex < siblings.length - 1} canSelectParent={Boolean(selectedParent)}
      actions={{
        onDragStart: (event) => { setInlineEdit(null); startNodeDrag(event, canvasContainer.current, node); },
        onDragEnd: endFunnelDrag,
        onMoveUp: () => moveSelected("up"),
        onMoveDown: () => moveSelected("down"),
        onDuplicate: duplicateSelected,
        onDelete: removeSelected,
        onSelectParent: selectParentNode,
        onEditText: isFunnelInlineEditable(node.type) ? () => { startInlineEdit(node.id, { itemIndex: 0 }); } : undefined,
      }} />;
  }

  const crumbs = path?.map((node) => ({ id: node.id, label: funnelNodeLabel(node.type) })) ?? [];
  const historyControls = { canUndo: !disabled && history.past.length > 0, canRedo: !disabled && history.future.length > 0, onUndo: () => stepHistory("undo"), onRedo: () => stepHistory("redo") };
  const toolbarView = leftView === "library" || leftView === "node" ? null : leftView;
  return <div data-funnel-page-editor className="flex h-full min-h-0 w-full flex-col bg-slate-100">
    <FunnelEditorToolbar chrome={chrome} history={historyControls} views={views} view={toolbarView} onToggleView={toggleView}
      crumbs={crumbs} context={editingPopup ? `彈出視窗：${editingPopup.name}` : undefined} onSelectCrumb={inspect}
      viewport={viewport} onViewport={setViewport} previewing={previewing} onTogglePreview={chrome?.renderPreview ? () => { setInlineEdit(null); setPreviewing((value) => !value); } : undefined} />
    {chrome?.notice}
    <div className="relative flex min-h-0 flex-1">
      {previewing ? null : <EditorSidePanel collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)}>{renderPanel()}</EditorSidePanel>}
      <EditorCanvas previewing={previewing} disabled={disabled} viewport={viewport} popupName={editingPopup?.name} root={activeRoot} selectedId={selectedId} layoutKey={layoutKey} toolbar={renderNodeToolbar()}
        regionRef={canvasRegion} containerRef={canvasContainer} onExitPopup={() => editPopup("")} onDeselect={deselect} onDrop={dropOnCanvas}>{renderCanvas()}</EditorCanvas>
    </div>
    <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
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
