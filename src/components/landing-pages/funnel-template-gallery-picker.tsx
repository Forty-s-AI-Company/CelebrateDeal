"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FunnelPageDocumentRenderer, type FunnelViewport } from "./funnel-page-document-renderer";
import { instantiateFunnelTemplate, type FunnelTemplateGalleryItem } from "@/lib/funnel-template-gallery";

type Props = {
  templates: readonly FunnelTemplateGalleryItem[];
  selectedId: string;
  disabled?: boolean;
  onSelect: (templateId: string) => void;
  onApply: (templateId: string) => void;
};

export function FunnelTemplateGalleryPicker({ templates, selectedId, disabled = false, onSelect, onApply }: Props) {
  const [previewId, setPreviewId] = useState<string>();
  const [viewport, setViewport] = useState<FunnelViewport>("desktop");
  const [error, setError] = useState<string>();
  const [isApplying, startApplying] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);
  const documents = useMemo(() => new Map(templates.map((template) => [template.id, instantiateFunnelTemplate(template.id, `gallery_preview_${template.id}`)])), [templates]);
  const preview = templates.find((template) => template.id === previewId);

  useEffect(() => {
    if (!preview) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewId(undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview]);

  if (templates.length === 0) return <div role="status" className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600"><strong className="block text-slate-900">這個 Funnel 類型還沒有可用模板</strong><span className="mt-1 block">你仍可從空白頁開始，之後再加入 Blocks。</span></div>;

  const apply = (templateId: string) => {
    setError(undefined);
    startApplying(() => {
      try { onApply(templateId); }
      catch { setError("模板目前無法套用，畫布內容沒有變更，請稍後再試。"); }
    });
  };

  return <div className="grid gap-3" aria-busy={isApplying}>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
      {templates.map((template) => {
        const selected = selectedId === template.id;
        const document = documents.get(template.id)!;
        return <article key={template.id} className={`min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm transition ${selected ? "border-blue-600 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}>
          <button type="button" aria-pressed={selected} disabled={disabled || isApplying} onClick={() => onSelect(template.id)} className="w-full min-w-0 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600">
            <div aria-hidden="true" className="pointer-events-none h-28 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <div className="origin-top-left w-[400%] scale-25"><FunnelPageDocumentRenderer document={document} mode="preview" className="min-h-[28rem] bg-white" /></div>
            </div>
            <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">{template.category}</span>
            <strong className="mt-1 block break-words text-sm text-slate-900">{template.name}</strong>
            <span className="mt-1 line-clamp-2 block break-words text-[11px] leading-4 text-slate-500">{template.description}</span>
          </button>
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-2">
            <button type="button" disabled={disabled || isApplying} onClick={() => { setViewport("desktop"); setPreviewId(template.id); }} className="min-h-9 rounded-lg border border-slate-300 px-2 text-xs font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">完整預覽</button>
            <button type="button" disabled={disabled || isApplying} onClick={() => apply(template.id)} className="min-h-9 rounded-lg bg-slate-900 px-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50">{isApplying && selected ? "套用中…" : "套用模板"}</button>
          </div>
        </article>;
      })}
    </div>
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">{error}</p> : null}
    {preview ? <div role="dialog" aria-modal="true" aria-labelledby="funnel-template-preview-title" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-3 sm:p-6">
      <div className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0"><span className="text-xs font-bold uppercase tracking-wide text-blue-700">{preview.category}</span><h3 id="funnel-template-preview-title" className="break-words text-lg font-bold text-slate-950">{preview.name}</h3></div>
          <div className="flex gap-2"><button type="button" aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">電腦版</button><button type="button" aria-pressed={viewport === "mobile"} onClick={() => setViewport("mobile")} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">手機版</button><button ref={closeRef} type="button" onClick={() => setPreviewId(undefined)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">關閉</button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 sm:p-6"><div data-template-preview-viewport={viewport} className={`mx-auto min-w-0 overflow-x-hidden rounded-xl bg-white shadow-sm transition-[max-width] ${viewport === "mobile" ? "max-w-[390px]" : "max-w-5xl"}`}><FunnelPageDocumentRenderer document={documents.get(preview.id)!} viewport={viewport} mode="preview" /></div></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4"><p className="text-xs leading-5 text-slate-600">預覽與套用共用同一份 PageDocument 與 renderer。</p><button type="button" disabled={disabled || isApplying} onClick={() => apply(preview.id)} className="min-h-10 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50">{isApplying ? "套用中…" : "套用這個模板"}</button></div>
      </div>
    </div> : null}
  </div>;
}
