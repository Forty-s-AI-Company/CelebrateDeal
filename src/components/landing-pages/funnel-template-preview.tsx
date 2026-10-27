"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FunnelPageDocumentRenderer, type FunnelViewport } from "./funnel-page-document-renderer";
import type { PageDocument } from "@/lib/funnel-page-document";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

/**
 * Template thumbnail and full preview shared by the step template picker
 * (「更換模板」) and the template library, so both show a template exactly the
 * way it renders once applied.
 */
export function FunnelTemplateThumbnail({ document, className = "m-2 mb-0 h-28" }: { document: PageDocument; className?: string }) {
  return <div aria-hidden="true" inert className={`pointer-events-none overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${className}`}>
    <div className="origin-top-left w-[400%] scale-25"><FunnelPageDocumentRenderer document={document} mode="preview" className="min-h-[28rem] bg-white" /></div>
  </div>;
}

export function FunnelTemplatePreviewDialog({ eyebrow, title, document, viewport, onViewport, onClose, actionLabel, onAction, actionDisabled = false, note = "預覽與套用共用相同的頁面內容與顯示方式。", details }: {
  eyebrow: string;
  title: string;
  document: PageDocument;
  viewport: FunnelViewport;
  onViewport: (viewport: FunnelViewport) => void;
  onClose: () => void;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  note?: string;
  details?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogBehavior(true, onClose);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const toggle = "min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 aria-pressed:border-blue-600 aria-pressed:bg-blue-50 aria-pressed:text-blue-800";
  return <div role="dialog" aria-modal="true" aria-labelledby="funnel-template-preview-title" className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/70 p-3 sm:p-6">
    <div className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div className="min-w-0"><span className="text-xs font-bold uppercase tracking-wide text-blue-700">{eyebrow}</span><h3 id="funnel-template-preview-title" className="break-words text-lg font-bold text-slate-950">{title}</h3>{details}</div>
        <div className="flex gap-2"><button type="button" aria-pressed={viewport === "desktop"} onClick={() => onViewport("desktop")} className={toggle}>電腦版</button><button type="button" aria-pressed={viewport === "mobile"} onClick={() => onViewport("mobile")} className={toggle}>手機版</button><button ref={closeRef} type="button" onClick={onClose} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">關閉</button></div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 sm:p-6"><div data-template-preview-viewport={viewport} className={`mx-auto min-w-0 overflow-x-hidden rounded-xl bg-white shadow-sm transition-[max-width] motion-reduce:transition-none ${viewport === "mobile" ? "max-w-[390px]" : "max-w-5xl"}`}><FunnelPageDocumentRenderer document={document} viewport={viewport} mode="preview" /></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4"><p className="text-xs leading-5 text-slate-600">{note}</p><button type="button" disabled={actionDisabled} onClick={onAction} className="min-h-10 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50">{actionLabel}</button></div>
    </div>
  </div>;
}
