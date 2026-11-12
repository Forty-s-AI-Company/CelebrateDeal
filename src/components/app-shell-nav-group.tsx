"use client";

import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useId, useSyncExternalStore } from "react";
import { isNavPathActive } from "@/lib/nav-active";
import { parseNavGroupChoices, readNavGroupStorage, subscribeNavGroupStorage, writeNavGroupChoice } from "@/lib/nav-group-state";

const readServerSnapshot = () => null;

/**
 * A collapsible sidebar group. It starts at `defaultOpen` (derived from the
 * selected project's flow), follows the member's remembered choice once there
 * is one, and is always open while it holds the current page.
 */
export function AppShellNavGroup({
  label,
  hrefs,
  defaultOpen = true,
  children,
}: {
  label: string;
  hrefs: readonly string[];
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const panelId = useId();
  const containsActivePage = hrefs.some((href) => isNavPathActive(pathname, href));
  // The server and the first client render use null, so hydration always matches the default.
  const stored = useSyncExternalStore(subscribeNavGroupStorage, readNavGroupStorage, readServerSnapshot);
  const choice = parseNavGroupChoices(stored)[label];
  const isOpen = containsActivePage || (choice ?? defaultOpen);

  return (
    <section>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-disabled={containsActivePage ? true : undefined}
        title={containsActivePage ? "目前頁面在此群組內，維持展開" : undefined}
        onClick={() => { if (!containsActivePage) writeNavGroupChoice(label, !isOpen); }}
        className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${containsActivePage ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"}`}
      >
        {label}
        <ChevronDown className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!isOpen} className="mt-0.5 grid gap-0.5">
        {children}
      </div>
    </section>
  );
}
