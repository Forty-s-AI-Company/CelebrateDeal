"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { clsx } from "clsx";
import { CircleCheck, Info, X } from "lucide-react";

export type ToastTone = "success" | "info";

export type ToastMessage = {
  /** Changes on every `showToast`, so the same text shown twice is announced twice. */
  id: number;
  text: string;
  tone: ToastTone;
  /** Milliseconds before it disappears on its own; `null` keeps it until it is closed. */
  duration: number | null;
};

export const DEFAULT_TOAST_DURATION_MS = 5_000;

/**
 * State for one `Toast`: `showToast` replaces the current message (toasts
 * never stack), `dismissToast` clears it. Keep the hook and the `<Toast>` in
 * the same component so the live region is mounted before the first message.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const nextId = useRef(0);
  const showToast = useCallback((text: string, options: { tone?: ToastTone; duration?: number | null } = {}) => {
    nextId.current += 1;
    setToast({
      id: nextId.current,
      text,
      tone: options.tone ?? "success",
      duration: options.duration === undefined ? DEFAULT_TOAST_DURATION_MS : options.duration,
    });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);
  return { toast, showToast, dismissToast };
}

const toneStyles: Record<ToastTone, { className: string; icon: typeof CircleCheck }> = {
  success: { className: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: CircleCheck },
  info: { className: "border-slate-300 bg-white text-slate-800", icon: Info },
};

/**
 * A short, non-blocking confirmation such as 「已儲存」. It is announced
 * through a polite `role="status"` live region that is always mounted, never
 * takes focus, disappears after `toast.duration` (paused while the pointer is
 * over it or focus is inside it) and can be closed with its button or Escape.
 * When it is closed from the keyboard, focus returns to where it came from.
 * The entrance motion is off under `prefers-reduced-motion`.
 *
 * Errors and anything the user must act on stay inline (`role="alert"`, next
 * to the field or form) instead of in a toast.
 */
export function Toast({
  toast,
  onDismiss,
  dismissLabel = "關閉通知",
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
  dismissLabel?: string;
}) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const paused = toast !== null && (hoveredId === toast.id || focusedId === toast.id);

  useEffect(() => {
    if (!toast || toast.duration === null || paused) return;
    const timer = window.setTimeout(onDismiss, toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast, paused, onDismiss]);

  function dismiss() {
    const card = cardRef.current;
    if (card && card.contains(document.activeElement)) {
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    }
    onDismiss();
  }

  function onFocus(event: FocusEvent<HTMLDivElement>) {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !event.currentTarget.contains(from)) returnFocusRef.current = from;
    setFocusedId(toast?.id ?? null);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocusedId(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !toast) return;
    event.preventDefault();
    dismiss();
  }

  const tone = toast ? toneStyles[toast.tone] : null;
  const Icon = tone?.icon;
  return (
    <div data-ui-toast="" className="ui-toast-region pointer-events-none fixed inset-x-4 z-[100] flex justify-center sm:inset-x-auto sm:left-4 sm:w-96">
      <div
        ref={cardRef}
        onMouseEnter={() => setHoveredId(toast?.id ?? null)}
        onMouseLeave={() => setHoveredId(null)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={toast && tone
          ? clsx("ui-toast-card pointer-events-auto flex w-full items-start gap-2 rounded-lg border py-2 pl-4 pr-2 text-sm shadow-lg", tone.className)
          : "w-full"}
      >
        <p role="status" aria-live="polite" aria-atomic="true" className={toast ? "flex min-w-0 flex-1 items-start gap-2 py-1.5 font-medium" : "sr-only"}>
          {toast && Icon ? (
            <>
              <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span key={toast.id} className="min-w-0 break-words">{toast.text}</span>
            </>
          ) : null}
        </p>
        {toast ? (
          <button
            type="button"
            aria-label={dismissLabel}
            onClick={dismiss}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-current hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
