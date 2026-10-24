"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { LandingPagePublicationStatus } from "@/lib/landing-page-service";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

type Tone = "draft" | "live" | "warning" | "blocked";

/** Compact label derived only from the stored status and the server diagnosis. */
export function publicationChipState(published: boolean, publication?: LandingPagePublicationStatus): { label: string; tone: Tone } {
  if (!published) return { label: "草稿", tone: "draft" };
  if (publication && !publication.available) return { label: "公開網址無法開啟", tone: "blocked" };
  if (publication?.warnings?.length) return { label: "已發布・需注意", tone: "warning" };
  return { label: "已發布", tone: "live" };
}

const toneClass: Record<Tone, string> = {
  draft: "border-slate-300 bg-slate-50 text-slate-700",
  live: "border-emerald-300 bg-emerald-50 text-emerald-800",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  blocked: "border-amber-400 bg-amber-100 text-amber-950",
};
const dotClass: Record<Tone, string> = { draft: "bg-slate-400", live: "bg-emerald-500", warning: "bg-amber-500", blocked: "bg-amber-600" };

/**
 * Toolbar status chip (replaces the editor's publication banners). The popover
 * lists the existing diagnosis and points to the management page, where
 * publishing happens; `actions` is only used for pages without one.
 */
export function PublicationChip({ published, publication, slug, onManage, actions }: { published: boolean; publication?: LandingPagePublicationStatus; slug: string; onManage?: () => void; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useDialogBehavior(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  const state = publicationChipState(published, publication);
  return <div ref={root} className="relative">
    <button type="button" aria-expanded={open} aria-controls={id} aria-label={`發布狀態：${state.label}`} title="查看發布狀態" onClick={() => setOpen((value) => !value)} className={`inline-flex h-8 max-w-[11rem] cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${toneClass[state.tone]}`}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dotClass[state.tone]}`} /><span className="truncate max-sm:sr-only">{state.label}</span><ChevronDown size={14} aria-hidden className="shrink-0" />
    </button>
    {open ? <div id={id} role="region" aria-label="公開網址狀態" className="absolute top-10 right-0 z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-800 shadow-xl">
      <p className="font-bold text-slate-950">{published ? "這個網站已發布" : "目前是草稿"}</p>
      {publication ? <p className="mt-2 leading-6">{publication.message}</p> : null}
      {publication?.missing.length ? <ul aria-label="尚未完成" className="mt-2 list-disc space-y-1 pl-5">{publication.missing.map((item) => <li key={item.label}><a className="text-blue-700 underline" href={item.href}>{item.label}</a></li>)}</ul> : null}
      {publication?.warnings?.length ? <ul aria-label="需要注意" className="mt-2 list-disc space-y-1 pl-5 text-amber-900">{publication.warnings.map((item) => <li key={item.label}><a className="underline" href={item.href}>{item.label}</a></li>)}</ul> : null}
      <p className="mt-3 text-xs leading-5 text-slate-500">編輯器只儲存草稿；發布後訪客才會看到最新內容。</p>
      <div className="mt-3 grid gap-2">
        {publication && !publication.available ? <a className="font-semibold text-blue-700 underline" href={publication.projectHref}>前往專案檢查與發布</a> : null}
        {onManage ? <button type="button" className="cursor-pointer text-left font-semibold text-blue-700 underline" onClick={() => { setOpen(false); onManage(); }}>前往管理頁發布或管理網站</button> : null}
        {published && slug ? <a className="inline-flex items-center gap-1 font-semibold text-blue-700 underline" href={`/lp/${slug}`} target="_blank" rel="noreferrer">查看公開頁<ExternalLink size={14} aria-hidden /></a> : null}
        {actions}
      </div>
    </div> : null}
  </div>;
}
