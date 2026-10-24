"use client";

import { useEffect, useRef } from "react";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Keeps Tab / Shift+Tab inside an open modal. */
export function trapDialogFocus(container: HTMLElement, event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));
  if (!focusable.length) { event.preventDefault(); return; }
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  const active = container.ownerDocument.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !container.contains(active))) { event.preventDefault(); first.focus(); }
}

/**
 * EDT-SAVE-001 exit guard: an in-app modal (not window.confirm) asking whether
 * to save before leaving. Escape and 取消 keep editing; focus returns to the
 * control that opened it.
 */
export function UnsavedChangesDialog({ saving, saveBlocked, onDiscard, onSave, onCancel }: { saving: boolean; saveBlocked?: boolean; onDiscard: () => void; onSave: () => void; onCancel: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  useDialogBehavior(true, () => { if (!saving) onCancel(); });
  useEffect(() => {
    (primary.current?.disabled ? panel.current?.querySelector<HTMLElement>(focusableSelector) : primary.current)?.focus();
  }, []);
  return <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="unsaved-changes-title" aria-describedby="unsaved-changes-description" className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl" onKeyDown={(event) => { if (panel.current) trapDialogFocus(panel.current, event); }}>
      <h2 id="unsaved-changes-title" className="text-lg font-bold text-slate-950">這個頁面尚未儲存，要先儲存嗎？</h2>
      <p id="unsaved-changes-description" className="mt-2 text-sm leading-6 text-slate-600">選擇「不儲存離開」會捨棄這次編輯後尚未儲存的變更。</p>
      {saveBlocked ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">目前的設定還不完整，無法儲存；請先取消並修正設定。</p> : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" disabled={saving} onClick={onDiscard} className="min-h-10 cursor-pointer rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50">不儲存離開</button>
        <button ref={primary} type="button" disabled={saving || saveBlocked} onClick={onSave} className="min-h-10 cursor-pointer rounded-lg bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "儲存中…" : "儲存後離開"}</button>
        <button type="button" disabled={saving} onClick={onCancel} className="min-h-10 cursor-pointer rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50">取消</button>
      </div>
    </div>
  </div>;
}
