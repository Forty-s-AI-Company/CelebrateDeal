"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Eye, Gift, MessageCircle, Pause, Play, Radio, ShoppingBag, Sparkles, X } from "lucide-react";

export type LivePreviewEvent = {
  eventType: string;
  triggerSec: number;
  title: string;
  message?: string | null;
  productId?: string | null;
  ctaLabel?: string | null;
  metadata?: unknown;
};

type PreviewProduct = {
  id: string;
  name: string;
};

type PreviewPerspective = "viewer" | "winner";

function metadataOf(event: LivePreviewEvent | undefined): Record<string, unknown> {
  return event && typeof event.metadata === "object" && event.metadata !== null && !Array.isArray(event.metadata)
    ? event.metadata as Record<string, unknown>
    : {};
}

function durationOf(event: LivePreviewEvent | undefined) {
  const duration = metadataOf(event).durationSec;
  return typeof duration === "number" && Number.isFinite(duration) ? Math.max(5, duration) : 12;
}

function clock(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function optionsOf(event: LivePreviewEvent | undefined) {
  const options = metadataOf(event).options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (typeof option === "string" && option.trim()) return [option.trim()];
    if (typeof option === "object" && option !== null && "label" in option && String(option.label).trim()) {
      return [String(option.label).trim()];
    }
    return [];
  });
}

function discountLabel(event: LivePreviewEvent | undefined) {
  const metadata = metadataOf(event);
  const value = typeof metadata.discountValue === "number" ? metadata.discountValue : 10;
  return metadata.discountType === "fixed" ? `現折 $${Math.round(value / 100)}` : `${value}% OFF`;
}

function InteractionCard({
  event,
  product,
  perspective,
  remaining,
  animationKey,
}: {
  event: LivePreviewEvent | undefined;
  product: PreviewProduct | undefined;
  perspective: PreviewPerspective;
  remaining: number;
  animationKey: number;
}) {
  if (!event) {
    return (
      <div className="rounded-2xl border border-white/60 bg-white/90 p-4 text-center shadow-xl backdrop-blur">
        <Sparkles className="mx-auto text-blue-600" size={24} />
        <p className="mt-2 text-sm font-bold text-slate-900">拖動時間軸開始試播</p>
        <p className="mt-1 text-xs text-slate-500">互動卡片會在這裡即時跳出</p>
      </div>
    );
  }

  const metadata = metadataOf(event);
  const countdown = <span className="rounded-full bg-slate-950/80 px-2 py-1 font-mono text-[10px] font-bold text-white">剩 {remaining}s</span>;

  if (event.eventType === "lucky_draw") {
    const slogan = typeof metadata.slogan === "string" ? metadata.slogan : "留言參加抽獎";
    return perspective === "winner" ? (
      <div key={animationKey} data-testid="winner-card" className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-fuchsia-50 p-4 text-center shadow-2xl">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 flex justify-around text-lg motion-safe:animate-bounce">🎉 ✨ 🎊 ✨ 🎉</div>
        <Gift className="mx-auto mt-3 text-fuchsia-600" size={28} />
        <p className="mt-2 text-xs font-bold text-fuchsia-700">恭喜中獎</p>
        <p className="text-lg font-black text-slate-950">你是本輪幸運得主！</p>
        <div className="mt-3 rounded-xl border border-dashed border-fuchsia-300 bg-white px-3 py-2">
          <p className="text-[10px] font-semibold text-slate-500">8 碼核銷碼</p>
          <p className="font-mono text-lg font-black tracking-[0.18em] text-fuchsia-700">LIVE8WIN</p>
        </div>
      </div>
    ) : (
      <div key={animationKey} data-testid="lucky-draw-card" className="rounded-2xl bg-gradient-to-br from-fuchsia-600 to-violet-700 p-4 text-white shadow-2xl motion-safe:animate-pulse">
        <div className="flex items-center justify-between"><span className="text-xs font-bold">🎁 幸運大抽獎</span>{countdown}</div>
        <p className="mt-3 text-lg font-black">留言「{slogan}」</p>
        <p className="mt-1 text-xs text-white/80">送出指定口號，就有機會被抽中</p>
      </div>
    );
  }

  if (event.eventType === "poll") {
    const question = typeof metadata.question === "string" ? metadata.question : event.title;
    return (
      <div key={animationKey} data-testid="poll-card" className="rounded-2xl border border-violet-100 bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between"><span className="text-xs font-bold text-violet-700">即時投票</span>{countdown}</div>
        <p className="mt-2 text-base font-black text-slate-950">{question}</p>
        <div className="mt-3 grid gap-2">{optionsOf(event).map((option) => <button key={option} type="button" className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-left text-xs font-bold text-violet-800">{option}</button>)}</div>
      </div>
    );
  }

  if (event.eventType === "flash_voucher") {
    const maxClaims = typeof metadata.maxClaims === "number" ? metadata.maxClaims : 100;
    return (
      <div key={animationKey} data-testid="voucher-card" className="rounded-2xl bg-gradient-to-br from-red-600 to-orange-500 p-4 text-white shadow-2xl">
        <div className="flex items-center justify-between"><span className="text-xs font-bold">限時直播券</span>{countdown}</div>
        <p className="mt-2 text-2xl font-black">{discountLabel(event)}</p>
        <p className="text-xs text-white/85">{product?.name ?? "全館商品"}・限量 {maxClaims} 份</p>
        <button type="button" className="mt-3 w-full rounded-xl bg-white py-2 text-sm font-black text-red-600">立即領券</button>
      </div>
    );
  }

  if (event.eventType === "product_spotlight") {
    return <div key={animationKey} data-testid="product-card" className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-2xl"><ShoppingBag className="text-emerald-600" size={22} /><p className="mt-2 text-xs font-bold text-emerald-700">直播主打商品</p><p className="text-base font-black text-slate-950">{product?.name ?? "尚未選擇商品"}</p><button type="button" className="mt-3 w-full rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white">查看商品</button></div>;
  }

  if (event.eventType === "cta_switch") {
    return <div key={animationKey} data-testid="cta-card" className="rounded-2xl border border-blue-100 bg-white p-4 shadow-2xl"><p className="text-base font-black text-slate-950">{event.title}</p><button type="button" className="mt-3 w-full rounded-xl bg-blue-600 py-2 text-sm font-bold text-white">{event.ctaLabel || "查看優惠"}</button></div>;
  }

  return <div key={animationKey} data-testid="message-card" className="rounded-2xl border border-blue-100 bg-white p-4 shadow-2xl"><div className="flex items-center gap-2 text-xs font-bold text-blue-700"><MessageCircle size={15} />官方置頂</div><p className="mt-2 text-sm font-semibold text-slate-900">{event.message || event.title}</p></div>;
}

function Phone({
  title,
  thumbnailUrl,
  event,
  product,
  perspective,
  remaining,
  currentSec,
  animationKey,
}: {
  title: string;
  thumbnailUrl?: string | null;
  event: LivePreviewEvent | undefined;
  product: PreviewProduct | undefined;
  perspective: PreviewPerspective;
  remaining: number;
  currentSec: number;
  animationKey: number;
}) {
  return (
    <div data-testid="mobile-device-frame" className="mx-auto w-full max-w-[330px] rounded-[2.8rem] border-[7px] border-slate-950 bg-slate-950 p-1 shadow-[0_28px_80px_-20px_rgba(15,23,42,0.65)]">
      <div className="relative aspect-[9/19.5] overflow-hidden rounded-[2.25rem] bg-slate-100">
        <div className="absolute left-1/2 top-2 z-30 h-6 w-24 -translate-x-1/2 rounded-full bg-black" aria-label="手機動態島" />
        <div className="relative h-[43%] overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-violet-950">
          {thumbnailUrl ? <Image src={thumbnailUrl} alt="直播預覽縮圖" fill unoptimized className="object-cover opacity-75" /> : <div className="grid h-full place-items-center text-white/80"><Radio className="motion-safe:animate-pulse" size={42} /></div>}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />
          <span className="absolute left-4 top-10 rounded-md bg-red-600 px-2 py-1 text-[10px] font-black text-white">LIVE</span>
          <div className="absolute bottom-3 left-4 right-4 text-white"><p className="line-clamp-1 text-sm font-bold">{title}</p><p className="mt-1 font-mono text-[10px] text-white/70">導演時間 {clock(currentSec)}</p></div>
        </div>
        <div className="absolute inset-x-0 bottom-0 top-[43%] bg-gradient-to-b from-slate-50 to-slate-100 p-3">
          <div className="space-y-2 text-[10px] text-slate-600"><p><b className="text-blue-700">小安</b>：今天的優惠也太讚了吧！</p><p><b className="text-fuchsia-700">Mia</b>：已經分享直播囉 🙌</p><p><b className="text-emerald-700">阿哲</b>：商品連結在哪裡？</p></div>
          <div className="absolute inset-x-3 bottom-14"><InteractionCard event={event} product={product} perspective={perspective} remaining={remaining} animationKey={animationKey} /></div>
          <div className="absolute inset-x-3 bottom-3 flex h-9 items-center rounded-full border border-white bg-white/80 px-3 text-[10px] text-slate-400 shadow-sm backdrop-blur">說點什麼… <span className="ml-auto">♡　↗</span></div>
        </div>
      </div>
    </div>
  );
}

export function LiveMobilePreviewSimulator({
  events,
  products,
  liveTitle = "直播畫面預覽",
  thumbnailUrl,
}: {
  events: LivePreviewEvent[];
  products: PreviewProduct[];
  liveTitle?: string;
  thumbnailUrl?: string | null;
}) {
  const sortedEvents = useMemo(() => [...events].sort((a, b) => a.triggerSec - b.triggerSec), [events]);
  const timelineEnd = useMemo(() => Math.max(300, ...sortedEvents.map((event) => event.triggerSec + durationOf(event))), [sortedEvents]);
  const [currentSec, setCurrentSec] = useState(sortedEvents[0]?.triggerSec ?? 0);
  const [perspective, setPerspective] = useState<PreviewPerspective>("viewer");
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setPlayTicks] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isPlaying) return;
    let elapsedSeconds = 0;
    const timer = window.setInterval(() => {
      setCurrentSec((value) => Math.min(timelineEnd, value + 1));
      elapsedSeconds += 1;
      setPlayTicks(elapsedSeconds);
      if (elapsedSeconds >= 5) setIsPlaying(false);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, timelineEnd]);

  const activeEvent = [...sortedEvents].reverse().find((event) => currentSec >= event.triggerSec && currentSec <= event.triggerSec + durationOf(event));
  const activeProductId = activeEvent?.productId || (typeof metadataOf(activeEvent).productId === "string" ? metadataOf(activeEvent).productId as string : undefined);
  const activeProduct = products.find((product) => product.id === activeProductId) ?? (activeEvent?.eventType === "product_spotlight" ? products[0] : undefined);
  const remaining = activeEvent ? Math.max(0, Math.ceil(activeEvent.triggerSec + durationOf(activeEvent) - currentSec)) : 0;

  function seek(seconds: number) {
    setCurrentSec(Math.max(0, Math.min(timelineEnd, seconds)));
    setAnimationKey((key) => key + 1);
    setIsPlaying(false);
    setPlayTicks(0);
  }

  function playFiveSeconds() {
    setPlayTicks(0);
    setAnimationKey((key) => key + 1);
    setIsPlaying(true);
  }

  const controls = (
    <div data-testid="timeline-director" className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2"><div><p className="text-xs font-black text-slate-900">導演時間軸</p><p className="font-mono text-[10px] text-slate-500">{clock(currentSec)} / {clock(timelineEnd)}</p></div><button type="button" onClick={isPlaying ? () => setIsPlaying(false) : playFiveSeconds} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-slate-950 px-3 text-[11px] font-bold text-white">{isPlaying ? <Pause size={13} /> : <Play size={13} />}{isPlaying ? "暫停" : "播放 5 秒快轉試看"}</button></div>
      <div className="relative mt-4">
        <input aria-label="直播導演時間軸" type="range" min={0} max={timelineEnd} value={currentSec} onChange={(event) => seek(Number(event.target.value))} className="h-2 w-full cursor-pointer accent-blue-600" />
        <div className="relative mt-1 h-7">{sortedEvents.map((event, index) => <button key={`${event.eventType}-${index}`} type="button" aria-label={`${clock(event.triggerSec)} ${event.title}`} title={`${clock(event.triggerSec)} ${event.title}`} onClick={() => seek(event.triggerSec)} style={{ left: `${(event.triggerSec / timelineEnd) * 100}%` }} className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-fuchsia-500 shadow ring-1 ring-fuchsia-300" />)}</div>
      </div>
    </div>
  );

  const preview = <><div className="mb-3 flex rounded-xl bg-slate-100 p-1" role="group" aria-label="預覽視角"><button type="button" aria-pressed={perspective === "viewer"} onClick={() => setPerspective("viewer")} className={`flex-1 rounded-lg px-2 py-2 text-xs font-bold ${perspective === "viewer" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>一般觀眾視角</button><button type="button" aria-pressed={perspective === "winner"} onClick={() => setPerspective("winner")} className={`flex-1 rounded-lg px-2 py-2 text-xs font-bold ${perspective === "winner" ? "bg-white text-fuchsia-700 shadow-sm" : "text-slate-500"}`}>得獎者視角</button></div><Phone title={liveTitle} thumbnailUrl={thumbnailUrl} event={activeEvent} product={activeProduct} perspective={perspective} remaining={remaining} currentSec={currentSec} animationKey={animationKey} />{controls}</>;

  return (
    <>
      <aside aria-label="即時手機預覽" className="hidden lg:sticky lg:top-6 lg:block lg:self-start">{preview}</aside>
      <button type="button" onClick={() => setIsDrawerOpen(true)} className="fixed bottom-5 right-5 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-bold text-white shadow-2xl lg:hidden"><Eye size={18} />預覽手機效果</button>
      {isDrawerOpen ? <div className="fixed inset-0 z-50 bg-slate-950/55 p-3 backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true" aria-label="手機效果預覽抽屜"><div className="ml-auto h-full w-full max-w-sm overflow-y-auto rounded-3xl bg-slate-50 p-4"><button type="button" onClick={() => setIsDrawerOpen(false)} aria-label="關閉手機預覽" className="mb-3 ml-auto grid h-10 w-10 place-items-center rounded-full bg-white text-slate-700 shadow"><X size={18} /></button>{preview}</div></div> : null}
    </>
  );
}
