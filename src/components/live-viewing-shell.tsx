"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Keep the same player mounted while expanding, so media and drafts survive rotation. */
export function LiveViewingShell({ children, checkout, orientation = "landscape", className }: {
  children: ReactNode; checkout: boolean; orientation?: "landscape" | "portrait"; className: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const active = expanded && !checkout;

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || checkout) return;
    const viewport = window.visualViewport;
    let frame = 0;
    function syncViewport() {
      shell?.style.setProperty("--view-height", `${viewport?.height ?? window.innerHeight}px`);
      shell?.style.setProperty("--view-top", `${viewport?.offsetTop ?? 0}px`);
    }
    function resize() {
      syncViewport();
      window.cancelAnimationFrame(frame);
      // Wait for the smaller viewport layout, then reveal the composer and its send button.
      frame = window.requestAnimationFrame(() => {
        const input = document.activeElement;
        if (!(input instanceof HTMLElement) || !shell?.contains(input) || !input.matches("input,textarea,select")) return;
        (input.closest("form") ?? input).scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    }
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(frame);
    };
  }, [checkout]);

  useEffect(() => {
    if (!active) return;
    const shell = shellRef.current;
    const toggle = toggleRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    toggle?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setExpanded(false); return; }
      if (event.key !== "Tab" || !shell) return;
      const items = Array.from(shell.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')).filter(item => item.getClientRects().length > 0);
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      toggle?.focus();
    };
  }, [active]);

  return <section ref={shellRef} className={`${className} ${checkout ? "" : "live-viewing-shell"}`} data-orientation={orientation} data-page-fullscreen={active ? "true" : "false"} aria-label="直播觀看區" role={active ? "dialog" : undefined} aria-modal={active || undefined}>
    {!checkout && <div className="live-viewing-toolbar">
      <button ref={toggleRef} type="button" aria-pressed={active} onClick={() => setExpanded(!active)} className="min-h-11 shrink-0 rounded-lg border border-white/30 px-3 text-sm font-bold">{active ? "退出頁內全螢幕" : "頁內全螢幕"}</button>
      <p className="text-xs text-white/70">頁內全螢幕可聊天、回答卡片；手機原生影片全螢幕可能只顯示影片。{active ? "可旋轉裝置，或按 Escape 退出。" : ""}</p>
    </div>}
    {children}
  </section>;
}
