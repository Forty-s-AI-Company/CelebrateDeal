"use client";

import { useMemo, useState } from "react";
import { FunnelPageDocumentRenderer, type FunnelViewport } from "./funnel-page-document-renderer";
import {
  createFunnelPageHistory,
  dispatchFunnelPageCommand,
  redoFunnelPageHistory,
  undoFunnelPageHistory,
  type FunnelPageCommand,
} from "@/lib/funnel-page-history";
import { getFunnelNodeDefinition, type FunnelNode, type FunnelNodeType, type PageDocument } from "@/lib/funnel-page-document";

type Props = { document: PageDocument; disabled?: boolean; onChange: (document: PageDocument) => void };

const palette: Array<{ type: FunnelNodeType; label: string }> = [
  { type: "section", label: "Section" }, { type: "row", label: "Row" },
  { type: "columns_2", label: "2 欄" }, { type: "columns_3", label: "3 欄" }, { type: "columns_4", label: "4 欄" },
  { type: "text", label: "文字" }, { type: "headline", label: "標題" }, { type: "image", label: "圖片" },
  { type: "button", label: "按鈕" }, { type: "bulleted_list", label: "項目清單" },
  { type: "content_box", label: "內容盒" }, { type: "horizontal_line", label: "水平線" },
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

export function FunnelPageEditor({ document, disabled = false, onChange }: Props) {
  const [history, setHistory] = useState(() => createFunnelPageHistory(document));
  const [selectedId, setSelectedId] = useState<string>();
  const [viewport, setViewport] = useState<FunnelViewport>("desktop");
  const [panel, setPanel] = useState<"elements" | "settings">("elements");

  const path = useMemo(() => selectedId ? findPath(history.present.root, selectedId) : null, [history.present.root, selectedId]);
  const selected = path?.at(-1);

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
    const parentId = type === "section" ? null : selectedParent ?? findFirstAccepting(history.present.root, type);
    commit({ type: "add", node, parentId });
    setSelectedId(node.id);
  }

  function stepHistory(direction: "undo" | "redo") {
    setHistory((current) => {
      const next = direction === "undo" ? undoFunnelPageHistory(current) : redoFunnelPageHistory(current);
      if (next !== current) onChange(next.present);
      return next;
    });
  }

  function updateContent(value: string) {
    if (!selected) return;
    const key = selected.type === "button" ? "label" : selected.type === "image" ? "src" : "text";
    commit({ type: "update", nodeId: selected.id, patch: { props: { [key]: value } } });
  }

  const control = "min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40";
  return <section className="grid min-h-[calc(100dvh-10rem)] grid-cols-[18rem_minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="grid grid-cols-2 border-b border-slate-200 p-2">
        <button className={`${control} ${panel === "elements" ? "border-blue-600 text-blue-700" : ""}`} onClick={() => setPanel("elements")}>Elements</button>
        <button className={`${control} ${panel === "settings" ? "border-blue-600 text-blue-700" : ""}`} onClick={() => setPanel("settings")}>設定</button>
      </div>
      <div className="flex items-center gap-2 border-b border-slate-200 p-2">
        <button className={control} disabled={!history.past.length} onClick={() => stepHistory("undo")}>Undo</button>
        <button className={control} disabled={!history.future.length} onClick={() => stepHistory("redo")}>Redo</button>
        <button className={control} onClick={() => setViewport(viewport === "desktop" ? "mobile" : "desktop")}>{viewport === "desktop" ? "桌機" : "手機"}</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {panel === "elements" ? <div className="grid grid-cols-2 gap-2">{palette.map((item) => <button key={item.type} disabled={disabled} className="min-h-16 rounded-xl border border-slate-200 bg-white p-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-blue-400 hover:text-blue-700 disabled:opacity-40" onClick={() => add(item.type)}>{item.label}</button>)}</div> : selected ? <div className="grid gap-4">
          <div><p className="text-xs font-bold text-slate-500">Breadcrumb</p><p className="mt-1 text-sm text-slate-700">{path?.map((item) => getFunnelNodeDefinition(item.type).label).join(" › ")}</p></div>
          {["text", "headline", "button", "image"].includes(selected.type) ? <label className="grid gap-1 text-sm font-semibold">內容<input className={control} value={String(selected.props[selected.type === "button" ? "label" : selected.type === "image" ? "src" : "text"] ?? "")} onChange={(event) => updateContent(event.currentTarget.value)} /></label> : null}
          <label className="grid gap-1 text-sm font-semibold">桌機字級<input className={control} type="number" value={selected.overrides.desktop?.style?.fontSize ?? selected.style.fontSize ?? 16} onChange={(event) => commit({ type: "update", nodeId: selected.id, patch: { overrides: { desktop: { style: { fontSize: Number(event.currentTarget.value) } } } } })} /></label>
          <label className="grid gap-1 text-sm font-semibold">手機字級<input className={control} type="number" value={selected.overrides.mobile?.style?.fontSize ?? selected.style.fontSize ?? 16} onChange={(event) => commit({ type: "update", nodeId: selected.id, patch: { overrides: { mobile: { style: { fontSize: Number(event.currentTarget.value) } } } } })} /></label>
          <div className="grid grid-cols-2 gap-2"><button className={control} onClick={() => commit({ type: "move_up", nodeId: selected.id })}>上移</button><button className={control} onClick={() => commit({ type: "move_down", nodeId: selected.id })}>下移</button><button className={control} onClick={() => commit({ type: "duplicate", nodeId: selected.id })}>複製</button><button className={`${control} text-red-700`} onClick={() => { commit({ type: "delete", nodeId: selected.id }); setSelectedId(undefined); }}>刪除</button></div>
        </div> : <p className="text-sm text-slate-500">請先在畫布選取節點。</p>}
      </div>
    </aside>
    <div className="min-h-0 overflow-auto bg-slate-200/70 p-5">
      <div className={`mx-auto min-h-full bg-white shadow-xl transition-[width] ${viewport === "mobile" ? "w-[375px] max-w-full rounded-[2rem] border-[10px] border-slate-900" : "w-full max-w-[1440px]"}`}>
        <FunnelPageDocumentRenderer document={history.present} viewport={viewport} mode="editor" selectedNodeId={selectedId} onSelectNode={(id) => { setSelectedId(id); setPanel("settings"); }} />
      </div>
    </div>
  </section>;
}
