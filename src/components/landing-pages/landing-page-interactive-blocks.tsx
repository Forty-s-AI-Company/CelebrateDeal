"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { LandingPageLink } from "@/components/landing-page-link";

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

type CountdownCta = { label: string; href: string; pageId?: string };

export function LandingPageCountdown({ targetAt, expiredMessage, cta, expiredAction = "show_message", expiredRedirectHref }: {
  targetAt?: string;
  expiredMessage: string;
  cta?: CountdownCta;
  expiredAction?: "show_message" | "hide_cta" | "redirect";
  expiredRedirectHref?: string;
}) {
  const [milliseconds, setMilliseconds] = useState(() => remaining(targetAt));
  useEffect(() => {
    const timer = window.setInterval(() => setMilliseconds(remaining(targetAt)), 1_000);
    return () => window.clearInterval(timer);
  }, [targetAt]);
  useEffect(() => {
    if (milliseconds === 0 && expiredAction === "redirect" && expiredRedirectHref) window.location.assign(expiredRedirectHref);
  }, [expiredAction, expiredRedirectHref, milliseconds]);
  if (milliseconds === null) return <p role="status" className="mt-3 font-bold text-amber-900">尚未設定倒數時間</p>;
  if (milliseconds === 0) {
    if (expiredAction === "hide_cta") return null;
    return <p role="status" className="mt-3 font-bold text-amber-900">{expiredMessage}</p>;
  }
  const seconds = Math.floor(milliseconds / 1_000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds % 86_400 / 3_600);
  const minutes = Math.floor(seconds % 3_600 / 60);
  const rest = seconds % 60;
  return <div className="mt-4"><time dateTime={targetAt} className="grid grid-cols-4 gap-2 font-black tabular-nums text-slate-950" aria-label={`剩餘 ${days} 天 ${hours} 小時 ${minutes} 分 ${rest} 秒`}>{[[days, "天"], [hours, "時"], [minutes, "分"], [rest, "秒"]].map(([value, label]) => <span key={String(label)} className="rounded-xl border border-amber-200/80 bg-white/80 px-2 py-3 text-center shadow-[0_1px_3px_rgba(0,0,0,0.05)]"><span className="block text-2xl sm:text-3xl">{String(value).padStart(2, "0")}</span><span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span></span>)}</time>{cta ? <div className="mt-5"><LandingPageLink href={cta.href} pageId={cta.pageId} className="inline-flex items-center justify-center rounded-xl bg-amber-500 px-5 py-3 font-bold text-slate-950 shadow-sm transition hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-4">{cta.label}</LandingPageLink></div> : null}</div>;
}
