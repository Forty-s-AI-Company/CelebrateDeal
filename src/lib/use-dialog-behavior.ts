"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * F-127: shared dialog/drawer behaviour. While `active`, remembers the element
 * that had focus, closes on Escape, and returns focus to that element when the
 * dialog closes or unmounts. The trigger is captured in a layout effect, which
 * runs before the passive effects dialogs use to move focus inside (do not use
 * the `autoFocus` attribute on a child of such a dialog).
 */
export function useDialogBehavior(active: boolean, onClose?: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const hasClose = Boolean(onClose);

  useLayoutEffect(() => {
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
