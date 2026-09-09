"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // 安裝與離線能力共用同一個受同源限制的 Service Worker。
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    const standaloneTimer = standalone ? window.setTimeout(() => setInstalled(true), 0) : null;
    const handleInstall = (event: Event) => { event.preventDefault(); setInstallEvent(event as BeforeInstallPromptEvent); };
    const handleInstalled = () => { setInstalled(true); setInstallEvent(null); };
    window.addEventListener("beforeinstallprompt", handleInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => { if (standaloneTimer !== null) window.clearTimeout(standaloneTimer); window.removeEventListener("beforeinstallprompt", handleInstall); window.removeEventListener("appinstalled", handleInstalled); };
  }, []);

  if (installed || !installEvent) return null;
  return <aside role="status" className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-slate-950 p-4 text-white shadow-xl"><div><p className="font-semibold">安裝 CelebrateDeal</p><p className="text-sm text-slate-300">加入手機桌面，快速回到學習中心</p></div><button type="button" className="min-h-11 shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950" onClick={async () => { await installEvent.prompt(); await installEvent.userChoice; setInstallEvent(null); }}>安裝</button></aside>;
}

export default PwaInstallPrompt;
