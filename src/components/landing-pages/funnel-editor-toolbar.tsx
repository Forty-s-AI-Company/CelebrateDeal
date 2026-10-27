"use client";

import type { ComponentType } from "react";
import { ArrowLeft, BookmarkPlus, ChevronRight, Eye, History, Monitor, Pencil, Redo2, Settings, Smartphone, SquareStack, Undo2 } from "lucide-react";
import type { FunnelEditorChrome } from "./funnel-editor-chrome";
import type { FunnelViewport } from "./funnel-page-document-renderer";

export type FunnelEditorView = "page" | "popups" | "versions";
export type FunnelEditorCrumb = { id: string; label: string };

type IconComponent = ComponentType<{ size?: number; "aria-hidden"?: boolean; className?: string }>;

const iconButton = "inline-flex h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent aria-pressed:bg-blue-50 aria-pressed:text-blue-800";

function ToolbarButton({ label, icon: Icon, onClick, disabled, pressed, showLabel = false, labelClassName = "hidden xl:inline", className = "" }: { label: string; icon: IconComponent; onClick: () => void; disabled?: boolean; pressed?: boolean; showLabel?: boolean; labelClassName?: string; className?: string }) {
  return <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={`${iconButton} ${className}`}>
    <Icon size={18} aria-hidden />{showLabel ? <span className={labelClassName}>{label}</span> : null}
  </button>;
}

function saveLabel(state: FunnelEditorChrome["saveState"]) {
  if (state === "saving") return "儲存中…";
  return state === "dirty" ? "儲存" : "已儲存";
}

function saveAnnouncement(state: FunnelEditorChrome["saveState"]) {
  if (state === "saving") return "正在儲存";
  return state === "dirty" ? "有尚未儲存的變更" : "所有變更都已儲存";
}

function Breadcrumb({ crumbs, context, title, onSelect }: { crumbs: readonly FunnelEditorCrumb[]; context?: string; title: string; onSelect: (id: string) => void }) {
  if (!crumbs.length) return <p className="truncate text-center text-sm font-bold text-slate-900" title={context ?? title}>{context ?? title}</p>;
  return <nav aria-label="目前選取位置" className="flex min-w-0 justify-center">
    <ol className="flex min-w-0 items-center gap-1 overflow-hidden text-sm">
      {context ? <li className="hidden shrink-0 truncate font-semibold text-violet-700 lg:block">{context}<ChevronRight size={14} aria-hidden className="ml-1 inline text-slate-400" /></li> : null}
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return <li key={crumb.id} className={`flex min-w-0 items-center gap-1 ${current ? "" : "shrink"}`}>
          {index > 0 ? <ChevronRight size={14} aria-hidden className="shrink-0 text-slate-400" /> : null}
          <button type="button" aria-label={`選取${crumb.label}`} aria-current={current ? "location" : undefined} onClick={() => onSelect(crumb.id)} className={`min-h-8 truncate rounded px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${current ? "font-semibold text-blue-700" : "text-slate-500 hover:text-slate-900"}`}>{crumb.label}</button>
        </li>;
      })}
    </ol>
  </nav>;
}

/** EDT-TB-001: one fixed row — leave / history / popups / settings · breadcrumb · device / preview / save / exit. */
export function FunnelEditorToolbar({ chrome, history, views, view, onToggleView, crumbs, context, onSelectCrumb, viewport, onViewport, previewing, onTogglePreview }: {
  chrome?: FunnelEditorChrome;
  history?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
  views: readonly FunnelEditorView[];
  view: FunnelEditorView | null;
  onToggleView: (view: FunnelEditorView) => void;
  crumbs: readonly FunnelEditorCrumb[];
  context?: string;
  onSelectCrumb: (id: string) => void;
  viewport?: FunnelViewport;
  onViewport?: (viewport: FunnelViewport) => void;
  previewing: boolean;
  onTogglePreview?: () => void;
}) {
  const saveState = chrome?.saveState ?? "saved";
  return <header aria-label="編輯器工具列" className="relative z-40 flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 shadow-sm sm:gap-2 sm:px-3">
    <div className="flex shrink-0 items-center gap-0.5">
      {chrome ? <ToolbarButton label="返回管理頁" icon={ArrowLeft} onClick={chrome.onExit} className="max-sm:hidden" /> : null}
      {history ? <>
        <ToolbarButton label="復原" icon={Undo2} disabled={previewing || !history.canUndo} onClick={history.onUndo} />
        <ToolbarButton label="重做" icon={Redo2} disabled={previewing || !history.canRedo} onClick={history.onRedo} />
      </> : null}
      {views.length ? <span aria-hidden className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" /> : null}
      {views.includes("popups") ? <ToolbarButton label="彈出視窗" icon={SquareStack} showLabel pressed={view === "popups"} disabled={previewing} onClick={() => onToggleView("popups")} /> : null}
      {views.includes("page") ? <ToolbarButton label="頁面設定" icon={Settings} showLabel pressed={view === "page"} disabled={previewing} onClick={() => onToggleView("page")} /> : null}
      {views.includes("versions") ? <ToolbarButton label="版本紀錄" icon={History} showLabel labelClassName="hidden 2xl:inline" className="max-sm:hidden" pressed={view === "versions"} disabled={previewing} onClick={() => onToggleView("versions")} /> : null}
      {chrome?.onSaveAsTemplate ? <ToolbarButton label="存成範本" icon={BookmarkPlus} showLabel labelClassName="hidden 2xl:inline" disabled={previewing} onClick={chrome.onSaveAsTemplate} /> : null}
    </div>
    <div className="min-w-0 flex-1 px-1">
      {previewing ? <p className="truncate text-center text-sm font-bold text-slate-900">預覽模式：顯示目前編輯中的內容（含未儲存變更）</p> : <Breadcrumb crumbs={crumbs} context={context} title={chrome?.title ?? "編輯頁面"} onSelect={onSelectCrumb} />}
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {chrome?.status}
      {viewport && onViewport ? <div role="group" aria-label="編輯裝置" className="hidden items-center rounded-lg bg-slate-100 p-0.5 sm:flex">
        <ToolbarButton label="桌機" icon={Monitor} pressed={viewport === "desktop"} onClick={() => onViewport("desktop")} />
        <ToolbarButton label="手機" icon={Smartphone} pressed={viewport === "mobile"} onClick={() => onViewport("mobile")} />
      </div> : null}
      {onTogglePreview ? <ToolbarButton label={previewing ? "返回編輯" : "預覽"} icon={previewing ? Pencil : Eye} showLabel labelClassName="hidden md:inline" pressed={previewing} onClick={onTogglePreview} /> : null}
      {chrome ? <>
        <button type="button" disabled={saveState !== "dirty" || chrome.saveBlocked} onClick={chrome.onSave} title={chrome.saveBlocked && saveState === "dirty" ? "請先修正設定再儲存" : "儲存（Ctrl+S）"} className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-blue-700 px-2.5 sm:min-w-[4.5rem] sm:px-3 text-sm font-bold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:bg-blue-100 disabled:text-blue-800">{saveLabel(saveState)}</button>
        <button type="button" onClick={chrome.onExit} className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-slate-900 px-2.5 sm:px-3 text-sm font-bold text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">離開</button>
        <span role="status" className="sr-only">{saveAnnouncement(saveState)}</span>
      </> : null}
    </div>
  </header>;
}
