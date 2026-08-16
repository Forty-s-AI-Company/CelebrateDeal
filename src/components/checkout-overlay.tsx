"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useRouter } from "next/navigation";

export function CheckoutOverlay({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.back();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [router]);

  return (
    <div
      role="dialog"
      aria-labelledby="checkout-overlay-title"
      aria-describedby="checkout-overlay-description"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/75 backdrop-blur-sm"
    >
      <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 px-4 text-white shadow-lg">
        <button
          ref={closeButtonRef}
          type="button"
          onClick={() => router.back()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-bold hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          返回直播
        </button>
        <div className="text-center">
          <h1 id="checkout-overlay-title" className="text-sm font-black sm:text-base">商品結帳</h1>
          <p id="checkout-overlay-description" className="sr-only">直播會繼續播放，並可使用畫面上的播放器控制。</p>
        </div>
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="關閉結帳並返回直播"
          className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  );
}
