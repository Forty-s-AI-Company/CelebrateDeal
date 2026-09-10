"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

export function AppShellNavGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-h-9 w-full items-center justify-between rounded-lg px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        {label}
        <ChevronDown className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <div hidden={!isOpen} className="mt-0.5 grid gap-0.5">
        {children}
      </div>
    </section>
  );
}
