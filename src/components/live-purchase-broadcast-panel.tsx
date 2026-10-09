"use client";

import { useEffect, useState } from "react";
import { LivePurchaseBroadcastPayload, purchaseBroadcastAge, type LivePurchaseBroadcastCard } from "@/lib/live-purchase-broadcast-contract";

type Snapshot = { scope: string; status: "loaded" | "unavailable"; cards: LivePurchaseBroadcastCard[] };

/** The playback parent mounts this only after admission and product reveal.
 * Unmount/re-scope aborts outstanding reads; no data is cached in storage. */
export function LivePurchaseBroadcastPanel({ vendorId, liveId, onAdmissionInvalid }: {
  vendorId: string; liveId: string; onAdmissionInvalid: () => void;
}) {
  const scope = JSON.stringify([vendorId, liveId]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    let disposed = false, loading = false;
    let current: AbortController | null = null;
    const load = async () => {
      if (disposed || loading || document.visibilityState === "hidden") return;
      loading = true;
      const controller = new AbortController(); current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const query = new URLSearchParams({ vendorId, liveId });
        const response = await fetch(`/api/live-purchase-broadcasts?${query}`, {
          headers: { "X-CelebrateDeal-Client": "web" }, credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (disposed) return;
        if (response.status === 401 || response.status === 403) {
          setSnapshot({ scope, status: "unavailable", cards: [] });
          onAdmissionInvalid(); return;
        }
        if (!response.ok) throw new Error("broadcast-unavailable");
        const parsed = LivePurchaseBroadcastPayload.safeParse(await response.json());
        if (!parsed.success) throw new Error("broadcast-invalid");
        if (!disposed) setSnapshot({ scope, status: "loaded", cards: parsed.data.broadcasts });
      } catch {
        // Clear old cards on errors, rather than presenting stale purchases.
        if (!disposed) setSnapshot({ scope, status: "unavailable", cards: [] });
      } finally { window.clearTimeout(timeout); loading = false; }
    };
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 15_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; current?.abort(); window.clearTimeout(initial); window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [liveId, onAdmissionInvalid, scope, vendorId]);

  const visible = snapshot?.scope === scope ? snapshot : null;
  return <aside aria-label="本場近期購買" className="mt-3 rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-white">
    <h3 className="font-bold">本場近期購買</h3>
    <div aria-live="polite" className="mt-2 max-h-32 overflow-y-auto">
      {!visible ? <p>正在確認購買紀錄…</p> : visible.status === "unavailable" ? <p>暫時無法更新購買紀錄。</p>
        : visible.cards.length === 0 ? <p>目前沒有近期購買紀錄。</p>
          : <ul className="space-y-2">{visible.cards.map(card => <li key={card.id} className="flex flex-wrap gap-x-2">
            <span>{card.buyerMaskedName}</span><span className="min-w-0 break-words">購買了 {card.productName}</span>
            <span className="text-xs text-slate-300">{purchaseBroadcastAge(card.secondsAgo)}</span>
          </li>)}</ul>}
    </div>
    <p className="mt-2 text-xs text-slate-300">最近 30 分鐘的本場購買紀錄，姓名已遮罩。</p>
  </aside>;
}
