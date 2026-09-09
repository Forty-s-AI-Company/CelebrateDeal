"use client";

import { useEffect, useState } from "react";

export interface StickyAnnouncementBarProps {
  endsAt?: string | number | Date;
  pricingHref?: string;
  label?: string;
}

function getRemaining(endsAt: StickyAnnouncementBarProps["endsAt"]) {
  const end = endsAt instanceof Date ? endsAt.getTime() : new Date(endsAt ?? Date.now() + 86400000).getTime();
  return Math.max(0, end - Date.now());
}

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return days > 0 ? `${days}天 ${hours.toString().padStart(2, "0")}時` : [hours, minutes, seconds].map((value) => value.toString().padStart(2, "0")).join(":");
}

export function StickyAnnouncementBar({ endsAt, pricingHref = "#pricing", label = "限時優惠，即將結束" }: StickyAnnouncementBarProps) {
  // SSR 與 hydration 使用一致的初始值，首次 effect 再填入實際倒數。
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const initialTimer = window.setTimeout(() => setRemaining(getRemaining(endsAt)), 0);
    const timer = window.setInterval(() => setRemaining(getRemaining(endsAt)), 1000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [endsAt]);
  const machineReadableEnd = endsAt === undefined ? undefined : new Date(endsAt).toISOString();
  return (
    <aside className="sticky top-0 z-40 flex items-center justify-center gap-3 bg-amber-400 px-3 py-2 text-center text-sm font-semibold text-slate-950 shadow-md" role="status" aria-live="polite">
      <span>{label}</span>
      <time className="rounded bg-slate-950 px-2 py-1 font-mono text-white" dateTime={machineReadableEnd} aria-label={`剩餘時間 ${formatRemaining(remaining)}`}>{formatRemaining(remaining)}</time>
      <a className="rounded-full bg-slate-950 px-3 py-1 text-white underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-white" href={pricingHref}>查看價格</a>
    </aside>
  );
}

export { formatRemaining };
