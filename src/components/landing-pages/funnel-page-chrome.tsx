"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { formatFunnelEventDate, formatFunnelEventTimeRange, formatFunnelEventWeekday } from "@/lib/funnel-event-time";
import { showcaseColor, showcaseReadableOn } from "@/lib/funnel-showcase";
import type { FunnelStickyCta } from "@/lib/funnel-page-document";
import type { FunnelTypographyViewport } from "@/lib/funnel-typography";
import { useFunnelEvent } from "./funnel-event-context";

/**
 * Page-level chrome owned by the platform, rendered OUTSIDE the content shell
 * (`FUNNEL_CONTENT_SHELL_STYLE` keeps `contain: layout paint`, which would trap
 * `position: fixed`). Merchant custom CSS is scoped to `[data-funnel-content]`
 * and cannot select these elements.
 */

export const FUNNEL_STICKY_CTA_HEIGHT = 72;

export function funnelStickyCtaVisibleOn(settings: FunnelStickyCta | undefined, viewport: FunnelTypographyViewport): boolean {
  if (!settings?.enabled) return false;
  if (settings.devices === "all") return true;
  if (settings.devices === "mobile") return viewport === "mobile";
  return viewport !== "desktop";
}

function stickyTarget(root: HTMLElement | null, target: string | undefined): HTMLElement | null {
  if (!root) return null;
  if (target) {
    const byId = root.ownerDocument.getElementById(target);
    if (byId && root.contains(byId)) return byId;
  }
  return root.querySelector<HTMLElement>("[data-funnel-node-type='form']");
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * C-04 固定報名列。出現條件：捲過首屏（scrollY > 80% 視窗高）、目標表單不在畫面內、
 * 頁面內容的結尾（`endRef`）尚未出現（避免蓋住頁尾的平台揭露與政策連結）。
 * 內容只有結構化欄位：按鈕文字、目標錨點、可選的開場日期。
 */
export function FunnelStickyCtaBar({ settings, contentRef, endRef, linkColor }: { settings: FunnelStickyCta; contentRef: RefObject<HTMLElement | null>; endRef: RefObject<HTMLElement | null>; linkColor: string }) {
  const { schedule } = useFunnelEvent();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const root = contentRef.current;
    const end = endRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    let targetVisible = false;
    let endVisible = false;
    const update = () => setVisible(window.scrollY > window.innerHeight * 0.8 && !targetVisible && !endVisible);
    const target = stickyTarget(root, settings.target);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === target) targetVisible = entry.isIntersecting;
        if (entry.target === end) endVisible = entry.isIntersecting;
      }
      update();
    });
    if (target) observer.observe(target);
    if (end) observer.observe(end);
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); window.removeEventListener("scroll", update); };
  }, [contentRef, endRef, settings.target]);
  const background = showcaseColor(settings.backgroundColor) ?? "#ffffff";
  const button = showcaseColor(settings.buttonColor) ?? linkColor;
  const buttonText = showcaseColor(settings.buttonTextColor) ?? showcaseReadableOn(button);
  const date = settings.showDate && schedule.startsAt ? `${formatFunnelEventDate(schedule.startsAt, schedule.timezone, { year: false })}（${formatFunnelEventWeekday(schedule.startsAt, schedule.timezone)}）${formatFunnelEventTimeRange({ ...schedule, endsAt: null }) ?? ""}` : "";
  const go = () => {
    const target = stickyTarget(contentRef.current, settings.target);
    if (!target) return;
    target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    const field = target.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button, a[href]");
    window.setTimeout(() => field?.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 400);
  };
  const style: CSSProperties = {
    position: "fixed", insetInline: 0, bottom: 0, zIndex: 60, backgroundColor: background, color: showcaseReadableOn(background),
    boxShadow: "0 -6px 24px rgba(15, 23, 42, 0.16)", padding: "12px 16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
    transform: visible ? "translateY(0)" : "translateY(110%)",
  };
  // The slide-in is a CSS media-query class (not a render-time matchMedia check), so server and client markup match.
  return <div data-funnel-sticky-cta aria-hidden={!visible} inert={!visible} className="motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out" style={style}>
    <div className="mx-auto flex max-w-3xl items-center justify-between" style={{ gap: 12 }}>
      {date ? <p className="m-0 min-w-0 text-[15px] leading-snug font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{date}</p> : null}
      <button type="button" onClick={go} className="inline-flex min-h-12 shrink-0 cursor-pointer items-center justify-center rounded-[10px] px-6 text-[17px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2" style={{ backgroundColor: button, color: buttonText, outlineColor: button, flex: date ? undefined : 1 }}>{settings.label}</button>
    </div>
  </div>;
}

/** Space reserved at the end of the content so the bar never covers the last element. */
export function FunnelStickyCtaSpacer() {
  return <div aria-hidden data-funnel-sticky-spacer style={{ height: `calc(${FUNNEL_STICKY_CTA_HEIGHT}px + env(safe-area-inset-bottom, 0px))` }} />;
}

/**
 * I-3 捲動進場動畫。只作用在 section 的第一層子節點（row），只改 opacity／transform。
 * 伺服器與第一次 render 一律可見；掛載後只把「目前在畫面下方」的區塊設成待進場，
 * 因此首屏不會閃爍，也不會造成版面跳動。reduced motion 時完全不做。
 */
export function useFunnelScrollReveal(rootRef: RefObject<HTMLElement | null>, kind: "fade" | "rise" | null) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !kind || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-funnel-node-type='section'] > section > [data-funnel-node-id]"))
      .filter((element) => element.getBoundingClientRect().top > window.innerHeight);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.funnelReveal = "shown";
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    for (const element of targets) { element.dataset.funnelReveal = kind; observer.observe(element); }
    return () => { observer.disconnect(); for (const element of targets) delete element.dataset.funnelReveal; };
  }, [rootRef, kind]);
}
