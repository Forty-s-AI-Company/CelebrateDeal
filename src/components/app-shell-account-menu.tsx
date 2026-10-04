"use client";

import { ChevronUp, MoreHorizontal } from "lucide-react";
import { useState } from "react";

export function AppShellAccountMenu({
  vendorName,
  roleLabel,
  vendorInitial,
  planLabel,
  children,
}: {
  vendorName: string;
  roleLabel: string;
  vendorInitial: string;
  planLabel: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <div
        hidden={!isOpen}
        className="absolute bottom-[calc(100%+0.75rem)] left-0 right-0 max-h-[min(34rem,calc(100vh-8rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10"
        aria-label="工作區選單"
      >
        {children}
      </div>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label="開啟工作區與帳號選單"
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-h-14 w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white shadow-md shadow-blue-200">{vendorInitial}</span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-sm font-semibold text-slate-800">{vendorName}</span><span className="shrink-0 rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700">{planLabel}</span></span>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">{roleLabel}</span>
        </span>
        {isOpen ? <ChevronUp className="size-4 text-slate-400" aria-hidden="true" /> : <MoreHorizontal className="size-4 text-slate-400" aria-hidden="true" />}
      </button>
    </div>
  );
}
