"use client";

import { ShoppingBag, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LivePurchaseBroadcastItem } from "@/lib/live-interaction";

export function LivePurchaseTicker({
  vendorId,
  liveId,
  enabled,
}: {
  vendorId: string;
  liveId: string;
  enabled: boolean;
}) {
  const [broadcasts, setBroadcasts] = useState<LivePurchaseBroadcastItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!enabled || dismissed) return;
    const controller = new AbortController();
    async function fetchBroadcasts() {
      try {
        const response = await fetch(
          `/api/live-purchase-broadcasts?vendorId=${encodeURIComponent(vendorId)}&liveId=${encodeURIComponent(liveId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) return;
        const data = await response.json() as { broadcasts?: LivePurchaseBroadcastItem[] };
        if (!controller.signal.aborted && Array.isArray(data.broadcasts)) setBroadcasts(data.broadcasts);
      } catch { /* Best-effort polling; cancellation also ends stale requests. */ }
    }
    void fetchBroadcasts();
    const interval = window.setInterval(() => void fetchBroadcasts(), 6_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [dismissed, enabled, liveId, vendorId]);

  useEffect(() => {
    if (!enabled || dismissed || broadcasts.length === 0) return;
    // Timer callbacks own animation state; polling does not restart the cycle.
    const hideTimer = window.setTimeout(() => setVisible(false), 4_000);
    const advanceTimer = window.setTimeout(() => {
      setCurrentIndex((previous) => previous + 1);
      setVisible(true);
    }, 6_500);
    return () => { window.clearTimeout(hideTimer); window.clearTimeout(advanceTimer); };
  }, [enabled, dismissed, broadcasts.length, currentIndex]);

  if (!enabled || dismissed || broadcasts.length === 0) return null;
  const current = broadcasts[currentIndex % broadcasts.length];
  if (!current) return null;

  return (
    <div
      aria-live="polite"
      className={`fixed bottom-24 left-4 z-[60] max-w-[280px] sm:max-w-xs transition-all duration-500 ease-out ${
        visible ? "translate-y-0 opacity-100 scale-100" : "translate-y-2 opacity-0 scale-95 pointer-events-none"
      }`}
    >
      <div className="flex items-center gap-2.5 rounded-2xl border border-white/60 bg-slate-900/90 px-3.5 py-2.5 text-white shadow-xl backdrop-blur-md">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-amber-500 to-red-500 text-white shadow-sm">
          <ShoppingBag size={15} />
        </div>
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-semibold text-amber-300">
            {current.buyerMaskedName} <span className="text-slate-300">剛剛搶購了</span>
          </p>
          <p className="truncate font-bold text-white">{current.productName}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="關閉成交推播"
          className="ml-1 text-slate-400 hover:text-slate-200 transition"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
