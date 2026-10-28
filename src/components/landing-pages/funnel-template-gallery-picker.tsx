"use client";

import { useMemo, useState } from "react";
import type { FunnelViewport } from "./funnel-page-document-renderer";
import { FunnelTemplatePreviewDialog, FunnelTemplateThumbnail } from "./funnel-template-preview";
import { previewFunnelTemplate, type FunnelTemplateGalleryItem } from "@/lib/funnel-template-gallery";

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
  const documents = useMemo(() => new Map(templates.map((template) => [template.id, previewFunnelTemplate(template.id, `gallery_preview_${template.id}`)])), [templates]);
  const preview = templates.find((template) => template.id === previewId);

  if (templates.length === 0) return <div role="status" className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600"><strong className="block text-slate-900">這個 一頁式網站 類型還沒有可用模板</strong><span className="mt-1 block">你仍可從空白頁開始，之後再加入版型區塊。</span></div>;

  const apply = (templateId: string) => {
    setError(undefined);
    try { onApply(templateId); }
    catch { setError("模板目前無法套用，畫布內容沒有變更，請稍後再試。"); }
  };

  return <div className="grid gap-3" aria-busy={disabled}>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map((template) => {
        const selected = selectedId === template.id;
        const document = documents.get(template.id)!;
        return <article key={template.id} className={`min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm transition ${selected ? "border-blue-600 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}>
          <FunnelTemplateThumbnail document={document} />
          <button type="button" aria-pressed={selected} disabled={disabled} onClick={() => onSelect(template.id)} className="w-full min-w-0 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600">
            <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">{template.category}</span>
            <strong className="mt-1 block break-words text-sm text-slate-900">{template.name}</strong>
            <span className="mt-1 line-clamp-2 block break-words text-[11px] leading-4 text-slate-500">{template.description}</span>
          </button>
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-2">
            <button type="button" disabled={disabled} onClick={() => { setViewport("desktop"); setPreviewId(template.id); }} className="min-h-9 rounded-lg border border-slate-300 px-2 text-xs font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">完整預覽</button>
            <button type="button" disabled={disabled} onClick={() => apply(template.id)} className="min-h-9 rounded-lg bg-slate-900 px-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50">{disabled && selected ? "套用中…" : "套用模板"}</button>
          </div>
        </article>;
      })}
    </div>
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">{error}</p> : null}
    {preview ? <FunnelTemplatePreviewDialog eyebrow={preview.category} title={preview.name} document={documents.get(preview.id)!} viewport={viewport} onViewport={setViewport} onClose={() => setPreviewId(undefined)} actionLabel={disabled ? "套用中…" : "套用這個模板"} actionDisabled={disabled} onAction={() => apply(preview.id)} /> : null}
  </div>;
}
