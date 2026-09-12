"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";

type Slide = { imageUrl: string; alt: string; title?: string; description?: string };

export function LandingPageCarousel({ slides }: { slides: Slide[] }) {
  const [current, setCurrent] = useState(0);
  const slide = slides[current] ?? slides[0];
  if (!slide) return null;
  const move = (offset: number) => setCurrent((value) => (value + offset + slides.length) % slides.length);
  return <div className="mt-5"><figure><img src={slide.imageUrl} alt={slide.alt} className="aspect-video w-full rounded-2xl object-cover" />{slide.title ? <figcaption className="mt-2 font-bold">{slide.title}</figcaption> : null}{slide.description ? <p className="mt-1 text-sm text-slate-600">{slide.description}</p> : null}</figure>{slides.length > 1 ? <div className="mt-3 flex items-center justify-between gap-3"><button type="button" aria-label="上一張" className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => move(-1)}>上一張</button><p aria-live="polite" className="text-sm text-slate-600">{current + 1} / {slides.length}</p><button type="button" aria-label="下一張" className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => move(1)}>下一張</button></div> : null}</div>;
}

function remaining(targetAt?: string) {
  const target = targetAt ? new Date(targetAt).getTime() : Number.NaN;
  return Number.isFinite(target) ? Math.max(0, target - Date.now()) : null;
}

export function LandingPageCountdown({ targetAt, expiredMessage }: { targetAt?: string; expiredMessage: string }) {
  const [milliseconds, setMilliseconds] = useState(() => remaining(targetAt));
  useEffect(() => {
    const timer = window.setInterval(() => setMilliseconds(remaining(targetAt)), 1_000);
    return () => window.clearInterval(timer);
  }, [targetAt]);
  if (milliseconds === null) return <p role="status" className="mt-3 font-bold text-amber-900">尚未設定倒數時間</p>;
  if (milliseconds === 0) return <p role="status" className="mt-3 font-bold text-amber-900">{expiredMessage}</p>;
  const seconds = Math.floor(milliseconds / 1_000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds % 86_400 / 3_600);
  const minutes = Math.floor(seconds % 3_600 / 60);
  const rest = seconds % 60;
  return <time dateTime={targetAt} className="mt-3 block font-black tabular-nums text-amber-900" aria-label={`剩餘 ${days} 天 ${hours} 小時 ${minutes} 分 ${rest} 秒`}>{days} 天 {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:{String(rest).padStart(2, "0")}</time>;
}
