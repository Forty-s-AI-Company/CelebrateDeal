"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";
import { isNavPathActive } from "@/lib/nav-active";

export type MobileNavItem = { href: string; label: string; activePrefixes?: readonly string[] };
export type MobileNavGroup = { label: string; items: MobileNavItem[] };

/** F-122: 底部固定 4 個常用入口 + 「更多」抽屜，取代約 35–40 顆橫向膠囊。 */
const PRIMARY_PREFERENCE = ["/dashboard", "/lives", "/orders", "/customers", "/products", "/support-cases", "/settings"];

export function pickPrimaryItems(groups: MobileNavGroup[], limit = 4): MobileNavItem[] {
  const all = groups.flatMap((group) => group.items);
  const byHref = new Map(all.map((item) => [item.href, item]));
  const preferred = PRIMARY_PREFERENCE.flatMap((href) => (byHref.has(href) ? [byHref.get(href)!] : []));
  const picked = preferred.slice(0, limit);
  for (const item of all) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}

function isActive(pathname: string | null, item: MobileNavItem) {
  return isNavPathActive(pathname, item.href, item.activePrefixes);
}

export function AppShellMobileNav({ groups, supportLinks }: { groups: MobileNavGroup[]; supportLinks: MobileNavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const primary = pickPrimaryItems(groups);
  // False in server HTML and during hydration; true once React owns the page. Before that the
  // button drives a native popover (no JS needed); afterwards the React drawer takes over.
  const [hydrated, setHydrated] = useState(false);
  const preHydrationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const popover = preHydrationRef.current;
    // Browsers without the Popover API throw on the unknown pseudo-class; then nothing was opened.
    let wasOpen = false;
    try { wasOpen = Boolean(popover?.isConnected && popover.matches(":popover-open")); } catch { /* unsupported */ }
    if (wasOpen) { popover?.hidePopover(); setOpenedAt(pathname ?? ""); setOpen(true); }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks "React owns the page"; same pattern as command-palette
    setHydrated(true);
    // Runs once, at hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 路由改變（例如瀏覽器上一頁）時視為關閉，不需要在 effect 內 setState。
  const isOpen = open && openedAt === (pathname ?? "");
  useDialogBehavior(isOpen, close);
  useEffect(() => { if (isOpen) closeRef.current?.focus(); }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!drawerRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [isOpen]);

  const tabClass = "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold";

  return (
    <>
      <nav aria-label="行動版主要導覽" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_rgba(15,23,42,0.06)] lg:hidden">
        {primary.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`${tabClass} ${active ? "text-blue-700" : "text-slate-600"}`}>
              <span className="max-w-full truncate">{item.label}</span>
              {active ? <span className="h-0.5 w-6 rounded-full bg-blue-700" aria-hidden="true" /> : null}
            </Link>
          );
        })}
        <button type="button" aria-haspopup="dialog" aria-expanded={hydrated ? isOpen : undefined} aria-controls={drawerId} popoverTarget={hydrated ? undefined : drawerId} onClick={() => { if (!hydrated) return; setOpenedAt(pathname ?? ""); setOpen(true); }} className={`${tabClass} text-slate-600`}>
          <MoreHorizontal className="size-5" aria-hidden="true" />
          <span>更多</span>
        </button>
      </nav>
      {hydrated ? (isOpen ? (
        <div
          id={drawerId}
          role="dialog"
          aria-modal="true"
          aria-label="更多功能"
          className="fixed inset-0 z-50 bg-slate-950/50 lg:hidden"
          onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <div ref={drawerRef} className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <DrawerBody groups={groups} supportLinks={supportLinks} pathname={pathname} onNavigate={close} closeButton={
              <button ref={closeRef} type="button" onClick={close} aria-label="關閉更多功能" className={closeButtonClass}>
                <X className="size-5" aria-hidden="true" />
              </button>
            } />
          </div>
        </div>
      ) : null) : (
        // Server HTML only: a native popover the browser opens without JavaScript (Esc and
        // outside-click light dismiss included). Once React owns the page it is replaced by the dialog above.
        <div
          ref={preHydrationRef}
          id={drawerId}
          popover="auto"
          role="dialog"
          aria-label="更多功能"
          className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border-0 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 shadow-2xl backdrop:bg-slate-950/50 lg:hidden"
        >
          <DrawerBody groups={groups} supportLinks={supportLinks} pathname={pathname} closeButton={
            <button type="button" popoverTarget={drawerId} popoverTargetAction="hide" aria-label="關閉更多功能" className={closeButtonClass}>
              <X className="size-5" aria-hidden="true" />
            </button>
          } />
        </div>
      )}
    </>
  );
}

const closeButtonClass = "grid min-h-11 min-w-11 place-items-center rounded-lg text-slate-700 hover:bg-slate-100";

function DrawerBody({ groups, supportLinks, pathname, onNavigate, closeButton }: {
  groups: MobileNavGroup[];
  supportLinks: MobileNavItem[];
  pathname: string | null;
  onNavigate?: () => void;
  closeButton: ReactNode;
}) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-950">所有功能</h2>
        {closeButton}
      </div>
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="border-t border-slate-100 py-2 first:border-t-0">
          <p className="px-2 pb-1 text-xs font-semibold text-slate-600">{group.label}</p>
          <ul>
            {group.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={onNavigate} aria-current={isActive(pathname, item) ? "page" : undefined} className="flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-slate-800 hover:bg-slate-100 aria-[current=page]:bg-blue-50 aria-[current=page]:text-blue-700">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section aria-label="支援" className="border-t border-slate-100 py-2">
        <p className="px-2 pb-1 text-xs font-semibold text-slate-600">支援</p>
        <ul>
          {supportLinks.map((item) => (
            <li key={item.href}>
              <Link href={item.href} onClick={onNavigate} className="flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-slate-800 hover:bg-slate-100">{item.label}</Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
