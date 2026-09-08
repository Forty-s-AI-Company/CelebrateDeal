"use client";

import { useEffect, useState } from "react";
import type { CountdownTimerBlock } from "@/lib/funnel-blocks-schema";

function units(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return [Math.floor(seconds / 86400), Math.floor(seconds % 86400 / 3600), Math.floor(seconds % 3600 / 60), seconds % 60];
}

export function CountdownTimerBlockComponent({ blockId, settings }: { blockId: string; settings: CountdownTimerBlock["settings"] }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const evergreenKey = `celebratedeal-countdown-${blockId}`;
    let target = settings.mode === "fixed_date" ? Date.parse(settings.targetDate!) : Date.parse(settings.scheduledAt ?? "");
    if (settings.mode === "evergreen_minutes") {
      const stored = Number(window.sessionStorage.getItem(evergreenKey));
      target = stored > Date.now() ? stored : Date.now() + settings.evergreenMinutes! * 60_000;
      window.sessionStorage.setItem(evergreenKey, String(target));
    }
    const tick = () => setRemaining(Math.max(0, target - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [blockId, settings]);

  const liveNow = settings.mode === "live_linked" && (settings.liveStatus === "live" || (settings.liveStatus !== "ended" && remaining === 0));
  if (liveNow) return <section className="mx-auto max-w-4xl px-4 py-10 text-center">{settings.liveHref ? <a href={settings.liveHref} className="inline-flex rounded-full bg-red-600 px-6 py-4 text-lg font-black text-white">🔴 直播進行中，立即入場</a> : <p className="text-xl font-black text-red-600">🔴 直播進行中</p>}</section>;
  if (remaining === 0) return <section className="mx-auto max-w-4xl px-4 py-10 text-center text-xl font-bold text-slate-700">{settings.expiredMessage}</section>;
  const values = units(remaining ?? 0);
  return <section className="mx-auto max-w-4xl px-4 py-10 text-center" aria-live="polite">{settings.title ? <h2 className="mb-6 text-2xl font-black text-slate-950">{settings.title}</h2> : null}<div className="flex justify-center gap-2 sm:gap-4">{["天", "時", "分", "秒"].map((label, index) => <div key={label} className={`${settings.theme === "flip" ? "bg-slate-950 text-white shadow-xl" : "border border-slate-200 bg-white text-slate-950"} min-w-16 rounded-2xl p-3 sm:min-w-24`}><strong className="block text-2xl tabular-nums sm:text-4xl">{String(values[index] ?? 0).padStart(2, "0")}</strong><span className="text-xs opacity-70">{label}</span></div>)}</div></section>;
}

export { CountdownTimerBlockComponent as CountdownTimerBlock };
