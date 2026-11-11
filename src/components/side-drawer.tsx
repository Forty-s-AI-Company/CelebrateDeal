"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { trapDialogFocus } from "@/components/landing-pages/unsaved-changes-dialog";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * React events bubble through the component tree, not the DOM, so an event
 * inside a portal still reaches the handlers of the component that rendered
 * it — for a drawer opened from a form, that form's onChange／onSubmit／
 * onInvalid. Stop them at the drawer root.
 */
function stopReactPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * A modal side drawer: rendered into <body> through a portal, slides in from
 * the right on wide screens and fills the screen on phones. Escape, the
 * backdrop and the close button close it unless `busy`; Tab stays inside;
 * focus moves to `initialFocusRef` (or the first control) and returns to the
 * trigger on close; the page behind does not scroll. Mount it only while it
 * is open.
 */
export function SideDrawer({
  title,
  description,
  busy = false,
  onClose,
  initialFocusRef,
  children,
  footer,
}: {
  title: string;
  description?: string;
  busy?: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; });
  const requestClose = () => { if (!busyRef.current) onClose(); };
  // Declared before the focus effect: the hook records the trigger first.
  useDialogBehavior(true, requestClose);
  useEffect(() => {
    const target = initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(focusableSelector) ?? panelRef.current;
    target?.focus();
    // Only when the drawer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // While busy every control is disabled and the browser may drop focus to
  // <body>; park it on the panel so Tab stays in the dialog and screen readers
  // keep their place.
  useEffect(() => {
    if (!busy) return;
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    const onFocusableControl = active instanceof HTMLElement && active !== panel && panel.contains(active) && active.matches(focusableSelector);
    if (!onFocusableControl) panel.focus();
  }, [busy]);
  // Focus on <body> (or anywhere outside the drawer) never reaches the
  // drawer's own key handler; keep Tab inside from the document.
  useEffect(() => {
    const trapOutsideTab = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (event.key !== "Tab" || !panel || rootRef.current?.contains(event.target as Node)) return;
      trapDialogFocus(panel, event);
    };
    document.addEventListener("keydown", trapOutsideTab);
    return () => document.removeEventListener("keydown", trapOutsideTab);
  }, []);
  useEffect(() => {
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => { body.style.overflow = previousOverflow; };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={rootRef}
      data-side-drawer="true"
      className="fixed inset-0 z-[150] flex justify-end bg-slate-950/50"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) requestClose();
      }}
      onClick={stopReactPropagation}
      onSubmit={stopReactPropagation}
      onChange={stopReactPropagation}
      onInput={stopReactPropagation}
      onInvalid={stopReactPropagation}
      onReset={stopReactPropagation}
      onFocus={stopReactPropagation}
      onBlur={stopReactPropagation}
      onKeyUp={stopReactPropagation}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          requestClose();
        } else if (panelRef.current) {
          trapDialogFocus(panelRef.current, event);
        }
        event.stopPropagation();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className="side-drawer-panel flex h-full w-full flex-col bg-white shadow-xl outline-none sm:max-w-md sm:border-l sm:border-border"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-950">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label="關閉"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer ? <div className="border-t border-border bg-slate-50 px-4 py-3 sm:px-5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
