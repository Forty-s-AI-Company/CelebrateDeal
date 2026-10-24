"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from "react";
import { ArrowDown, ArrowUp, ArrowUpLeft, Copy, GripVertical, Trash2, Type } from "lucide-react";
import type { FunnelViewport } from "./funnel-page-document-renderer";
import { beginFunnelDrag, currentFunnelDrag, endFunnelDrag } from "./funnel-editor-drag";
import { funnelNodeLabel } from "./funnel-editor-library";
import {
  funnelDropIndicatorGeometry,
  placeFunnelNodeToolbar,
  resolveFunnelDrop,
  resolveFunnelEndDrop,
  type FunnelDragPayload,
  type FunnelDropAxis,
  type FunnelDropTarget,
  type FunnelIndicatorGeometry,
  type FunnelRect,
  type FunnelToolbarPlacement,
} from "@/lib/funnel-editor-canvas";
import type { FunnelNode, FunnelNodeType } from "@/lib/funnel-page-document";

const NODE_SELECTOR = "[data-funnel-node-id]";

function nodeElement(container: HTMLElement, id: string): HTMLElement | null {
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id;
  return container.querySelector<HTMLElement>(`[data-funnel-node-id="${escaped}"]`);
}

function clientRect(element: Element): FunnelRect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Rect in the container's own (scrolling) coordinates, so overlays need no scroll math. */
function localRect(container: HTMLElement, element: Element): FunnelRect {
  const base = container.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return { left: rect.left - base.left, top: rect.top - base.top, width: rect.width, height: rect.height };
}

function axisOf(container: HTMLElement, id: string): FunnelDropAxis {
  const parent = nodeElement(container, id)?.parentElement?.closest(NODE_SELECTOR);
  return parent?.getAttribute("data-funnel-axis") === "horizontal" ? "horizontal" : "vertical";
}

function closestNodeId(container: HTMLElement | null, target: EventTarget | null): string | null {
  const element = target as Element | null;
  if (!container || typeof element?.closest !== "function") return null;
  const node = element.closest(NODE_SELECTOR);
  return node && container.contains(node) ? node.getAttribute("data-funnel-node-id") : null;
}

const sameRect = (a: FunnelRect | null | undefined, b: FunnelRect | null | undefined) => a === b || Boolean(a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

export type CanvasOverlayHandle = { setHover: (id: string | null) => void; setDrop: (target: FunnelDropTarget | null) => void };

type OverlayState = {
  hover: { rect: FunnelRect; label: string } | null;
  selected: FunnelRect | null;
  toolbar: FunnelToolbarPlacement | null;
  drop: FunnelIndicatorGeometry | null;
};

/**
 * Hover outline, selection outline, floating toolbar and drop indicator,
 * drawn above the rendered page. Pointer moves only touch this component's
 * state (coalesced per animation frame); the document tree never re-renders.
 */
function CanvasOverlay({ handleRef, containerRef, scrollRef, selectedId, layoutKey, toolbar }: { handleRef: Ref<CanvasOverlayHandle>; containerRef: RefObject<HTMLDivElement | null>; scrollRef: RefObject<HTMLDivElement | null>; selectedId?: string; layoutKey: unknown; toolbar: ReactNode }) {
  const [state, setState] = useState<OverlayState>({ hover: null, selected: null, toolbar: null, drop: null });
  const hoverId = useRef<string | null>(null);
  const dropTarget = useRef<FunnelDropTarget | null>(null);
  const selected = useRef(selectedId);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);

  const compute = useCallback(() => {
    frame.current = null;
    const container = containerRef.current;
    if (!container) return;
    const selectedElement = selected.current ? nodeElement(container, selected.current) : null;
    const selectedRect = selectedElement ? localRect(container, selectedElement) : null;
    const hoverElement = hoverId.current && hoverId.current !== selected.current ? nodeElement(container, hoverId.current) : null;
    const hoverType = hoverElement?.getAttribute("data-funnel-node-type") as FunnelNodeType | null;
    const hover = hoverElement && hoverType ? { rect: localRect(container, hoverElement), label: funnelNodeLabel(hoverType) } : null;
    let toolbarPlacement: FunnelToolbarPlacement | null = null;
    if (selectedRect) {
      const scroller = scrollRef.current;
      const base = container.getBoundingClientRect();
      const view = scroller?.getBoundingClientRect() ?? base;
      const left = Math.max(view.left, base.left);
      const visible = { left: left - base.left, top: view.top - base.top, width: Math.max(0, Math.min(view.right, base.right) - left), height: view.height };
      const size = { width: toolbarRef.current?.offsetWidth || 240, height: toolbarRef.current?.offsetHeight || 34 };
      toolbarPlacement = placeFunnelNodeToolbar(selectedRect, visible, size);
    }
    let drop: FunnelIndicatorGeometry | null = null;
    const target = dropTarget.current;
    if (target) {
      const anchor = target.anchorId ? nodeElement(container, target.anchorId) : container.querySelector("[data-funnel-renderer]");
      if (anchor) drop = funnelDropIndicatorGeometry(target, localRect(container, anchor));
    }
    setState((current) => {
      const unchanged = sameRect(current.selected, selectedRect) && sameRect(current.hover?.rect, hover?.rect) && current.hover?.label === hover?.label
        && current.toolbar?.left === toolbarPlacement?.left && current.toolbar?.top === toolbarPlacement?.top
        && current.drop?.kind === drop?.kind && sameRect(current.drop, drop);
      return unchanged ? current : { hover, selected: selectedRect, toolbar: toolbarPlacement, drop };
    });
  }, [containerRef, scrollRef]);

  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    if (typeof window.requestAnimationFrame !== "function") { compute(); return; }
    frame.current = window.requestAnimationFrame(compute);
  }, [compute]);

  useImperativeHandle(handleRef, () => ({
    setHover: (id) => { if (hoverId.current !== id) { hoverId.current = id; schedule(); } },
    setDrop: (target) => { dropTarget.current = target; schedule(); },
  }), [schedule]);

  // Selection and document changes are measured before paint, so the toolbar never flashes in the corner.
  useLayoutEffect(() => {
    selected.current = selectedId;
    compute();
  }, [selectedId, layoutKey, compute]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const container = containerRef.current;
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "function" && container ? new ResizeObserver(schedule) : null;
    if (observer && container) observer.observe(container);
    return () => {
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame.current !== null) window.cancelAnimationFrame?.(frame.current);
      frame.current = null;
    };
  }, [containerRef, scrollRef, schedule]);

  const box = (rect: FunnelRect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  return <div data-funnel-canvas-chrome className="pointer-events-none absolute inset-0 z-20">
    {state.hover ? <div aria-hidden className="absolute rounded-sm outline outline-1 outline-blue-400" style={box(state.hover.rect)}>
      <span className="absolute -top-5 left-0 rounded-t bg-blue-400 px-1.5 text-[11px] leading-5 font-semibold whitespace-nowrap text-white">{state.hover.label}</span>
    </div> : null}
    {state.selected ? <div aria-hidden className="absolute rounded-sm outline outline-2 outline-blue-600" style={box(state.selected)} /> : null}
    {state.drop ? <div aria-hidden data-funnel-drop-indicator={state.drop.kind} className={state.drop.kind === "line" ? "absolute rounded-full bg-blue-600 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]" : "absolute rounded-md border-2 border-dashed border-blue-500 bg-blue-500/10"} style={box(state.drop)} /> : null}
    {toolbar && selectedId ? <div ref={toolbarRef} className="pointer-events-auto absolute" style={state.toolbar ? { left: state.toolbar.left, top: state.toolbar.top } : { left: 0, top: 0, visibility: "hidden" }}>{toolbar}</div> : null}
  </div>;
}

const toolButton = "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

export type FunnelNodeToolbarActions = {
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSelectParent: () => void;
  onEditText?: () => void;
};

/** Mini toolbar attached to the selected node (EDT-INT-001); arrow keys move between its buttons. */
export function FunnelNodeToolbar({ label, canMoveUp, canMoveDown, canSelectParent, disabled, actions }: { label: string; canMoveUp: boolean; canMoveDown: boolean; canSelectParent: boolean; disabled: boolean; actions: FunnelNodeToolbarActions }) {
  function rove(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  }
  return <div role="toolbar" aria-label={`${label}工具`} data-funnel-node-toolbar onKeyDown={rove} onClick={(event) => event.stopPropagation()} className="flex items-center gap-0.5 rounded-lg bg-blue-600 p-0.5 text-white shadow-lg">
    <span className="px-1.5 text-xs font-semibold whitespace-nowrap">{label}</span>
    <button type="button" draggable={!disabled} disabled={disabled} aria-label={`拖曳移動${label}`} title="拖曳以移動位置；也可以用上移、下移" onDragStart={actions.onDragStart} onDragEnd={actions.onDragEnd} className={`${toolButton} cursor-grab active:cursor-grabbing`}><GripVertical size={15} aria-hidden /></button>
    {actions.onEditText ? <button type="button" disabled={disabled} aria-label={`編輯${label}文字`} title="編輯文字（也可以在畫布上點兩下）" onClick={actions.onEditText} className={toolButton}><Type size={15} aria-hidden /></button> : null}
    <button type="button" disabled={disabled || !canMoveUp} aria-label={`上移${label}`} title="上移" onClick={actions.onMoveUp} className={toolButton}><ArrowUp size={15} aria-hidden /></button>
    <button type="button" disabled={disabled || !canMoveDown} aria-label={`下移${label}`} title="下移" onClick={actions.onMoveDown} className={toolButton}><ArrowDown size={15} aria-hidden /></button>
    <button type="button" disabled={disabled} aria-label={`複製${label}`} title="複製" onClick={actions.onDuplicate} className={toolButton}><Copy size={15} aria-hidden /></button>
    <button type="button" disabled={!canSelectParent} aria-label="選取上層" title="選取上層" onClick={actions.onSelectParent} className={toolButton}><ArrowUpLeft size={15} aria-hidden /></button>
    <button type="button" disabled={disabled} aria-label={`刪除${label}`} title="刪除（Delete）" onClick={actions.onDelete} className={`${toolButton} hover:bg-red-500`}><Trash2 size={15} aria-hidden /></button>
  </div>;
}

type EditorCanvasProps = {
  previewing: boolean;
  disabled: boolean;
  viewport: FunnelViewport;
  popupName?: string;
  root: readonly FunnelNode[];
  selectedId?: string;
  layoutKey: unknown;
  toolbar?: ReactNode;
  regionRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  onExitPopup: () => void;
  onDeselect: () => void;
  onDrop: (target: FunnelDropTarget, payload: FunnelDragPayload) => void;
  children: ReactNode;
};

/** Scrollable canvas with hover tracking and drag-and-drop insertion (EDT-INT-002). */
export function EditorCanvas({ previewing, disabled, viewport, popupName, root, selectedId, layoutKey, toolbar, regionRef, containerRef, onExitPopup, onDeselect, onDrop, children }: EditorCanvasProps) {
  const overlay = useRef<CanvasOverlayHandle>(null);
  const lastDrag = useRef<{ x: number; y: number; target: EventTarget | null; result: FunnelDropTarget | null } | null>(null);
  const interactive = !previewing;

  const clearDrag = useCallback(() => {
    lastDrag.current = null;
    overlay.current?.setDrop(null);
  }, []);

  useEffect(() => {
    // A cancelled drag (Esc, dropped outside) still ends here.
    const end = () => { clearDrag(); endFunnelDrag(); };
    window.addEventListener("dragend", end);
    window.addEventListener("drop", clearDrag);
    return () => { window.removeEventListener("dragend", end); window.removeEventListener("drop", clearDrag); };
  }, [clearDrag]);

  function resolve(event: DragEvent<HTMLDivElement>, payload: FunnelDragPayload): FunnelDropTarget | null {
    const container = containerRef.current;
    if (!container) return null;
    const element = event.target as Element | null;
    if (typeof element?.closest === "function" && element.closest("[data-funnel-canvas-chrome]")) return null;
    const hoveredId = closestNodeId(container, event.target);
    if (!hoveredId) return resolveFunnelEndDrop(root, payload);
    return resolveFunnelDrop({
      root, payload, hoveredId, point: { x: event.clientX, y: event.clientY },
      measure: (id) => { const node = nodeElement(container, id); return node ? clientRect(node) : null; },
      axisOf: (id) => axisOf(container, id),
    });
  }

  function dragPayload(event: DragEvent<HTMLDivElement>) {
    if (!interactive || disabled) return null;
    return currentFunnelDrag(Array.from(event.dataTransfer.types));
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    const payload = dragPayload(event);
    if (!payload) return;
    const cached = lastDrag.current;
    const reuse = cached && cached.target === event.target && Math.abs(cached.x - event.clientX) < 3 && Math.abs(cached.y - event.clientY) < 3;
    const result = reuse ? cached.result : resolve(event, payload);
    if (!reuse) lastDrag.current = { x: event.clientX, y: event.clientY, target: event.target, result };
    overlay.current?.setDrop(result);
    if (!result) { event.dataTransfer.dropEffect = "none"; return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = payload.kind === "node" ? "move" : "copy";
  }

  function onDropEvent(event: DragEvent<HTMLDivElement>) {
    const payload = dragPayload(event);
    clearDrag();
    if (!payload) return;
    const target = resolve(event, payload);
    endFunnelDrag();
    if (!target) return;
    event.preventDefault();
    onDrop(target, payload);
  }

  return <div ref={regionRef} tabIndex={-1} role="region" aria-label={previewing ? "預覽畫面" : "編輯畫布"} className="min-w-0 flex-1 overflow-auto px-4 py-5 outline-none lg:px-8"
    onClick={(event) => { if (interactive && event.target === event.currentTarget) onDeselect(); }}
    onClickCapture={(event) => {
      // Links on the canvas select their node instead of navigating away from unsaved work.
      const element = event.target as Element | null;
      if (interactive && typeof element?.closest === "function" && element.closest("a[href]") && containerRef.current?.contains(element)) event.preventDefault();
    }}
    onPointerMove={(event) => { if (interactive && event.pointerType !== "touch") overlay.current?.setHover(closestNodeId(containerRef.current, event.target)); }}
    onPointerLeave={() => overlay.current?.setHover(null)}
    onDragOver={onDragOver}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDrag(); }}
    onDrop={onDropEvent}>
    {popupName && !previewing ? <div className="mx-auto mb-3 flex max-w-[1440px] items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm"><span className="font-semibold text-violet-900">正在編輯彈出視窗：{popupName}</span><button type="button" className="min-h-9 cursor-pointer rounded-lg border border-violet-300 bg-white px-3 text-sm font-semibold text-violet-800 hover:bg-violet-100" onClick={onExitPopup}>返回頁面畫布</button></div> : null}
    <div ref={containerRef} className="relative mx-auto min-h-full" onClick={(event) => { if (interactive && event.target === event.currentTarget) onDeselect(); }}>
      <div className={`mx-auto min-h-full bg-white shadow-xl ${viewport === "mobile" ? "w-[375px] max-w-full overflow-hidden rounded-[2rem] border-[10px] border-slate-900" : "w-full max-w-[1440px]"}`}>{children}</div>
      {interactive ? <CanvasOverlay handleRef={overlay} containerRef={containerRef} scrollRef={regionRef} selectedId={selectedId} layoutKey={layoutKey} toolbar={toolbar} /> : null}
    </div>
  </div>;
}

/** Drag handle start: the payload is the existing node, the drag image the node itself. */
export function startNodeDrag(event: DragEvent<HTMLButtonElement>, container: HTMLElement | null, node: Pick<FunnelNode, "id" | "type">) {
  beginFunnelDrag(event, { kind: "node", nodeId: node.id, nodeType: node.type });
  const element = container ? nodeElement(container, node.id) : null;
  if (element && typeof event.dataTransfer.setDragImage === "function") event.dataTransfer.setDragImage(element, 16, 16);
}
