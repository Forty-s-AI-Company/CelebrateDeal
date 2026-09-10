"use client";

import { ChevronUp, MoreHorizontal } from "lucide-react";
import { useState } from "react";

export function AppShellAccountMenu({
  vendorName,
  roleLabel,
  vendorInitial,
  children,
}: {
  vendorName: string;
  roleLabel: string;
  vendorInitial: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <div
        hidden={!isOpen}
        className="absolute bottom-[calc(100%+0.75rem)] left-0 right-0 max-h-[min(34rem,calc(100vh-8rem))] overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-2 shadow-2xl shadow-black/35"
        aria-label="工作區選單"
      >
        {children}
      </div>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label="開啟工作區與帳號選單"
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-h-14 w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.05] px-2.5 text-left transition-colors hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white shadow-md shadow-blue-950/40">{vendorInitial}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-100">{vendorName}</span>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">{roleLabel}</span>
        </span>
        {isOpen ? <ChevronUp className="size-4 text-slate-400" aria-hidden="true" /> : <MoreHorizontal className="size-4 text-slate-400" aria-hidden="true" />}
      </button>
    </div>
  );
}
