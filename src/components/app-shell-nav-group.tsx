"use client";

import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { clsx } from "clsx";

export function AppShellNavGroup({
  label,
  hrefs,
  children,
}: {
  label: string;
  hrefs: readonly string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const containsActivePage = hrefs.some((href) => pathname === href || (href !== "/dashboard" && Boolean(pathname?.startsWith(`${href}/`))));
  const [isOpen, setIsOpen] = useState(containsActivePage);

  return (
    <section>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-h-9 w-full items-center justify-between rounded-lg px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
      >
        {label}
        <ChevronDown className={clsx("size-3.5 transition-transform duration-200", isOpen && "rotate-180")} aria-hidden="true" />
      </button>
      <div hidden={!isOpen} className="mt-0.5 grid gap-0.5">
        {children}
      </div>
    </section>
  );
}
