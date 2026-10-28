"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  Anchor, BadgeCheck, BookOpen, ChartLine, Check, ChevronDown, CirclePlay, Clock, Compass, Gem, GraduationCap, Heart, Leaf, Lightbulb, Mail, Menu, MessageCircle,
  Mountain, Pause, Play, Rocket, Sailboat, ShieldCheck, Sparkles, Star, Target, Trophy, Users, X, ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  FUNNEL_SHOWCASE_DEFAULT_ACCENT, formatShowcaseStat, showcaseAccentParts, showcaseCards, showcaseReadableOn, showcaseChoice, showcaseColor, showcaseDividerPath, showcaseIconItems, showcaseLogoFilter, showcaseLogoItems, showcaseNavItems,
  showcaseNumber, showcaseSocialLinks, showcaseStatItems, showcaseTestimonialRows, showcaseTestimonials, showcaseText, showcaseVideos, youtubeNoCookieEmbedUrl,
  SHOWCASE_DIVIDER_SHAPES, SHOWCASE_LOGO_TONES, SHOWCASE_SOCIAL_LABELS, type ShowcaseCard, type ShowcaseIcon, type ShowcaseSocialNetwork, type ShowcaseTestimonial, type ShowcaseVideo,
} from "@/lib/funnel-showcase";
import { safeContentAssetUrl, safeContentHref } from "@/lib/safe-url";
import { funnelFluidGridColumns, funnelHeadingLevel, funnelTypographyDefaults, type FunnelHeadingLevel, type FunnelTypographyTokens, type FunnelTypographyViewport } from "@/lib/funnel-typography";

export const FUNNEL_SHOWCASE_ACCENT = FUNNEL_SHOWCASE_DEFAULT_ACCENT;

type Viewport = FunnelTypographyViewport;
export type ShowcaseElementProps = {
  props: Record<string, unknown>;
  tokens: FunnelTypographyTokens;
  viewport: Viewport;
  /** Editor canvases keep everything static and never start playback. */
  interactive: boolean;
  /** The node sets its own text colour, so headings inherit it instead of the page heading colour. */
  inheritColor: boolean;
  /** Effective text alignment of the element (node style, else page setting). */
  align: "left" | "center" | "right" | "justify";
};

/** Avoids a lone CJK character on the last line of short paragraphs. */
const PRETTY: CSSProperties = { textWrap: "pretty" };
const accentOf = (props: Record<string, unknown>) => showcaseColor(props.accentColor) ?? FUNNEL_SHOWCASE_ACCENT;
const mobileOf = (viewport: Viewport) => viewport === "mobile";

const subscribeReducedMotion = (callback: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
/** Server and first client render assume motion is allowed; the effect-driven parts re-check before animating. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches), () => false);
}

function headingStyle(level: FunnelHeadingLevel, tokens: FunnelTypographyTokens, inheritColor: boolean, extra: CSSProperties = {}): CSSProperties {
  return { ...funnelTypographyDefaults(level, tokens), ...(inheritColor ? { color: "inherit" } : {}), ...extra };
}

function Heading({ level, style, children, id }: { level: FunnelHeadingLevel; style: CSSProperties; children: ReactNode; id?: string }) {
  switch (level) {
    case "h1": return <h1 id={id} className="whitespace-pre-line" style={style}>{children}</h1>;
    case "h3": return <h3 id={id} className="whitespace-pre-line" style={style}>{children}</h3>;
    case "h4": return <h4 id={id} className="whitespace-pre-line" style={style}>{children}</h4>;
    default: return <h2 id={id} className="whitespace-pre-line" style={style}>{children}</h2>;
  }
}

/** Desktop `count` columns, tablet at most 2 (I-1), mobile 1. */
const columnCount = (count: number, viewport: Viewport, max = 4) => {
  const wanted = Math.min(Math.max(count, 1), max);
  return mobileOf(viewport) ? 1 : viewport === "tablet" ? Math.min(wanted, 2) : wanted;
};
const gridColumns = (count: number, viewport: Viewport, max = 4): CSSProperties => {
  const gap = mobileOf(viewport) ? 20 : viewport === "tablet" ? 24 : 28;
  return { display: "grid", gap, gridTemplateColumns: funnelFluidGridColumns(columnCount(count, viewport, max), gap) };
};

/* ------------------------------ 區塊標題組 ------------------------------ */

export function SectionTitleElement({ props, tokens, viewport, inheritColor, align }: ShowcaseElementProps) {
  const accent = accentOf(props);
  const level = funnelHeadingLevel(props.level);
  const eyebrow = showcaseText(props.eyebrow, 120);
  const title = showcaseText(props.title, 240) || "區塊標題";
  const subtitle = showcaseText(props.subtitle, 600);
  const line = props.decoration !== "none";
  const mobile = mobileOf(viewport);
  const inline = align === "center" ? "auto" : align === "right" ? "auto 0" : 0;
  return <div className="grid" style={{ gap: mobile ? 10 : 14 }}>
    {eyebrow ? <p style={{ fontFamily: tokens.headingFont, color: accent, fontSize: mobile ? 15 : 18, letterSpacing: "0.22em", lineHeight: 1.4, fontStyle: props.eyebrowItalic === true ? "italic" : undefined, textTransform: "uppercase", margin: 0 }}>{eyebrow}</p> : null}
    <Heading level={level} style={headingStyle(level, tokens, inheritColor, { letterSpacing: "0.04em" })}>{showcaseAccentParts(title).map((part, index) => part.accent ? <span key={index} style={{ color: accent }}>{part.text}</span> : part.text)}</Heading>
    {line ? <span aria-hidden style={{ display: "block", width: 56, height: 2, backgroundColor: accent, marginTop: 4, marginInline: inline }} /> : null}
    {subtitle ? <p className="whitespace-pre-line" style={{ ...funnelTypographyDefaults("lead", tokens), ...PRETTY, opacity: 0.86, maxWidth: "46em", marginInline: inline }}>{subtitle}</p> : null}
  </div>;
}

/* ------------------------------ 圖示重點 ------------------------------ */

const ICONS: Readonly<Record<ShowcaseIcon, typeof Check>> = {
  spark: Sparkles, target: Target, compass: Compass, book: BookOpen, chart: ChartLine, users: Users, heart: Heart, shield: ShieldCheck, clock: Clock, star: Star, check: Check,
  trophy: Trophy, lightbulb: Lightbulb, rocket: Rocket, play: CirclePlay, message: MessageCircle, gem: Gem, leaf: Leaf, anchor: Anchor, sail: Sailboat, cap: GraduationCap, mountain: Mountain,
};

export function IconListElement({ props, tokens, viewport, inheritColor }: ShowcaseElementProps) {
  const accent = accentOf(props);
  const items = showcaseIconItems(props.items);
  const numbered = props.numbered !== false;
  const columns = props.layout === "grid" ? showcaseNumber(props.columns, 1, 4, 2) : 1;
  const mobile = mobileOf(viewport);
  const list = items.length ? items : [{ icon: "check" as const, title: "重點標題", text: "在屬性面板新增重點與說明。" }];
  return <ol className="m-0 list-none p-0" style={{ ...gridColumns(columns, viewport), gap: mobile ? 22 : 30 }}>
    {list.map((item, index) => {
      const Icon = ICONS[item.icon];
      return <li key={`${index}-${item.title}`} className="flex items-start" style={{ gap: mobile ? 14 : 20 }}>
        <span aria-hidden className="relative grid shrink-0 place-items-center rounded-full" style={{ width: mobile ? 48 : 56, height: mobile ? 48 : 56, border: `1px solid ${accent}`, color: accent }}>
          <Icon size={mobile ? 20 : 24} strokeWidth={1.5} />
          {numbered ? <span className="absolute -top-1.5 -right-2 rounded-full px-1.5 text-[11px] leading-5 font-bold" style={{ backgroundColor: accent, color: showcaseReadableOn(accent), fontFamily: tokens.bodyFont }}>{String(index + 1).padStart(2, "0")}</span> : null}
        </span>
        <div className="grid min-w-0" style={{ gap: 6 }}>
          {item.title ? <h3 style={headingStyle("h4", tokens, inheritColor, { letterSpacing: "0.03em" })}>{numbered ? <span className="sr-only">{`第 ${index + 1} 點：`}</span> : null}{item.title}</h3> : null}
          {item.text ? <p className="whitespace-pre-line" style={{ ...PRETTY, margin: 0, opacity: 0.86 }}>{item.text}</p> : null}
        </div>
      </li>;
    })}
  </ol>;
}

/* ------------------------------ 數據統計 ------------------------------ */

/**
 * Count-up for a stat. Renders the final value first (server, no-JS, reduced
 * motion, thumbnails); only a number the observer first reports below the
 * viewport drops to 0 and counts up once it scrolls into view.
 */
function useCountUp(target: number | null, decimals: number, enabled: boolean, ref: React.RefObject<HTMLElement | null>) {
  const [frame, setFrame] = useState<{ target: number | null; value: number } | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || target === null || !element || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let animation = 0;
    let armed = false;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      if (!entry.isIntersecting) {
        const viewport = entry.rootBounds?.height ?? window.innerHeight;
        if (!armed && entry.boundingClientRect.top >= viewport) { armed = true; setFrame({ target, value: 0 }); }
        return;
      }
      observer.disconnect();
      if (!armed) return;
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / 1_600);
        const eased = 1 - (1 - progress) ** 3;
        setFrame(progress >= 1 ? null : { target, value: Number((target * eased).toFixed(decimals)) });
        if (progress < 1) animation = requestAnimationFrame(step);
      };
      animation = requestAnimationFrame(step);
    }, { threshold: 0.3 });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(animation); setFrame(null); };
  }, [target, decimals, enabled, ref]);
  return frame && frame.target === target ? frame.value : target;
}

function StatValue({ stat, accent, tokens, viewport, animate }: { stat: ReturnType<typeof showcaseStatItems>[number]; accent: string; tokens: FunnelTypographyTokens; viewport: Viewport; animate: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const grouped = stat.display.includes(",") || (stat.value !== null && stat.value >= 10_000);
  const current = useCountUp(stat.value, stat.decimals, animate, ref);
  const shown = stat.value === null || current === null ? stat.display : formatShowcaseStat(current, stat.decimals, grouped);
  const final = `${stat.prefix}${stat.value === null ? stat.display : formatShowcaseStat(stat.value, stat.decimals, grouped)}${stat.suffix}`;
  return <span ref={ref} className="block" style={{ fontFamily: tokens.headingFont, color: accent, fontSize: mobileOf(viewport) ? 40 : 56, fontWeight: 600, lineHeight: 1.1, letterSpacing: "0.02em", fontVariantNumeric: "tabular-nums" }}>
    <span aria-hidden>{stat.prefix}{shown}<span style={{ fontSize: "0.5em", marginLeft: "0.15em" }}>{stat.suffix}</span></span>
    <span className="sr-only">{final}</span>
  </span>;
}

export function StatsElement({ props, tokens, viewport, interactive }: ShowcaseElementProps) {
  const accent = accentOf(props);
  const stats = showcaseStatItems(props.items);
  const list = stats.length ? stats : [{ value: 100, display: "100", decimals: 0, prefix: "", suffix: "+", label: "在屬性面板設定數字與說明" }];
  const mobile = mobileOf(viewport);
  const framed = props.framed === true;
  const animate = interactive && props.animate !== false;
  // Desktop: one row with dividers. Tablet: a container-aware grid (each stat ≥ 240px), so no dividers.
  const fluid = viewport === "tablet" && list.length > 1;
  const columns = mobile ? "minmax(0, 1fr)" : fluid ? funnelFluidGridColumns(list.length, 24) : `repeat(${list.length}, minmax(0, 1fr))`;
  const grid = <dl className="m-0" style={{ display: "grid", gridTemplateColumns: columns, gap: mobile ? 28 : fluid ? "32px 24px" : 0 }}>
    {list.map((stat, index) => <div key={`${index}-${stat.label}`} className="grid content-start text-center" style={{ gap: 10, paddingInline: mobile || fluid ? 0 : 24, borderLeft: !mobile && !fluid && index > 0 ? `1px solid ${accent}55` : undefined }}>
      <dt className="sr-only">{stat.label || `數據 ${index + 1}`}</dt>
      <dd className="m-0 grid" style={{ gap: 10 }}>
        <StatValue stat={stat} accent={accent} tokens={tokens} viewport={viewport} animate={animate} />
        {stat.label ? <span aria-hidden className="whitespace-pre-line" style={{ fontSize: mobile ? 15 : 16, letterSpacing: "0.06em", opacity: 0.9 }}>{stat.label}</span> : null}
      </dd>
    </div>)}
  </dl>;
  if (!framed) return grid;
  return <GoldFrame accent={accent} padding={mobile ? "36px 22px" : "56px 40px"}>{grid}</GoldFrame>;
}

/** 1px gold border with a thinner inset line, the frame shared by stats and CTA boxes. */
export function GoldFrame({ accent, padding, children, background }: { accent: string; padding: string; children: ReactNode; background?: string }) {
  return <div className="relative" style={{ border: `1px solid ${accent}`, padding, backgroundColor: background }}>
    <span aria-hidden className="pointer-events-none absolute" style={{ inset: 8, border: `1px solid ${accent}66` }} />
    <div className="relative">{children}</div>
  </div>;
}

/* ------------------------------ Logo 列 ------------------------------ */

export function LogoStripElement({ props, viewport }: ShowcaseElementProps) {
  const logos = showcaseLogoItems(props.items);
  const tone = showcaseChoice(props.tone, SHOWCASE_LOGO_TONES, "grayscale");
  const height = showcaseNumber(props.logoHeight, 16, 120, 36);
  const mobile = mobileOf(viewport);
  const caption = showcaseText(props.title, 120);
  const filter = showcaseLogoFilter(tone);
  return <div className="grid" style={{ gap: mobile ? 18 : 24 }}>
    {caption ? <p style={{ margin: 0, fontSize: 13, letterSpacing: "0.24em", textTransform: "uppercase", opacity: 0.75, textAlign: "center" }}>{caption}</p> : null}
    {logos.length ? <ul className="m-0 flex list-none flex-wrap items-center justify-center p-0" style={{ columnGap: mobile ? 28 : 56, rowGap: mobile ? 18 : 24 }}>
      {logos.map((logo, index) => {
        const image = <img src={logo.src} alt={logo.alt} loading="lazy" style={{ height: mobile ? Math.round(height * 0.8) : height, width: "auto", maxWidth: mobile ? 120 : 180, objectFit: "contain", filter, opacity: tone === "original" ? 1 : 0.82 }} />;
        return <li key={`${index}-${logo.src}`}>{logo.href ? <a href={logo.href} target="_blank" rel="noopener noreferrer" className="block rounded transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-4">{image}</a> : image}</li>;
      })}
    </ul> : <p className="text-center text-sm opacity-70">尚未加入 Logo，請在屬性面板上傳或填入圖片網址。</p>}
  </div>;
}

/* ------------------------------ 分隔形狀 ------------------------------ */

export function ShapeDividerElement({ props, viewport }: ShowcaseElementProps) {
  const shape = showcaseChoice(props.shape, SHOWCASE_DIVIDER_SHAPES, "triangle");
  const position = props.position === "bottom" ? "bottom" : "top";
  const height = showcaseNumber(props.height, 8, 240, mobileOf(viewport) ? 36 : 64);
  return <svg aria-hidden focusable="false" viewBox="0 0 1200 100" preserveAspectRatio="none" style={{ display: "block", width: "100%", height, transform: props.flip === true ? "scaleX(-1)" : undefined }}>
    <path d={showcaseDividerPath(shape, position)} fill="currentColor" />
  </svg>;
}

/* ------------------------------ 圖片卡片 ------------------------------ */

const ASPECTS: Readonly<Record<string, string>> = { "4:3": "4 / 3", "1:1": "1 / 1", "3:4": "3 / 4", "16:9": "16 / 9" };

function CornerMarks({ accent, size }: { accent: string; size: number }) {
  const base: CSSProperties = { position: "absolute", width: size, height: size, backgroundColor: accent, pointerEvents: "none" };
  return <>
    <span aria-hidden style={{ ...base, top: 0, left: 0, clipPath: "polygon(0 0, 100% 0, 0 100%)" }} />
    <span aria-hidden style={{ ...base, right: 0, bottom: 0, clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }} />
  </>;
}

function CardImage({ card, aspect, accent, corners, mobile }: { card: ShowcaseCard; aspect: string; accent: string; corners: boolean; mobile: boolean }) {
  return <div className="relative overflow-hidden" style={{ aspectRatio: aspect, backgroundColor: "rgba(127, 127, 127, 0.18)" }}>
    {card.src ? <img src={card.src} alt={card.alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" /> : null}
    {corners ? <CornerMarks accent={accent} size={mobile ? 22 : 30} /> : null}
  </div>;
}

export function ImageCardsElement({ props, tokens, viewport, inheritColor }: ShowcaseElementProps) {
  const accent = accentOf(props);
  const cards = showcaseCards(props.items);
  const columns = showcaseNumber(props.columns, 1, 4, 3);
  const aspect = ASPECTS[showcaseText(props.aspect)] ?? "4 / 3";
  const corners = props.corners !== false;
  const mobile = mobileOf(viewport);
  const list = cards.length ? cards : [{ src: "/placeholder.svg", alt: "", title: "卡片標題", text: "在屬性面板新增卡片。", href: null, linkLabel: "", category: "", date: "" }];
  return <ul className="m-0 list-none p-0" style={gridColumns(columns, viewport)}>
    {list.map((card, index) => <li key={`${index}-${card.title}`} className="group grid content-start" style={{ gap: mobile ? 14 : 18 }}>
      <CardImage card={card} aspect={aspect} accent={accent} corners={corners} mobile={mobile} />
      {card.title ? <h3 style={headingStyle("h4", tokens, inheritColor, { letterSpacing: "0.04em" })}>{card.title}</h3> : null}
      {card.text ? <p className="whitespace-pre-line" style={{ ...PRETTY, margin: 0, opacity: 0.85 }}>{card.text}</p> : null}
      {card.href ? <a href={card.href} className="inline-flex w-fit items-center gap-2 text-sm font-semibold tracking-[0.12em] underline-offset-4 hover:underline" style={{ color: accent }}>{card.linkLabel || "了解更多"}<span aria-hidden>→</span></a> : null}
    </li>)}
  </ul>;
}

/* ------------------------------ 文章卡片 ------------------------------ */

export function ContentCardsElement({ props, tokens, viewport }: ShowcaseElementProps) {
  const accent = accentOf(props);
  const cards = showcaseCards(props.items);
  const columns = showcaseNumber(props.columns, 1, 4, 3);
  const cardColor = showcaseColor(props.cardColor) ?? "#ffffff";
  const cardText = showcaseColor(props.cardTextColor) ?? "#1f2937";
  const mobile = mobileOf(viewport);
  const list = cards.length ? cards : [{ src: "/placeholder.svg", alt: "", title: "文章標題", text: "在屬性面板新增文章。", href: null, linkLabel: "", category: "分類", date: "" }];
  return <ul className="m-0 list-none p-0" style={gridColumns(columns, viewport)}>
    {list.map((card, index) => {
      const titleId = `content-card-${index}`;
      return <li key={`${index}-${card.title}`}><article aria-labelledby={titleId} className="group flex h-full flex-col overflow-hidden" style={{ backgroundColor: cardColor, color: cardText, boxShadow: "0 10px 30px rgba(15, 15, 15, 0.08)" }}>
        <CardImage card={card} aspect="16 / 10" accent={accent} corners={false} mobile={mobile} />
        <div className="flex flex-1 flex-col" style={{ gap: 12, padding: mobile ? 20 : 24 }}>
          {card.category || card.date ? <p className="m-0 flex flex-wrap items-center gap-3 text-sm">
            {card.category ? <span className="px-2.5 py-1 font-bold tracking-[0.08em]" style={{ backgroundColor: accent, color: showcaseReadableOn(accent) }}>{card.category}</span> : null}
            {card.date ? <span style={{ opacity: 0.85 }}>{card.date}</span> : null}
          </p> : null}
          <h3 id={titleId} className="line-clamp-2" style={{ ...funnelTypographyDefaults("h4", tokens), ...PRETTY, color: "inherit" }}>{card.href ? <a href={card.href} className="underline-offset-4 hover:underline">{card.title}</a> : card.title}</h3>
          {card.text ? <p className="m-0 line-clamp-3" style={{ ...PRETTY, opacity: 0.85, fontSize: "0.95em" }}>{card.text}</p> : null}
          {card.href ? <a href={card.href} aria-hidden tabIndex={-1} className="mt-auto inline-flex w-fit items-center gap-2 pt-2 text-sm font-bold tracking-[0.2em]" style={{ color: cardText }}>{card.linkLabel || "READ MORE"}<span style={{ color: accent }}>→</span></a> : null}
        </div>
      </article></li>;
    })}
  </ul>;
}

/* ------------------------------ 影片牆 ------------------------------ */

function VideoTile({ video, accent, interactive, mobile }: { video: ShowcaseVideo; accent: string; interactive: boolean; mobile: boolean }) {
  const [playing, setPlaying] = useState(false);
  const label = video.title || "影片";
  if (playing && video.youtubeId) {
    return <div className="relative overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
      <iframe src={youtubeNoCookieEmbedUrl(video.youtubeId)} title={label} className="absolute inset-0 h-full w-full border-0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" />
    </div>;
  }
  const face = <>
    {video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" /> : null}
    <span aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.7) 100%)" }} />
    <span aria-hidden className="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-transform group-hover:scale-110 motion-reduce:transition-none" style={{ width: mobile ? 56 : 68, height: mobile ? 56 : 68, backgroundColor: "rgba(0,0,0,0.55)", border: `2px solid ${accent}`, color: accent }}><Play size={mobile ? 22 : 26} fill="currentColor" /></span>
  </>;
  const tileClass = "group relative block w-full overflow-hidden bg-neutral-800 text-left focus-visible:outline-2 focus-visible:outline-offset-4";
  const tileStyle: CSSProperties = { aspectRatio: "16 / 9", outlineColor: accent };
  const caption = video.title ? <p className="m-0 mt-3 font-semibold" style={{ letterSpacing: "0.03em" }}>{video.title}</p> : null;
  // Not `disabled` on the editor canvas: a disabled control swallows the click that selects the element.
  if (video.youtubeId) return <div><button type="button" aria-label={`播放影片：${label}`} onClick={() => { if (interactive) setPlaying(true); }} className={`${tileClass} cursor-pointer`} style={tileStyle}>{face}</button>{caption}</div>;
  if (video.href) return <div><a href={video.href} target="_blank" rel="noopener noreferrer" aria-label={`在新分頁觀看：${label}`} className={tileClass} style={tileStyle}>{face}</a>{caption}</div>;
  return <div><div role="img" aria-label={`${label}（尚未設定影片網址）`} className={tileClass} style={tileStyle}>{face}</div>{caption}</div>;
}

export function VideoGalleryElement({ props, viewport, interactive }: ShowcaseElementProps) {
  const accent = accentOf(props);
  const videos = showcaseVideos(props.items);
  const columns = showcaseNumber(props.columns, 1, 4, 3);
  const mobile = mobileOf(viewport);
  const list = videos.length ? videos : [{ title: "在屬性面板貼上 YouTube 網址", youtubeId: null, href: null, thumbnail: null }];
  return <ul className="m-0 list-none p-0" style={gridColumns(columns, viewport)}>
    {list.map((video, index) => <li key={`${index}-${video.title}`}><VideoTile video={video} accent={accent} interactive={interactive} mobile={mobile} /></li>)}
  </ul>;
}

/* ------------------------------ 評價牆 ------------------------------ */

function Stars({ rating, accent }: { rating: number; accent: string }) {
  return <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} 顆星（滿分 5 顆）`}>
    {Array.from({ length: 5 }, (_, index) => <Star key={index} size={15} aria-hidden strokeWidth={1.5} style={{ color: accent }} fill={index < rating ? "currentColor" : "none"} />)}
  </span>;
}

function TestimonialCard({ item, accent, cardColor, cardText, width, showRating }: { item: ShowcaseTestimonial; accent: string; cardColor: string; cardText: string; width: number | "auto"; showRating: boolean }) {
  const initial = item.name.slice(0, 1) || "★";
  // In grid / carousel layouts (width "auto") the card fills its column, may shrink and shows the full text.
  const fluid = width === "auto";
  return <article className={`flex flex-col${fluid ? " min-w-0" : " shrink-0"}`} style={{ width, gap: 12, padding: 24, backgroundColor: cardColor, color: cardText, border: `1px solid ${accent}40`, overflowWrap: "anywhere" }}>
    <div className="flex items-center gap-3">
      {item.avatar ? <img src={item.avatar} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-bold" style={{ backgroundColor: accent, color: showcaseReadableOn(accent) }}>{initial}</span>}
      <div className="min-w-0">
        <p className="m-0 flex items-center gap-1.5 font-bold">{item.name || "學員"}{item.verified ? <BadgeCheck size={16} role="img" aria-label="已驗證" style={{ color: accent }} /> : null}</p>
        {item.date ? <p className="m-0 text-sm" style={{ opacity: 0.8 }}>{item.date}</p> : null}
      </div>
    </div>
    {showRating ? <Stars rating={item.rating} accent={accent} /> : null}
    {item.title ? <h3 className="m-0 text-base font-bold" style={{ lineHeight: 1.45 }}>{item.title}</h3> : null}
    {item.text ? <p className={`m-0 whitespace-pre-line text-sm${fluid ? "" : " line-clamp-5"}`} style={{ ...PRETTY, lineHeight: 1.75, opacity: 0.9 }}>{item.text}</p> : null}
  </article>;
}

/** C-13 carousel: one page of 1 (mobile) / 2 (tablet) / 3 (desktop) cards, buttons and dots are keyboard operable, no autoplay. */
function TestimonialCarousel({ items, perPage, accent, cardColor, cardText, showRating, label }: { items: ShowcaseTestimonial[]; perPage: number; accent: string; cardColor: string; cardText: string; showRating: boolean; label: string }) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const [page, setPage] = useState(0);
  const current = Math.min(page, pages - 1);
  const regionId = useId();
  const go = (next: number) => setPage(((next % pages) + pages) % pages);
  const button = "grid h-11 w-11 cursor-pointer place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
  return <section aria-roledescription="輪播" aria-label={label} className="grid gap-5" onKeyDown={(event) => { if (event.key === "ArrowRight") go(current + 1); if (event.key === "ArrowLeft") go(current - 1); }}>
    <div id={regionId} aria-live="polite" className="grid" style={{ gap: 20, gridTemplateColumns: `repeat(${perPage}, minmax(0, 1fr))` }}>
      {items.slice(current * perPage, current * perPage + perPage).map((item, index) => <div key={`${current}-${index}`} role="group" aria-roledescription="投影片" aria-label={`第 ${current * perPage + index + 1} 則，共 ${items.length} 則`} className="grid"><TestimonialCard item={item} accent={accent} cardColor={cardColor} cardText={cardText} width="auto" showRating={showRating} /></div>)}
    </div>
    {pages > 1 ? <div className="flex items-center justify-center gap-3">
      <button type="button" aria-controls={regionId} aria-label="上一組評價" onClick={() => go(current - 1)} className={button} style={{ border: `1px solid ${accent}`, color: accent, outlineColor: accent }}><ChevronLeft size={20} aria-hidden /></button>
      <div className="flex items-center" role="group" aria-label="選擇評價頁">
        {Array.from({ length: pages }, (_, index) => <button key={index} type="button" aria-controls={regionId} aria-label={`第 ${index + 1} 組`} aria-current={index === current ? "true" : undefined} onClick={() => go(index)} className="grid h-11 w-8 cursor-pointer place-items-center focus-visible:outline-2" style={{ outlineColor: accent }}>
          <span aria-hidden className="block rounded-full" style={{ width: index === current ? 22 : 8, height: 8, backgroundColor: index === current ? accent : `${accent}66` }} />
        </button>)}
      </div>
      <button type="button" aria-controls={regionId} aria-label="下一組評價" onClick={() => go(current + 1)} className={button} style={{ border: `1px solid ${accent}`, color: accent, outlineColor: accent }}><ChevronRight size={20} aria-hidden /></button>
    </div> : null}
  </section>;
}

const MARQUEE_SECONDS_PER_CARD: Readonly<Record<string, number>> = { slow: 9, normal: 6, fast: 4 };

export function TestimonialWallElement({ props, viewport, interactive }: ShowcaseElementProps) {
  const accent = accentOf(props);
  const items = showcaseTestimonials(props.items);
  const reducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const regionId = useId();
  const mobile = mobileOf(viewport);
  const rows = showcaseTestimonialRows(items, props.rows === 1 || mobile ? 1 : 2);
  const animated = interactive && props.autoplay !== false && !reducedMotion && items.length > 1;
  const cardColor = showcaseColor(props.cardColor) ?? "#161616";
  const cardText = showcaseColor(props.cardTextColor) ?? "#f5f1e8";
  const width = mobile ? 280 : 340;
  const showRating = props.showRating !== false;
  const perCard = MARQUEE_SECONDS_PER_CARD[showcaseText(props.speed)] ?? MARQUEE_SECONDS_PER_CARD.normal!;
  if (!items.length) return <p className="text-center text-sm opacity-70">尚未加入評價，請在屬性面板新增。</p>;
  // C-13: "grid" lays cards out in columns, "carousel" pages through them with buttons and dots (never autoplays).
  if (props.layout === "grid") return <ul className="m-0 list-none p-0" style={gridColumns(showcaseNumber(props.columns, 1, 4, Math.min(items.length, 3)), viewport, 3)}>
    {items.map((item, index) => <li key={index} className="grid"><TestimonialCard item={item} accent={accent} cardColor={cardColor} cardText={cardText} width="auto" showRating={showRating} /></li>)}
  </ul>;
  if (props.layout === "carousel") return <TestimonialCarousel items={items} perPage={columnCount(3, viewport, 3)} accent={accent} cardColor={cardColor} cardText={cardText} showRating={showRating} label={showcaseText(props.ariaLabel, 120) || "學員評價"} />;
  return <div className="grid gap-4" role="region" aria-label={showcaseText(props.ariaLabel, 120) || "學員評價"} id={regionId}>
    {animated ? <div className="flex justify-end">
      <button type="button" aria-pressed={paused} aria-controls={regionId} onClick={() => setPaused((value) => !value)} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2" style={{ border: `1px solid ${accent}`, color: accent, outlineColor: accent }}>
        {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}{paused ? "繼續輪播" : "暫停輪播"}
      </button>
    </div> : null}
    {rows.map((row, rowIndex) => animated
      ? <div key={rowIndex} className="funnel-marquee overflow-hidden" data-paused={paused ? "true" : "false"} style={{ maskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)" }}>
        {/* Two identical groups (each with a trailing gap) so translating by -50% loops seamlessly; the copy is hidden from assistive tech and focus. */}
        <div className="funnel-marquee-track flex w-max" style={{ ["--funnel-marquee-duration" as string]: `${Math.max(row.length, 3) * perCard}s`, ["--funnel-marquee-direction" as string]: rowIndex % 2 ? "reverse" : "normal" } as CSSProperties}>
          <div className="flex" style={{ gap: 20, paddingRight: 20 }}>{row.map((item, index) => <TestimonialCard key={index} item={item} accent={accent} cardColor={cardColor} cardText={cardText} width={width} showRating={showRating} />)}</div>
          <div aria-hidden inert className="flex" style={{ gap: 20, paddingRight: 20 }}>{row.map((item, index) => <TestimonialCard key={index} item={item} accent={accent} cardColor={cardColor} cardText={cardText} width={width} showRating={showRating} />)}</div>
        </div>
      </div>
      : <div key={rowIndex} tabIndex={0} aria-label={`評價第 ${rowIndex + 1} 列，可左右捲動`} className="flex snap-x overflow-x-auto pb-3 focus-visible:outline-2 focus-visible:outline-offset-2" style={{ gap: 20, outlineColor: accent }}>
        {row.map((item, index) => <div key={index} className="snap-start"><TestimonialCard item={item} accent={accent} cardColor={cardColor} cardText={cardText} width={width} showRating={showRating} /></div>)}
      </div>)}
  </div>;
}

/* ------------------------------ 導覽列 ------------------------------ */

function SocialGlyph({ network }: { network: ShowcaseSocialNetwork }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  switch (network) {
    case "facebook": return <svg {...common} fill="currentColor"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4A21 21 0 0 0 14.4 4.3c-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.5V21z" /></svg>;
    case "instagram": return <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" /></svg>;
    case "youtube": return <svg {...common} fill="currentColor"><path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2 27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3z" /></svg>;
    case "x": return <svg {...common} fill="currentColor"><path d="M17.8 3h3l-6.6 7.6L22 21h-6.1l-4.8-6.2L5.6 21h-3l7.1-8.1L2.3 3h6.2l4.3 5.7zm-1.1 16.2h1.7L7.4 4.7H5.6z" /></svg>;
    case "linkedin": return <svg {...common} fill="currentColor"><path d="M4.5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM3 9h3v12H3zm6 0h2.9v1.7c.5-.9 1.6-1.9 3.4-1.9 3.1 0 3.7 2 3.7 4.7V21h-3v-6.6c0-1.6 0-3.5-2.2-3.5s-2.5 1.7-2.5 3.4V21H9z" /></svg>;
    case "line": return <svg {...common} fill="currentColor"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3 0 .7 0 1l-.1.9c0 .3-.2 1 .9.5s6-3.5 8.2-6.1A7.4 7.4 0 0 0 22 11c0-4.4-4.5-8-10-8zM8.3 13.4H6.4a.5.5 0 0 1-.5-.5V9.1a.5.5 0 0 1 1 0v3.3h1.4a.5.5 0 0 1 0 1zm2 -.5a.5.5 0 0 1-1 0V9.1a.5.5 0 0 1 1 0zm4.6 0a.5.5 0 0 1-.9.3l-1.9-2.6v2.3a.5.5 0 0 1-1 0V9.1a.5.5 0 0 1 .9-.3l1.9 2.6V9.1a.5.5 0 0 1 1 0zm3.1-2.4a.5.5 0 0 1 0 1h-1.4v.9H18a.5.5 0 0 1 0 1h-1.9a.5.5 0 0 1-.5-.5V9.1a.5.5 0 0 1 .5-.5H18a.5.5 0 0 1 0 1h-1.4v.9z" /></svg>;
    case "threads": return <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M16.5 11.2c-.3-2.4-1.9-3.6-4.2-3.6-2.6 0-4 1.8-4 4.4s1.6 4.4 4 4.4c2 0 3.5-1.1 3.5-2.8 0-1.6-1.4-2.5-3.4-2.4-1.6.1-2.6.9-2.5 2 .1 1 1.1 1.6 2.4 1.5 2.8-.2 3.9-2.6 3.9-5.3C16.2 5.6 14.4 3.5 12 3.5 7 3.5 4.5 7.3 4.5 12s2.5 8.5 7.5 8.5c3 0 5.2-1.3 6.4-3.6" /></svg>;
    default: return <Mail size={18} aria-hidden />;
  }
}

export function NavBarElement({ props, tokens, viewport, interactive }: ShowcaseElementProps) {
  const accent = accentOf(props);
  const items = showcaseNavItems(props.items);
  const socials = showcaseSocialLinks(props.socials);
  const brand = showcaseText(props.brand, 80);
  const logo = safeContentAssetUrl(props.logoSrc);
  const homeHref = safeContentHref(props.homeHref) ?? "#top";
  const ctaLabel = showcaseText(props.ctaLabel, 40);
  const ctaHref = safeContentHref(props.ctaHref);
  const logoHeight = showcaseNumber(props.logoHeight, 16, 96, 40);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const forceCompact = mobileOf(viewport);

  useEffect(() => {
    if (openIndex === null && !mobileOpen) return;
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) { setOpenIndex(null); setMobileOpen(false); } };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const trigger = openIndex !== null ? document.getElementById(`${baseId}-trigger-${openIndex}`) : document.getElementById(`${baseId}-toggle`);
      setOpenIndex(null); setMobileOpen(false); trigger?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [openIndex, mobileOpen, baseId]);

  const linkClass = "inline-flex min-h-11 items-center gap-1 px-1 text-[15px] tracking-[0.08em] transition-colors hover:text-[var(--nav-accent)] focus-visible:outline-2 focus-visible:outline-offset-2";
  const brandMark = <a href={homeHref} className="flex shrink-0 items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-4" aria-label={brand ? `${brand}首頁` : "回到頁首"}>
    {logo ? <img src={logo} alt="" style={{ height: logoHeight, width: "auto", maxWidth: 200, objectFit: "contain" }} /> : null}
    {brand ? <span style={{ fontFamily: tokens.headingFont, fontSize: forceCompact ? 18 : 21, letterSpacing: "0.14em", fontWeight: 600, whiteSpace: "nowrap" }}>{brand}</span> : null}
  </a>;
  const socialList = socials.length ? <ul className="m-0 flex list-none items-center gap-1 p-0" aria-label="社群連結">
    {socials.map((social, index) => <li key={`${social.network}-${index}`}><a href={social.href} target={social.network === "email" ? undefined : "_blank"} rel="noopener noreferrer" aria-label={SHOWCASE_SOCIAL_LABELS[social.network]} className="grid h-10 w-10 place-items-center rounded-full transition-colors hover:text-[var(--nav-accent)] focus-visible:outline-2 focus-visible:outline-offset-2"><SocialGlyph network={social.network} /></a></li>)}
  </ul> : null;
  const cta = ctaLabel && ctaHref ? <a href={ctaHref} className="inline-flex min-h-11 items-center justify-center px-5 text-sm font-bold tracking-[0.1em] transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2" style={{ backgroundColor: accent, color: showcaseReadableOn(accent) }}>{ctaLabel}</a> : null;

  return <div ref={rootRef} className="@container" style={{ ["--nav-accent" as string]: accent } as CSSProperties}>
    <div className="mx-auto flex w-full items-center gap-6" style={{ maxWidth: showcaseNumber(props.maxWidth, 600, 1600, 1200), paddingBlock: forceCompact ? 10 : 14, paddingInline: forceCompact ? 20 : 32 }}>
      {brandMark}
      <nav aria-label={showcaseText(props.ariaLabel, 80) || "主選單"} className={forceCompact ? "hidden" : "ml-auto hidden @4xl:block"}>
        <ul className="m-0 flex list-none items-center gap-6 p-0">
          {items.map((item, index) => <li key={`${index}-${item.label}`} className="relative" onMouseEnter={item.children.length && interactive ? () => setOpenIndex(index) : undefined} onMouseLeave={item.children.length && interactive ? () => setOpenIndex((current) => current === index ? null : current) : undefined}>
            {item.children.length
              ? <>
                <button type="button" id={`${baseId}-trigger-${index}`} aria-expanded={openIndex === index} aria-controls={`${baseId}-menu-${index}`} onClick={() => setOpenIndex((current) => current === index ? null : index)} className={`${linkClass} cursor-pointer`}>{item.label}<ChevronDown size={14} aria-hidden className={`transition-transform motion-reduce:transition-none ${openIndex === index ? "rotate-180" : ""}`} /></button>
                <ul id={`${baseId}-menu-${index}`} hidden={openIndex !== index} className="absolute top-full left-1/2 z-50 m-0 min-w-48 -translate-x-1/2 list-none p-2 shadow-2xl" style={{ backgroundColor: "#141414", border: `1px solid ${accent}55` }}>
                  {item.href ? <li><a href={item.href} className="block min-h-10 px-3 py-2 text-sm tracking-[0.06em] text-[#f5f1e8] hover:text-[var(--nav-accent)] focus-visible:outline-2">{item.label}總覽</a></li> : null}
                  {item.children.map((child, childIndex) => <li key={childIndex}>{child.href ? <a href={child.href} className="block min-h-10 px-3 py-2 text-sm tracking-[0.06em] text-[#f5f1e8] hover:text-[var(--nav-accent)] focus-visible:outline-2">{child.label}</a> : <span className="block px-3 py-2 text-sm text-[#f5f1e8] opacity-80">{child.label}</span>}</li>)}
                </ul>
              </>
              : item.href ? <a href={item.href} className={linkClass}>{item.label}</a> : <span className={`${linkClass} opacity-80`}>{item.label}</span>}
          </li>)}
        </ul>
      </nav>
      <div className={forceCompact ? "hidden" : "hidden @4xl:block"}>{socialList}</div>
      <div className={forceCompact ? "hidden" : "ml-auto hidden @2xl:block @4xl:ml-0"}>{cta}</div>
      <button type="button" id={`${baseId}-toggle`} aria-expanded={mobileOpen} aria-controls={`${baseId}-panel`} aria-label={mobileOpen ? "關閉選單" : "開啟選單"} onClick={() => setMobileOpen((value) => !value)}
        className={`ml-auto h-11 w-11 shrink-0 cursor-pointer place-items-center rounded focus-visible:outline-2 focus-visible:outline-offset-2 ${forceCompact ? "grid" : "grid @2xl:ml-0 @4xl:hidden"}`} style={{ border: `1px solid ${accent}80`, color: accent }}>
        {mobileOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
      </button>
    </div>
    <div id={`${baseId}-panel`} hidden={!mobileOpen} className={forceCompact ? "" : "@4xl:hidden"} style={{ borderTop: `1px solid ${accent}40` }}>
      <nav aria-label={`${showcaseText(props.ariaLabel, 80) || "主選單"}（手機）`} className="grid gap-1 px-5 py-4">
        <ul className="m-0 grid list-none gap-1 p-0">
          {items.map((item, index) => <li key={`${index}-${item.label}`}>
            {item.href ? <a href={item.href} onClick={() => setMobileOpen(false)} className="flex min-h-11 items-center text-base tracking-[0.08em] hover:text-[var(--nav-accent)] focus-visible:outline-2">{item.label}</a> : <span className="flex min-h-11 items-center text-base tracking-[0.08em]">{item.label}</span>}
            {item.children.length ? <ul className="m-0 grid list-none gap-0.5 border-l py-1 pl-4" style={{ borderColor: `${accent}55` }}>{item.children.map((child, childIndex) => <li key={childIndex}>{child.href ? <a href={child.href} onClick={() => setMobileOpen(false)} className="flex min-h-10 items-center text-sm opacity-90 hover:text-[var(--nav-accent)] focus-visible:outline-2">{child.label}</a> : <span className="flex min-h-10 items-center text-sm opacity-80">{child.label}</span>}</li>)}</ul> : null}
          </li>)}
        </ul>
        {socialList || cta ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3">{socialList}{cta}</div> : null}
      </nav>
    </div>
  </div>;
}
