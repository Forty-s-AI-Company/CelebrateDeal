"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const EXIT_INTENT_COOKIE = "celebratedeal_exit_intent_seen";
const DEFAULT_DISCOUNT = "SAVE500";

function hasSeenExitIntent() {
  try {
    return document.cookie.split(";").some((cookie) => cookie.trim().startsWith(`${EXIT_INTENT_COOKIE}=`));
  } catch {
    return false;
  }
}

function markExitIntentSeen() {
  // 一次工作階段只提示一次，避免干擾回訪者；SameSite 降低跨站請求風險。
  document.cookie = `${EXIT_INTENT_COOKIE}=1; Max-Age=86400; Path=/; SameSite=Lax`;
}

export interface ExitIntentPopupProps {
  discountCode?: string;
  discountText?: string;
  checkoutHref?: string;
  enabled?: boolean;
}

export function ExitIntentPopup({
  discountCode = DEFAULT_DISCOUNT,
  discountText = "限時 NT$ 500 折扣",
  checkoutHref = "#pricing",
  enabled = true,
}: ExitIntentPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ y: number; at: number } | null>(null);

  const open = useCallback(() => {
    if (!enabled || isOpen || hasSeenExitIntent() || document.querySelector('[role="dialog"]')) return;
    markExitIntentSeen();
    setIsOpen(true);
  }, [enabled, isOpen]);

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!enabled) return;
    const onMouseLeave = (event: MouseEvent) => {
      // 只有滑向瀏覽器頂端邊界才算離開意圖，不攔截一般頁面移動。
      if (event.clientY <= 0) open();
    };
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) touchStartRef.current = { y: touch.clientY, at: Date.now() };
    };
    const onTouchEnd = (event: TouchEvent) => {
      const start = touchStartRef.current;
      const touch = event.changedTouches[0];
      touchStartRef.current = null;
      if (!start || !touch) return;
      const delta = touch.clientY - start.y;
      const elapsed = Date.now() - start.at;
      // 手指快速向上滑（delta < 0）通常是手機端的離開／返回意圖。
      if (delta < -100 && elapsed < 700 && window.scrollY < 160) open();
    };
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, open]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [close, isOpen]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="exit-intent-title" aria-describedby="exit-intent-description">
        <button type="button" className="float-right rounded p-2 text-2xl leading-none text-slate-500 hover:bg-slate-100" aria-label="關閉優惠視窗" onClick={close}>×</button>
        <p className="text-sm font-semibold text-amber-700">等等，別錯過這次機會</p>
        <h2 id="exit-intent-title" className="mt-2 text-2xl font-bold">送你 {discountText}</h2>
        <p id="exit-intent-description" className="mt-2 text-slate-600">現在完成報名即可使用優惠，或先免費試看再決定。</p>
        <div className="mt-5 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 text-center" aria-label={`優惠碼 ${discountCode}`}>
          <span className="text-xs text-amber-800">專屬優惠碼</span>
          <strong className="mt-1 block text-xl tracking-widest text-amber-950">{discountCode}</strong>
        </div>
        <a className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 text-center font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" href={checkoutHref} onClick={close}>立即使用優惠</a>
      </div>
    </div>
  );
}

export { EXIT_INTENT_COOKIE };
