"use client";

import { useEffect, useRef } from "react";

/**
 * F-127: shared dialog/drawer behaviour. While `active`, remembers the element
 * that had focus, closes on Escape, and returns focus to that element when the
 * dialog closes or unmounts. Effects run in declaration order, so call this
 * hook before the effect that moves focus into the dialog, and do not use the
 * `autoFocus` attribute inside the dialog.
 */
export function useDialogBehavior(active: boolean, onClose?: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const hasClose = Boolean(onClose);

  useEffect(() => {
    if (!active) return;
    const trigger = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onCloseRef.current?.();
      }
    };
    if (hasClose) document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [active, hasClose]);
}
