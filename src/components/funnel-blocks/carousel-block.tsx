"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CarouselSliderBlock } from "@/lib/funnel-blocks-schema";

export function CarouselBlock({ settings }: { settings: CarouselSliderBlock["settings"] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStart = useRef<number | null>(null);
  const lastNavigation = useRef(0);
  const slideCount = settings.slides.length;
  const navigate = useCallback((nextIndex: number) => {
    const now = Date.now();
    if (now - lastNavigation.current < 250) return;
    lastNavigation.current = now;
    setActiveIndex((nextIndex + slideCount) % slideCount);
  }, [slideCount]);

  useEffect(() => {
    if (!settings.autoPlay || slideCount < 2) return;
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % slideCount), settings.intervalMs);
    return () => window.clearInterval(timer);
  }, [settings.autoPlay, settings.intervalMs, slideCount]);

  return (
    <section aria-label={settings.ariaLabel} aria-roledescription="carousel" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="relative overflow-hidden rounded-3xl bg-slate-950 shadow-xl" onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => {
        const start = touchStart.current;
        const end = event.changedTouches[0]?.clientX;
        touchStart.current = null;
        if (start === null || end === undefined || Math.abs(start - end) < 40) return;
        navigate(activeIndex + (start > end ? 1 : -1));
      }}>
        <div className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
          {settings.slides.map((slide, index) => {
            const content = <><Image src={slide.imageUrl} alt={slide.imageAlt} width={1600} height={900} unoptimized loading="lazy" sizes="(max-width: 768px) 100vw, 1152px" className="aspect-video w-full object-cover" />{slide.title ? <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-6 pb-8 pt-16 text-xl font-bold text-white">{slide.title}</p> : null}</>;
            return <div key={slide.id} className="relative min-w-full" aria-hidden={index !== activeIndex}>{slide.linkUrl ? <a href={slide.linkUrl} tabIndex={index === activeIndex ? 0 : -1}>{content}</a> : content}</div>;
          })}
        </div>
        {settings.showArrows && slideCount > 1 ? <><button type="button" aria-label="上一張" onClick={() => navigate(activeIndex - 1)} className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-2xl text-white">‹</button><button type="button" aria-label="下一張" onClick={() => navigate(activeIndex + 1)} className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-2xl text-white">›</button></> : null}
      </div>
      {settings.showDots && slideCount > 1 ? <div className="mt-4 flex justify-center gap-2">{settings.slides.map((slide, index) => <button key={slide.id} type="button" aria-label={`前往第 ${index + 1} 張`} aria-current={index === activeIndex ? "true" : undefined} onClick={() => navigate(index)} className={`h-2.5 rounded-full transition-all ${index === activeIndex ? "w-7 bg-slate-900" : "w-2.5 bg-slate-300"}`} />)}</div> : null}
    </section>
  );
}
