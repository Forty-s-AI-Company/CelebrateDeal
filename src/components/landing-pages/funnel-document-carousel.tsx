"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function FunnelDocumentCarousel({ id, label, children }: { id: string; label: string; children: ReactNode[] }) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStart = useRef<number | null>(null);
  const count = children.length;
  const move = (next: number) => setIndex((next + count) % count);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (!count) return <div data-funnel-carousel="true"><p className="text-sm text-slate-500">輪播目前沒有內容。</p></div>;
  return <section aria-label={label} aria-roledescription="carousel" role="region" data-funnel-carousel="true" tabIndex={0} onKeyDown={(event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); move(index - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); move(index + 1); }
    if (event.key === "Home") { event.preventDefault(); setIndex(0); }
    if (event.key === "End") { event.preventDefault(); setIndex(count - 1); }
  }}>
    <p className="sr-only" aria-live="polite">第 {index + 1} 張，共 {count} 張</p>
    <div className="overflow-hidden" onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }} onTouchCancel={() => { touchStart.current = null; }} onTouchEnd={(event) => {
      const start = touchStart.current; const end = event.changedTouches[0]?.clientX; touchStart.current = null;
      if (start === null || end === undefined || Math.abs(start - end) < 40) return;
      move(index + (start > end ? 1 : -1));
    }}>
      <div className={`flex ${reducedMotion ? "" : "transition-transform duration-300"}`} style={{ transform: `translateX(-${index * 100}%)` }}>
        {children.map((child, childIndex) => <div key={`${id}-slide-${childIndex}`} className="min-w-full" role="group" aria-roledescription="slide" aria-label={`${childIndex + 1} / ${count}`} aria-hidden={childIndex !== index} inert={childIndex !== index ? true : undefined}>{child}</div>)}
      </div>
    </div>
    {count > 1 ? <div className="mt-3 flex items-center justify-center gap-2"><button type="button" aria-label="上一張" onClick={() => move(index - 1)} className="min-h-11 rounded-lg border px-4">‹</button>{children.map((_, dotIndex) => <button key={`${id}-dot-${dotIndex}`} type="button" aria-label={`前往第 ${dotIndex + 1} 張`} aria-current={dotIndex === index ? "true" : undefined} onClick={() => setIndex(dotIndex)} className="min-h-11 min-w-11 rounded-full border px-3">{dotIndex + 1}</button>)}<button type="button" aria-label="下一張" onClick={() => move(index + 1)} className="min-h-11 rounded-lg border px-4">›</button></div> : null}
  </section>;
}
