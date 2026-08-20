"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const NAVIGATION_FEEDBACK_DELAY_MS = 120;
const NAVIGATION_TIMEOUT_MS = 15_000;
// Browser timers are numeric handles; keep this explicit because the project
// also includes Node typings whose overloaded setTimeout returns Timeout.
type BrowserTimer = number;

export type NavigationClickSnapshot = {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  origin: string;
  protocol: string;
  pathname: string;
  currentOrigin: string;
  currentPathname: string;
  download: string | null;
  target: string;
};

/**
 * 保持導覽回饋只服務於同一個 App Router 內的左鍵頁面切換。
 * 下載、外部連結、modifier click、目前頁面與表單送出都不應啟動它。
 */
export function shouldStartNavigationProgress(snapshot: NavigationClickSnapshot) {
  if (snapshot.defaultPrevented || snapshot.button !== 0) return false;
  if (snapshot.metaKey || snapshot.ctrlKey || snapshot.shiftKey || snapshot.altKey) return false;
  if (snapshot.download !== null || (snapshot.target && snapshot.target !== "_self")) return false;
  if (snapshot.origin !== snapshot.currentOrigin) return false;
  if (snapshot.protocol !== "http:" && snapshot.protocol !== "https:") return false;
  return snapshot.pathname !== snapshot.currentPathname;
}

export function shouldStartHistoryProgress(currentPathname: string, destinationPathname: string) {
  return Boolean(currentPathname && destinationPathname && currentPathname !== destinationPathname);
}

function clearTimer(timer: BrowserTimer | null) {
  if (timer !== null) window.clearTimeout(timer);
}

export function NavigationProgress() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const delayedStartRef = useRef<BrowserTimer | null>(null);
  const timeoutRef = useRef<BrowserTimer | null>(null);
  const previousPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    const currentPathname = pathname ?? "";
    const pathnameChanged = previousPathnameRef.current !== null
      && previousPathnameRef.current !== currentPathname;
    previousPathnameRef.current = currentPathname;
    clearTimer(delayedStartRef.current);
    clearTimer(timeoutRef.current);
    delayedStartRef.current = null;
    timeoutRef.current = null;
    if (pathnameChanged) {
      timeoutRef.current = window.setTimeout(() => {
        setPending(false);
        timeoutRef.current = null;
      }, 0);
    }

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      const shouldStart = shouldStartNavigationProgress({
        button: event.button,
        defaultPrevented: event.defaultPrevented,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        origin: destination.origin,
        protocol: destination.protocol,
        pathname: destination.pathname,
        currentOrigin: window.location.origin,
        currentPathname: pathname ?? window.location.pathname,
        download: anchor.getAttribute("download"),
        target: anchor.target,
      });

      if (!shouldStart) return;

      clearTimer(delayedStartRef.current);
      clearTimer(timeoutRef.current);
      delayedStartRef.current = window.setTimeout(() => {
        setPending(true);
        timeoutRef.current = window.setTimeout(() => {
          setPending(false);
          timeoutRef.current = null;
        }, NAVIGATION_TIMEOUT_MS);
      }, NAVIGATION_FEEDBACK_DELAY_MS);
    }

    function handlePopState() {
      const sourcePathname = pathname ?? "";
      const destinationPathname = window.location.pathname;
      if (!shouldStartHistoryProgress(sourcePathname, destinationPathname)) return;
      clearTimer(delayedStartRef.current);
      clearTimer(timeoutRef.current);
      setPending(true);
      timeoutRef.current = window.setTimeout(() => {
        setPending(false);
        timeoutRef.current = null;
      }, NAVIGATION_TIMEOUT_MS);
    }

    // Capture before Next Link calls preventDefault for an internal App Router
    // transition; otherwise the global listener would mistake a normal route
    // change for an intentionally cancelled click.
    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("popstate", handlePopState);
      clearTimer(delayedStartRef.current);
      clearTimer(timeoutRef.current);
    };
  }, [pathname]);

  if (!pending) return null;

  return (
    <div
      aria-busy="true"
      aria-label="正在載入頁面"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 bg-blue-100/70 opacity-100"
      data-navigation-progress="active"
      role="status"
    >
      <div className="h-full w-1/3 bg-primary motion-safe:animate-pulse motion-reduce:animate-none" />
      <span className="sr-only">正在載入頁面，請稍候。</span>
    </div>
  );
}
