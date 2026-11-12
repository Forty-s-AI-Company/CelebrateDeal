"use client";

import { CornerDownLeft, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { trapDialogFocus } from "@/components/landing-pages/unsaved-changes-dialog";
import { searchPaletteEntries, type PaletteEntry } from "@/lib/command-palette";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

const subscribeNothing = () => () => {};
const readIsApplePlatform = () => /Mac|iPhone|iPad/u.test(navigator.platform);
const readServerPlatform = () => false;

/**
 * Page-navigation command palette (Ctrl+K / ⌘K). It only lists the entries it
 * is given, which the app shell derives from the same role- and
 * feature-filtered navigation data as the sidebar. WAI-ARIA combobox with a
 * listbox popup: focus stays in the input and the highlighted option is
 * exposed through aria-activedescendant. Mount a second instance with
 * `registerShortcut={false}` for the small-screen trigger so the key is only
 * handled once.
 */
export function CommandPalette(props: { entries: readonly PaletteEntry[]; variant?: "sidebar" | "icon"; registerShortcut?: boolean }) {
  // A member with no reachable page gets neither the trigger nor the shortcut.
  return props.entries.length > 0 ? <CommandPaletteInner {...props} /> : null;
}

function CommandPaletteInner({
  entries,
  variant = "sidebar",
  registerShortcut = true,
}: {
  entries: readonly PaletteEntry[];
  variant?: "sidebar" | "icon";
  registerShortcut?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isApple = useSyncExternalStore(subscribeNothing, readIsApplePlatform, readServerPlatform);
  const shortcutLabel = isApple ? "⌘K" : "Ctrl K";
  const dialogId = useId();

  useEffect(() => {
    if (!registerShortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [registerShortcut]);

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          aria-label="搜尋頁面"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          onClick={() => setOpen(true)}
          className="grid size-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          <Search className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-keyshortcuts="Control+K Meta+K"
          onClick={() => setOpen(true)}
          className="mb-3 flex min-h-10 w-full shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          <Search className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
          <span className="flex-1 text-left">搜尋頁面</span>
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-slate-600">{shortcutLabel}</kbd>
        </button>
      )}
      {open && typeof document !== "undefined" ? createPortal(<PaletteDialog id={dialogId} entries={entries} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}

function PaletteDialog({ id, entries, onClose }: { id: string; entries: readonly PaletteEntry[]; onClose: () => void }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => searchPaletteEntries(entries, query), [entries, query]);
  const active = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  // Declared before the focus effect: the hook records the trigger first.
  useDialogBehavior(true, onClose);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => { body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
    // optionId only depends on listId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function go(entry: PaletteEntry) {
    onClose();
    router.push(entry.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = active >= 0 ? results[active] : undefined;
      if (entry) go(entry);
    }
  }

  const statusText = results.length === 0 ? "找不到符合的頁面" : `${results.length} 個符合的頁面`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-950/50 px-4 pt-[10vh]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="快速前往頁面"
        onKeyDown={(event) => { if (panelRef.current) trapDialogFocus(panelRef.current, event.nativeEvent); }}
        className="flex max-h-[70dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3">
          <Search className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="搜尋頁面"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="輸入頁面名稱，例如「訂單」"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={onInputKeyDown}
            className="min-h-12 min-w-0 flex-1 bg-transparent text-sm text-slate-950 placeholder:text-slate-500 focus:outline-none"
          />
          <button type="button" onClick={onClose} aria-label="關閉搜尋" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p role="status" className={results.length === 0 ? "px-4 py-6 text-center text-sm text-slate-600" : "sr-only"}>{statusText}</p>
        <ul id={listId} role="listbox" aria-label="頁面" className="min-h-0 flex-1 overflow-y-auto p-2" hidden={results.length === 0}>
          {results.map((entry, index) => (
            <li
              key={entry.href}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => { if (index !== active) setActiveIndex(index); }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(entry)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${index === active ? "bg-blue-50 text-blue-700" : "text-slate-800"}`}
            >
              <span className="truncate font-medium">{entry.label}</span>
              <span className="shrink-0 text-xs text-slate-600">{entry.group}</span>
            </li>
          ))}
        </ul>
        <p className="hidden items-center gap-3 border-t border-slate-200 px-4 py-2 text-xs text-slate-600 sm:flex">
          <span>↑ ↓ 選擇</span>
          <span className="inline-flex items-center gap-1"><CornerDownLeft className="size-3" aria-hidden="true" />前往</span>
          <span>Esc 關閉</span>
        </p>
      </div>
    </div>
  );
}
