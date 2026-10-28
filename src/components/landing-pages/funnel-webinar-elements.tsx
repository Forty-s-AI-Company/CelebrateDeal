"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, CircleCheck, CircleX, Clock, Copy, Download, Expand, Hourglass, Info,
  Megaphone, MonitorPlay, ShieldCheck, Ticket, TriangleAlert, X,
} from "lucide-react";
import { showcaseColor, showcaseReadableOn, showcaseText } from "@/lib/funnel-showcase";
import { safeContentAssetUrl, safeContentHref } from "@/lib/safe-url";
import { funnelFluidGridColumns, funnelTypographyDefaults, type FunnelHeadingLevel, type FunnelTypographyTokens, type FunnelTypographyViewport } from "@/lib/funnel-typography";
import {
  FUNNEL_EVENT_TBA, formatFunnelEventDate, formatFunnelEventDuration, formatFunnelEventStart, formatFunnelEventTimeRange, formatFunnelEventWeekday,
  formatFunnelTimezone, funnelEventPhase, manualFunnelEventSchedule, resolveFunnelEventFields, type FunnelEventSchedule,
} from "@/lib/funnel-event-time";
import {
  AGENDA_LAYOUTS, CALLOUT_TONES, CODE_LANGUAGES, CODE_LANGUAGE_LABELS, COUNTDOWN_SOURCES, COUNTDOWN_VARIANTS, EVENT_FACTS_LAYOUTS, GALLERY_LAYOUTS, MEDIA_FRAMES,
  SESSION_STATUS_LABELS, SPEAKER_LAYOUTS, SPEAKER_PHOTO_SHAPES, VALUE_STACK_DEFAULT_NOTE, agendaItems, calloutParagraphs, countdownParts, formatCountdownInline,
  formatCountdownSpoken, galleryImages, highlightCode, scheduleSessions, sessionStatus, speakerInitials, valueStackItems, webinarChoice, webinarLines, webinarNumber,
  webinarSpeakers, type CodeToken, type SpeakerPhotoShape, type WebinarSpeaker,
} from "@/lib/funnel-webinar-elements";
import { useFunnelEvent, useFunnelNow } from "./funnel-event-context";

/**
 * Webinar elements (C-01～C-18). Same contract as the showcase elements:
 * props-driven, no children, every prop re-validated by
 * `@/lib/funnel-webinar-elements`; dates only from the I-5 event context.
 * Each element lays itself out for desktop / tablet / mobile and has a
 * placeholder when it has no data yet.
 */
export type WebinarElementProps = {
  props: Record<string, unknown>;
  tokens: FunnelTypographyTokens;
  viewport: FunnelTypographyViewport;
  /** Preview and public pages; the editor canvas stays static. */
  interactive: boolean;
  /** The node sets its own text colour, so headings inherit it. */
  inheritColor: boolean;
  align: "left" | "center" | "right" | "justify";
};

const PRETTY: CSSProperties = { textWrap: "pretty" };
/** Element accent: explicit prop, else the page link colour (each template's primary). */
const accentOf = (props: Record<string, unknown>, tokens: FunnelTypographyTokens) => showcaseColor(props.accentColor) ?? tokens.linkColor;
const isMobile = (viewport: FunnelTypographyViewport) => viewport === "mobile";
/** Hairline in the current text colour; works on light and dark sections. */
const HAIRLINE = "color-mix(in srgb, currentColor 22%, transparent)";
const TINT = "color-mix(in srgb, currentColor 6%, transparent)";

/** Columns for a responsive card grid: desktop `count`, tablet at most 2, mobile 1. */
function responsiveColumns(count: number, viewport: FunnelTypographyViewport, max = 4): number {
  const wanted = Math.min(Math.max(Math.round(count), 1), max);
  return viewport === "mobile" ? 1 : viewport === "tablet" ? Math.min(wanted, 2) : wanted;
}
/** Container-aware: never more than `columns` tracks, each at least 240px (qa-standards L-10). */
const grid = (columns: number, gap: number): CSSProperties => ({ display: "grid", gap, gridTemplateColumns: funnelFluidGridColumns(columns, gap) });

function headingStyle(level: FunnelHeadingLevel, tokens: FunnelTypographyTokens, inheritColor: boolean, extra: CSSProperties = {}): CSSProperties {
  return { ...funnelTypographyDefaults(level, tokens), ...(inheritColor ? { color: "inherit" } : {}), ...extra };
}

function Heading({ level, style, children, id }: { level: FunnelHeadingLevel; style: CSSProperties; children: ReactNode; id?: string }) {
  switch (level) {
    case "h2": return <h2 id={id} style={style}>{children}</h2>;
    case "h4": return <h4 id={id} style={style}>{children}</h4>;
    default: return <h3 id={id} style={style}>{children}</h3>;
  }
}

/** Element title (optional `title` prop) shared by list-style elements. */
function ElementTitle({ props, tokens, inheritColor, fallbackLevel = "h3" }: { props: Record<string, unknown>; tokens: FunnelTypographyTokens; inheritColor: boolean; fallbackLevel?: FunnelHeadingLevel }) {
  const title = showcaseText(props.title, 160);
  if (!title) return null;
  const level = props.titleLevel === "h2" || props.titleLevel === "h4" ? props.titleLevel : fallbackLevel;
  return <Heading level={level} style={headingStyle(level, tokens, inheritColor)}>{title}</Heading>;
}

const subscribeReducedMotion = (callback: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches), () => false);
}

/** Schedule an element reads: the page's webinar schedule, or the element's own times (`source: "manual"`). */
function useElementSchedule(props: Record<string, unknown>): FunnelEventSchedule {
  const { schedule } = useFunnelEvent();
  return props.source === "manual" ? manualFunnelEventSchedule(schedule, props) : schedule;
}

/* ------------------------------ C-01 活動資訊列 ------------------------------ */

type Fact = { key: string; icon: typeof Clock; label: string; value: string };

export function eventFacts(schedule: FunnelEventSchedule, props: Record<string, unknown>): Fact[] {
  const start = schedule.startsAt;
  const facts: Fact[] = [];
  if (props.showDate !== false) facts.push({ key: "date", icon: CalendarDays, label: "日期", value: start ? `${formatFunnelEventDate(start, schedule.timezone)}（${formatFunnelEventWeekday(start, schedule.timezone)}）` : FUNNEL_EVENT_TBA });
  if (props.showTime !== false && start) facts.push({ key: "time", icon: Clock, label: "時間", value: `${formatFunnelEventTimeRange(schedule)}${props.showTimezone === false ? "" : `（${formatFunnelTimezone(schedule.timezone, start)}）`}` });
  const duration = props.showDuration === false ? null : formatFunnelEventDuration(schedule);
  if (duration) facts.push({ key: "duration", icon: Hourglass, label: "長度", value: duration });
  const format = showcaseText(props.formatLabel, 40);
  if (format) facts.push({ key: "format", icon: MonitorPlay, label: "形式", value: format });
  const price = showcaseText(props.priceLabel, 40);
  if (price) facts.push({ key: "price", icon: Ticket, label: "費用", value: price });
  return facts;
}

export function EventFactsElement({ props, tokens, viewport, align }: WebinarElementProps) {
  const schedule = useElementSchedule(props);
  const layout = webinarChoice(props.layout, EVENT_FACTS_LAYOUTS, "row");
  const accent = accentOf(props, tokens);
  const mobile = isMobile(viewport);
  const facts = eventFacts(schedule, props);
  const cardColor = showcaseColor(props.cardColor);
  const cardText = showcaseColor(props.cardTextColor);
  const item = (fact: Fact, compact: boolean) => {
    const Icon = fact.icon;
    return <div key={fact.key} className="flex min-w-0 items-start" style={{ gap: 10 }}>
      <Icon aria-hidden size={compact ? 18 : 20} strokeWidth={1.75} style={{ color: accent, flexShrink: 0, marginTop: 3 }} />
      <dl className="m-0 min-w-0"><dt className="font-semibold" style={{ fontSize: "max(14px, 0.8125em)", opacity: 0.8, letterSpacing: "0.04em" }}>{fact.label}</dt><dd className="m-0 font-semibold" style={{ fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{fact.value}</dd></dl>
    </div>;
  };
  if (layout === "card") {
    return <div className="grid" style={{ gap: 14, padding: mobile ? 20 : 24, borderRadius: 14, border: `1px solid ${HAIRLINE}`, backgroundColor: cardColor ?? TINT, color: cardText ?? undefined }}>
      {showcaseText(props.title, 80) ? <p className="m-0 font-bold" style={{ letterSpacing: "0.04em" }}>{showcaseText(props.title, 80)}</p> : null}
      {facts.map((fact) => item(fact, true))}
    </div>;
  }
  // row: one line on desktop (wrapping), 2×2 grid on tablet and mobile; grid: always a grid.
  const columns = layout === "grid" ? (mobile ? 2 : Math.min(facts.length, 4)) : viewport === "desktop" ? 0 : 2;
  const gridColumnCount = Math.max(1, Math.min(columns, facts.length || 1));
  const centered = props.align === "center" || align === "center";
  const container: CSSProperties = columns
    // Facts are short, so they keep a fixed 2×2 (or 1×4) grid instead of the 240px card minimum.
    // Icon and text always start-align inside a cell; a centred section centres the whole grid instead.
    ? { display: "grid", gap: mobile ? 14 : 18, gridTemplateColumns: `repeat(${gridColumnCount}, minmax(0, 1fr))`, textAlign: "left", ...(centered && !cardColor ? { width: "fit-content", maxWidth: "100%", marginInline: "auto", columnGap: mobile ? 20 : 32 } : {}) }
    : { display: "flex", flexWrap: "wrap", columnGap: 28, rowGap: 14, alignItems: "flex-start", justifyContent: centered ? "center" : undefined };
  // An odd count in a 2-column grid lets the last fact span the row instead of leaving an empty cell.
  const spanLast = gridColumnCount === 2 && facts.length % 2 === 1;
  return <div style={{ ...container, padding: cardColor ? (mobile ? 16 : 20) : undefined, borderRadius: cardColor ? 12 : undefined, backgroundColor: cardColor, color: cardText ?? undefined }} aria-label="活動資訊" role="group">
    {facts.map((fact, index) => spanLast && index === facts.length - 1 ? <div key={fact.key} style={{ gridColumn: "1 / -1" }}>{item(fact, mobile)}</div> : item(fact, mobile))}
  </div>;
}

/* ------------------------------ C-02 講者卡 ------------------------------ */

const PHOTO_ASPECT: Readonly<Record<SpeakerPhotoShape, string>> = { square: "1 / 1", portrait: "4 / 5", circle: "1 / 1" };

function SpeakerPhoto({ speaker, shape, size, from, to }: { speaker: WebinarSpeaker; shape: SpeakerPhotoShape; size?: number; from: string; to: string }) {
  const style: CSSProperties = { aspectRatio: PHOTO_ASPECT[shape], width: size ?? "100%", borderRadius: shape === "circle" ? "9999px" : 14, overflow: "hidden", flexShrink: 0 };
  if (speaker.photo) return <div style={style}><img src={speaker.photo} alt={speaker.alt} loading="lazy" className="block h-full w-full object-cover" /></div>;
  const initials = speakerInitials(speaker.name);
  return <div aria-hidden style={{ ...style, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${from}, ${to})`, color: showcaseReadableOn(from) }}>
    <span style={{ fontSize: size ? Math.max(18, Math.round(size * 0.36)) : "clamp(28px, 9vw, 64px)", fontWeight: 700, letterSpacing: "0.02em" }}>{initials}</span>
  </div>;
}

function SpeakerText({ speaker, accent, tokens, inheritColor, centered, nameLevel }: { speaker: WebinarSpeaker; accent: string; tokens: FunnelTypographyTokens; inheritColor: boolean; centered: boolean; nameLevel: FunnelHeadingLevel }) {
  return <div className="grid min-w-0 content-start" style={{ gap: 8, textAlign: centered ? "center" : undefined, justifyItems: centered ? "center" : undefined }}>
    <Heading level={nameLevel} style={headingStyle(nameLevel, tokens, inheritColor, { overflowWrap: "anywhere" })}>{speaker.name || "講者姓名"}</Heading>
    {speaker.role ? <p className="m-0 font-semibold" style={{ color: accent, fontSize: "0.9375em" }}>{speaker.role}</p> : null}
    {speaker.tags.length ? <ul className="m-0 flex list-none flex-wrap p-0" style={{ gap: 6, justifyContent: centered ? "center" : undefined }} aria-label="成就">
      {speaker.tags.map((tag) => <li key={tag} className="text-[0.875em] font-semibold" style={{ padding: "3px 10px", borderRadius: 9999, border: `1px solid ${HAIRLINE}` }}>{tag}</li>)}
    </ul> : null}
    {speaker.bio ? <p className="m-0 whitespace-pre-line" style={{ ...PRETTY, opacity: 0.88 }}>{speaker.bio}</p> : null}
    {speaker.href ? <a href={speaker.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-fit items-center font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: accent }}>{speaker.linkLabel || "了解講者"}</a> : null}
  </div>;
}

export function SpeakerProfilesElement({ props, tokens, viewport, inheritColor }: WebinarElementProps) {
  const layout = webinarChoice(props.layout, SPEAKER_LAYOUTS, "featured");
  const shape = webinarChoice(props.photoShape, SPEAKER_PHOTO_SHAPES, layout === "featured" && props.size === "small" ? "circle" : "portrait");
  const accent = accentOf(props, tokens);
  const from = showcaseColor(props.gradientFrom) ?? accent;
  const to = showcaseColor(props.gradientTo) ?? "#0f172a";
  const mobile = isMobile(viewport);
  const speakers = webinarSpeakers(props.items);
  const list = speakers.length ? speakers : [{ photo: null, alt: "", name: "講者姓名", role: "職稱｜專長", bio: "在屬性面板填入講者照片、職稱與 2–3 行簡介。", tags: [], href: null, linkLabel: "" }];
  if (layout === "featured") {
    const speaker = list[0]!;
    if (props.size === "small") {
      return <div className="grid justify-items-center" style={{ gap: 16 }}>
        <SpeakerPhoto speaker={speaker} shape={shape} size={mobile ? 88 : 96} from={from} to={to} />
        <SpeakerText speaker={speaker} accent={accent} tokens={tokens} inheritColor={inheritColor} centered nameLevel="h3" />
      </div>;
    }
    const stacked = viewport === "mobile";
    return <div style={stacked ? { display: "grid", gap: 20 } : { display: "grid", gap: viewport === "tablet" ? 28 : 48, gridTemplateColumns: "minmax(0, 5fr) minmax(0, 7fr)", alignItems: "center" }}>
      <div style={stacked ? { maxWidth: 320, width: "100%" } : undefined}><SpeakerPhoto speaker={speaker} shape={shape} from={from} to={to} /></div>
      <SpeakerText speaker={speaker} accent={accent} tokens={tokens} inheritColor={inheritColor} centered={false} nameLevel="h3" />
    </div>;
  }
  if (layout === "duo" && list.length >= 2) {
    const [first, second] = list as [WebinarSpeaker, WebinarSpeaker];
    const card = (speaker: WebinarSpeaker) => <div className="grid justify-items-center" style={{ gap: 16 }}>
      <div style={{ width: "100%", maxWidth: mobile ? 220 : 280 }}><SpeakerPhoto speaker={speaker} shape={shape} from={from} to={to} /></div>
      <SpeakerText speaker={speaker} accent={accent} tokens={tokens} inheritColor={inheritColor} centered nameLevel="h3" />
    </div>;
    const cross = <span aria-hidden className="grid place-items-center font-light" style={{ color: accent, fontSize: mobile ? 32 : 44, lineHeight: 1 }}>×</span>;
    return <div style={mobile ? { display: "grid", gap: 20 } : { display: "grid", gap: viewport === "tablet" ? 16 : 32, gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "start" }}>
      {card(first)}{cross}{card(second)}
    </div>;
  }
  const columns = responsiveColumns(webinarNumber(props.columns, 1, 4, Math.min(list.length, 3)), viewport);
  return <ul className="m-0 list-none p-0" style={grid(columns, mobile ? 28 : 32)}>
    {list.map((speaker, index) => <li key={`${index}-${speaker.name}`} className="grid content-start" style={{ gap: 16 }}>
      <SpeakerPhoto speaker={speaker} shape={shape} from={from} to={to} />
      <SpeakerText speaker={speaker} accent={accent} tokens={tokens} inheritColor={inheritColor} centered={false} nameLevel="h3" />
    </li>)}
  </ul>;
}

/* ------------------------------ C-03 議程時間軸 ------------------------------ */

export function AgendaTimelineElement({ props, tokens, viewport, inheritColor }: WebinarElementProps) {
  const layout = webinarChoice(props.layout, AGENDA_LAYOUTS, "vertical");
  const accent = accentOf(props, tokens);
  const mobile = isMobile(viewport);
  const items = agendaItems(props.items);
  const list = items.length ? items : [{ time: "20:00", title: "議程標題", text: "在屬性面板新增議程項目。", speaker: "", tag: "" }];
  const meta = (item: (typeof list)[number]) => item.speaker || item.tag ? <p className="m-0 flex flex-wrap items-center text-[0.875em]" style={{ gap: 8, opacity: 0.85 }}>
    {item.tag ? <span className="font-semibold" style={{ padding: "2px 8px", borderRadius: 6, backgroundColor: accent, color: showcaseReadableOn(accent) }}>{item.tag}</span> : null}
    {item.speaker ? <span>{item.speaker}</span> : null}
  </p> : null;
  if (layout === "cards" || layout === "steps") {
    const columns = responsiveColumns(Math.min(list.length, layout === "steps" ? 4 : 3), viewport);
    return <ol className="m-0 list-none p-0" style={grid(columns, mobile ? 16 : 24)}>
      {list.map((item, index) => <li key={`${index}-${item.title}`} className="grid content-start" style={{ gap: 10, padding: layout === "cards" ? (mobile ? 20 : 24) : 0, borderRadius: 14, border: layout === "cards" ? `1px solid ${HAIRLINE}` : undefined, backgroundColor: layout === "cards" ? (showcaseColor(props.cardColor) ?? TINT) : undefined }}>
        {layout === "steps"
          ? <span aria-hidden style={{ fontFamily: tokens.headingFont, color: accent, fontSize: mobile ? 32 : 40, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{String(index + 1).padStart(2, "0")}</span>
          : item.time ? <p className="m-0 font-bold" style={{ color: accent, fontVariantNumeric: "tabular-nums" }}>{item.time}</p> : null}
        <h3 style={headingStyle("h4", tokens, inheritColor)}>{layout === "steps" ? <span className="sr-only">{`第 ${index + 1} 步：`}</span> : null}{item.title}</h3>
        {layout === "steps" && item.time ? <p className="m-0 text-[0.875em] font-semibold" style={{ opacity: 0.85 }}>{item.time}</p> : null}
        {item.text ? <p className="m-0 whitespace-pre-line" style={{ ...PRETTY, opacity: 0.88 }}>{item.text}</p> : null}
        {meta(item)}
      </li>)}
    </ol>;
  }
  return <ol className="m-0 list-none p-0" style={{ display: "grid", gap: 0 }}>
    {list.map((item, index) => <li key={`${index}-${item.title}`} style={mobile ? { display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", columnGap: 14 } : { display: "grid", gridTemplateColumns: "112px 20px minmax(0, 1fr)", columnGap: 20 }}>
      {!mobile ? <p className="m-0 text-right font-bold" style={{ color: accent, fontVariantNumeric: "tabular-nums", paddingTop: 2 }}>{item.time}</p> : null}
      <span aria-hidden className="relative block" style={{ justifySelf: "center", width: 2, backgroundColor: index === list.length - 1 ? "transparent" : HAIRLINE }}>
        <span className="absolute left-1/2 block -translate-x-1/2 rounded-full" style={{ top: 6, width: 12, height: 12, backgroundColor: accent, boxShadow: `0 0 0 4px color-mix(in srgb, ${accent} 20%, transparent)` }} />
      </span>
      <div className="grid min-w-0 content-start" style={{ gap: 6, paddingBottom: index === list.length - 1 ? 0 : mobile ? 24 : 32 }}>
        {mobile && item.time ? <p className="m-0 font-bold" style={{ color: accent, fontVariantNumeric: "tabular-nums" }}>{item.time}</p> : null}
        <h3 style={headingStyle("h4", tokens, inheritColor)}>{item.title}</h3>
        {item.text ? <p className="m-0 whitespace-pre-line" style={{ ...PRETTY, opacity: 0.88 }}>{item.text}</p> : null}
        {meta(item)}
      </div>
    </li>)}
  </ol>;
}

/* ------------------------------ C-06 倒數 ------------------------------ */

type CountdownTarget = { target: string | null; message: string | null };

function countdownTarget(props: Record<string, unknown>, schedule: FunnelEventSchedule, now: number | null): CountdownTarget {
  const source = webinarChoice(props.source, COUNTDOWN_SOURCES, "fixed");
  const expired = showcaseText(props.expiredText, 80);
  if (source === "fixed") {
    const raw = props.targetDate ?? props.endAt ?? props.deadline;
    const time = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    return { target: Number.isFinite(time) ? new Date(time).toISOString() : null, message: expired || "已截止" };
  }
  if (source === "registration_close") return { target: schedule.registrationClosesAt, message: expired || "本場報名已截止" };
  if (!schedule.startsAt) return { target: null, message: FUNNEL_EVENT_TBA };
  const phase = now === null ? "upcoming" : funnelEventPhase(schedule, now);
  if (phase === "live") return { target: schedule.startsAt, message: showcaseText(props.liveText, 80) || "直播進行中" };
  if (phase === "replay") return { target: schedule.startsAt, message: showcaseText(props.replayText, 80) || (schedule.replayEndsAt ? `回放開放至 ${formatFunnelEventDate(schedule.replayEndsAt, schedule.timezone, { year: false })}` : "回放開放中") };
  if (phase === "ended") return { target: schedule.startsAt, message: expired || "本場已結束" };
  return { target: schedule.startsAt, message: expired || "活動已開始" };
}

type CountdownState = { label: string; status: string | null; parts: ReturnType<typeof countdownParts> | null; showSeconds: boolean; live: ReactNode };

/** Shared state of every countdown look: label, expiry/placeholder text, remaining parts and the minute-precision live region. */
function useCountdownState(props: Record<string, unknown>, interactive: boolean): CountdownState {
  const { schedule } = useFunnelEvent();
  const reduced = usePrefersReducedMotion();
  const now = useFunnelNow(reduced ? 60_000 : 1_000, interactive);
  const { target, message } = countdownTarget(props, schedule, now);
  const label = showcaseText(props.label, 60) || (props.source === "registration_close" ? "距離報名截止" : props.source === "webinar_start" ? "距離開播" : "倒數");
  const remaining = target && now !== null ? Date.parse(target) - now : null;
  const status = !target ? (message ?? "尚未設定時間") : remaining !== null && remaining <= 0 ? message : null;
  const parts = remaining !== null && remaining > 0 ? countdownParts(remaining) : null;
  const spoken = parts ? `${label} ${formatCountdownSpoken(parts)}` : status ?? "";
  // Announce only when the spoken (minute-precision) text changes.
  return { label, status, parts, showSeconds: !reduced, live: <span className="sr-only" aria-live="polite" aria-atomic="true">{spoken}</span> };
}

/**
 * Countdown (C-06). Three looks (`variant`) and three time sources
 * (`source`). Expiry shows `expiredText` and never restarts. Digits are
 * tabular; the live region announces at most once a minute. With reduced
 * motion the display updates once a minute and hides the seconds.
 */
export function CountdownElement({ props, tokens, viewport, interactive }: WebinarElementProps) {
  const state = useCountdownState(props, interactive);
  const variant = webinarChoice(props.variant, COUNTDOWN_VARIANTS, "blocks");
  const accent = accentOf(props, tokens);
  const { label, status, parts, showSeconds, live } = state;
  const clock = parts ? formatCountdownInline(parts, showSeconds) : "--:--:--";
  if (variant === "bar") {
    const background = showcaseColor(props.barColor) ?? accent;
    const text = showcaseColor(props.barTextColor) ?? showcaseReadableOn(background);
    return <div role="timer" aria-label={label} className="flex flex-wrap items-center justify-center text-center" style={{ minHeight: 44, padding: isMobile(viewport) ? "8px 16px" : "10px 24px", columnGap: 12, rowGap: 2, backgroundColor: background, color: text, fontWeight: 700, lineHeight: 1.4 }}>
      {status ? <span aria-hidden>{status}</span> : <><span aria-hidden>{label}</span><span aria-hidden style={{ fontFamily: tokens.headingFont, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>{clock}</span></>}
      {live}
    </div>;
  }
  if (variant === "inline") {
    return <p role="timer" aria-label={label} className="m-0 font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
      {status ? <span aria-hidden>{status}</span> : <><span aria-hidden>{label} </span><span aria-hidden style={{ color: showcaseColor(props.numberColor) ?? accent, fontFamily: tokens.headingFont }}>{clock}</span></>}
      {live}
    </p>;
  }
  return <CountdownBlocks props={props} tokens={tokens} viewport={viewport} state={state} />;
}

function CountdownBlocks({ props, tokens, viewport, state }: { props: Record<string, unknown>; tokens: FunnelTypographyTokens; viewport: FunnelTypographyViewport; state: CountdownState }) {
  const { label, status, parts, showSeconds, live } = state;
  const mobile = isMobile(viewport);
  const digits = (value: number | undefined) => value === undefined ? "--" : String(value).padStart(2, "0");
  const cells: Array<[string, number | undefined]> = [["天", parts?.days], ["時", parts?.hours], ["分", parts?.minutes], ...(showSeconds ? [["秒", parts?.seconds] as [string, number | undefined]] : [])];
  const numberColor = showcaseColor(props.numberColor);
  const cellBackground = showcaseColor(props.cellColor);
  return <div role="timer" aria-label={label} className="grid" style={{ gap: 10, justifyItems: props.align === "left" ? "start" : "center" }}>
    {showcaseText(props.label, 60) ? <p aria-hidden className="m-0 text-[0.875em] font-bold" style={{ letterSpacing: "0.08em" }}>{label}</p> : null}
    {status ? <p aria-hidden className="m-0 font-bold" style={{ fontSize: mobile ? 20 : 24 }}>{status}</p> : <div aria-hidden className="grid" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, ${mobile ? 76 : 104}px))`, gap: mobile ? 8 : 12 }}>
      {cells.map(([unit, value]) => <span key={unit} className="grid justify-items-center" style={{ gap: 4, padding: mobile ? "10px 4px" : "14px 6px", borderRadius: 12, backgroundColor: cellBackground ?? TINT, border: `1px solid ${HAIRLINE}` }}>
        <strong style={{ fontFamily: tokens.headingFont, fontSize: mobile ? 30 : viewport === "tablet" ? 38 : 44, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", color: numberColor ?? undefined }}>{digits(value)}</strong>
        <small className="text-[0.875em] font-semibold" style={{ opacity: 0.85 }}>{unit}</small>
      </span>)}
    </div>}
    {live}
  </div>;
}

/* ------------------------------ C-07 提示框 ------------------------------ */

const CALLOUT_STYLE = {
  info: { icon: Info, background: "#eff6ff", border: "#1d4ed8", text: "#172554", label: "說明" },
  warning: { icon: TriangleAlert, background: "#fffbeb", border: "#b45309", text: "#451a03", label: "注意" },
  compliance: { icon: ShieldCheck, background: "#f8fafc", border: "#475569", text: "#0f172a", label: "聲明" },
} as const;

export function CalloutElement({ props, tokens, viewport }: WebinarElementProps) {
  const tone = CALLOUT_STYLE[webinarChoice(props.tone, CALLOUT_TONES, "info")];
  const Icon = tone.icon;
  const title = showcaseText(props.title, 120);
  const paragraphs = calloutParagraphs(props.text);
  const mobile = isMobile(viewport);
  return <aside aria-label={title || tone.label} className="flex items-start" style={{ gap: 12, padding: mobile ? "16px 16px" : "18px 22px", borderRadius: 12, backgroundColor: tone.background, color: tone.text, borderLeft: `4px solid ${tone.border}`, textAlign: "left" }}>
    <Icon aria-hidden size={22} strokeWidth={1.9} style={{ color: tone.border, flexShrink: 0, marginTop: 2 }} />
    <div className="grid min-w-0" style={{ gap: 6 }}>
      {title ? <p className="m-0 font-bold" style={{ fontSize: "1.0625em" }}>{title}</p> : null}
      {(paragraphs.length ? paragraphs : ["在屬性面板填入提示內容，例如投資風險、醫療衛教聲明或活動注意事項。"]).map((paragraph, index) => <p key={index} className="m-0 whitespace-pre-line" style={{ ...PRETTY, fontSize: `${Math.max(16, tokens.baseSize - 1)}px`, lineHeight: 1.75, overflowWrap: "anywhere" }}>{paragraph}</p>)}
    </div>
  </aside>;
}

/* ------------------------------ C-08 適合／不適合 ------------------------------ */

export function FitCompareElement({ props, tokens, viewport, inheritColor }: WebinarElementProps) {
  const mobile = isMobile(viewport);
  const fit = webinarLines(props.fitItems, 6);
  const notFit = webinarLines(props.notFitItems, 6);
  const positive = showcaseColor(props.fitColor) ?? "#15803d";
  const negative = showcaseColor(props.notFitColor) ?? "#b91c1c";
  const column = (title: string, items: string[], good: boolean) => {
    const color = good ? positive : negative;
    const Icon = good ? CircleCheck : CircleX;
    return <div className="grid content-start" style={{ gap: 14, padding: mobile ? 20 : 28, borderRadius: 16, border: `1px solid ${HAIRLINE}`, borderTop: `4px solid ${color}`, backgroundColor: showcaseColor(props.cardColor) ?? TINT }}>
      <h3 className="flex items-center" style={headingStyle("h4", tokens, inheritColor, { gap: 10, display: "flex" })}><Icon aria-hidden size={24} style={{ color, flexShrink: 0 }} />{title}</h3>
      <ul className="m-0 grid list-none p-0" style={{ gap: 10 }}>
        {(items.length ? items : ["在屬性面板每行輸入一點"]).map((item, index) => <li key={index} className="flex items-start" style={{ gap: 10 }}>
          {good ? <Check aria-hidden size={18} strokeWidth={2.5} style={{ color, flexShrink: 0, marginTop: 5 }} /> : <X aria-hidden size={18} strokeWidth={2.5} style={{ color, flexShrink: 0, marginTop: 5 }} />}
          <span className="sr-only">{good ? "適合：" : "不適合："}</span><span style={PRETTY}>{item}</span>
        </li>)}
      </ul>
    </div>;
  };
  return <div style={grid(mobile ? 1 : 2, mobile ? 16 : 24)}>
    {column(showcaseText(props.fitTitle, 80) || "適合你，如果你…", fit, true)}
    {column(showcaseText(props.notFitTitle, 80) || "可能不適合，如果你…", notFit, false)}
  </div>;
}

/* ------------------------------ C-09 加入行事曆 ------------------------------ */

const compactUtc = (iso: string) => iso.replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");

/** Event description holds only the title and the page URL; never a personal watch link. */
export function googleCalendarUrl(schedule: FunnelEventSchedule, pageUrl: string): string | null {
  if (!schedule.startsAt) return null;
  const end = schedule.endsAt ?? new Date(Date.parse(schedule.startsAt) + 90 * 60_000).toISOString();
  const params = new URLSearchParams({ action: "TEMPLATE", text: schedule.title ?? "線上講座", dates: `${compactUtc(schedule.startsAt)}/${compactUtc(end)}`, details: pageUrl ? `活動頁面：${pageUrl}` : "", ctz: schedule.timezone });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const icsText = (value: string) => value.replace(/\\/gu, "\\\\").replace(/;/gu, "\\;").replace(/,/gu, "\\,").replace(/\r?\n/gu, "\\n");
export function icsDocument(schedule: FunnelEventSchedule, pageUrl: string, stamp: string): string | null {
  if (!schedule.startsAt) return null;
  const end = schedule.endsAt ?? new Date(Date.parse(schedule.startsAt) + 90 * 60_000).toISOString();
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CelebrateDeal//Funnel//ZH-TW", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${compactUtc(schedule.startsAt)}-${Math.abs([...pageUrl].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 7))}@celebratedeal`,
    `DTSTAMP:${compactUtc(stamp)}`, `DTSTART:${compactUtc(schedule.startsAt)}`, `DTEND:${compactUtc(end)}`,
    `SUMMARY:${icsText(schedule.title ?? "線上講座")}`, ...(pageUrl ? [`DESCRIPTION:${icsText(`活動頁面：${pageUrl}`)}`, `URL:${pageUrl}`] : []),
    "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

/** Page URL without query or hash (no tracking codes or tokens in calendar entries). */
function usePageUrl(): string {
  const [url, setUrl] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setUrl(`${window.location.origin}${window.location.pathname}`), 0); return () => window.clearTimeout(timer); }, []);
  return url;
}

export function AddToCalendarElement({ props, tokens, viewport, interactive }: WebinarElementProps) {
  const { schedule } = useFunnelEvent();
  const pageUrl = usePageUrl();
  const accent = accentOf(props, tokens);
  const mobile = isMobile(viewport);
  const google = googleCalendarUrl(schedule, pageUrl);
  const buttonClass = "inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] px-5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";
  const solid: CSSProperties = { backgroundColor: accent, color: showcaseReadableOn(accent), outlineColor: accent };
  const outline: CSSProperties = { border: `2px solid ${accent}`, color: "inherit", outlineColor: accent };
  const download = () => {
    const ics = icsDocument(schedule, pageUrl, new Date().toISOString());
    if (!ics || !interactive) return;
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "event.ics"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  if (!schedule.startsAt) return <p className="m-0 text-[0.9375em]" style={{ opacity: 0.85 }}>{showcaseText(props.pendingText, 120) || "活動時間公布後，即可加入行事曆。"}</p>;
  return <div className="flex flex-wrap" style={{ gap: 12, flexDirection: mobile ? "column" : "row", justifyContent: props.align === "center" ? "center" : undefined }}>
    {google ? <a href={google} target="_blank" rel="noopener noreferrer" className={buttonClass} style={solid}><CalendarPlus aria-hidden size={18} />{showcaseText(props.googleLabel, 40) || "加入 Google 日曆"}</a> : null}
    <button type="button" onClick={download} className={`${buttonClass} cursor-pointer`} style={outline}><Download aria-hidden size={18} />{showcaseText(props.icsLabel, 40) || "下載行事曆檔（Apple／Outlook）"}</button>
    <p className="sr-only">{`活動時間：${formatFunnelEventStart(schedule)}`}</p>
  </div>;
}

/* ------------------------------ C-10 頂部公告條 ------------------------------ */

export function AnnouncementBarElement({ props, tokens, viewport, interactive }: WebinarElementProps) {
  const background = showcaseColor(props.barColor) ?? tokens.linkColor;
  const color = showcaseColor(props.barTextColor) ?? showcaseReadableOn(background);
  const { schedule } = useFunnelEvent();
  const text = resolveFunnelEventFields(showcaseText(props.text, 160) || "在屬性面板輸入公告文字", schedule);
  const href = safeContentHref(props.href);
  const linkLabel = showcaseText(props.linkLabel, 30);
  const mobile = isMobile(viewport);
  return <div role="region" aria-label="公告" className="flex flex-wrap items-center justify-center text-center" style={{ minHeight: 44, padding: mobile ? "8px 16px" : "8px 24px", columnGap: 14, rowGap: 4, backgroundColor: background, color, fontWeight: 600, lineHeight: 1.45, fontSize: mobile ? 15 : 16 }}>
    <Megaphone aria-hidden size={18} style={{ flexShrink: 0 }} />
    <span style={{ overflowWrap: "anywhere" }}>{text}</span>
    {props.showCountdown === true ? <CountdownElement props={{ variant: "inline", source: "webinar_start", label: showcaseText(props.countdownLabel, 30) || "距離開播", accentColor: color, numberColor: color }} tokens={tokens} viewport={viewport} interactive={interactive} inheritColor align="center" /> : null}
    {href && linkLabel ? <a href={href} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color, outlineColor: color }}>{linkLabel}</a> : null}
  </div>;
}

/* ------------------------------ C-11 價值清單 ------------------------------ */

/** Display only: values are merchant text, never parsed, summed or sent to checkout. */
export function ValueStackElement({ props, tokens, viewport, inheritColor }: WebinarElementProps) {
  const accent = accentOf(props, tokens);
  const mobile = isMobile(viewport);
  const items = valueStackItems(props.items);
  const list = items.length ? items : [{ title: "內容項目", text: "在屬性面板新增項目與參考價值。", value: "NT$0" }];
  const totalLabel = showcaseText(props.totalLabel, 40) || "總價值";
  const totalValue = showcaseText(props.totalValue, 40);
  const originalPrice = showcaseText(props.originalPrice, 40);
  const offerLabel = showcaseText(props.offerLabel, 40);
  const note = showcaseText(props.note, 120) || VALUE_STACK_DEFAULT_NOTE;
  const cardColor = showcaseColor(props.cardColor);
  return <div className="grid" style={{ gap: 0, padding: mobile ? 20 : 28, borderRadius: 16, border: `1px solid ${HAIRLINE}`, backgroundColor: cardColor ?? TINT, color: showcaseColor(props.cardTextColor) ?? undefined }}>
    <ElementTitle props={props} tokens={tokens} inheritColor={inheritColor || Boolean(props.cardTextColor)} />
    <ul className="m-0 grid list-none p-0" style={{ marginTop: showcaseText(props.title) ? 12 : 0 }}>
      {list.map((item, index) => <li key={`${index}-${item.title}`} className="flex items-start justify-between" style={{ gap: 16, padding: "14px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
        <div className="grid min-w-0" style={{ gap: 4 }}>
          <p className="m-0 flex items-start font-semibold" style={{ gap: 8 }}><Check aria-hidden size={18} strokeWidth={2.5} style={{ color: accent, flexShrink: 0, marginTop: 4 }} /><span>{item.title}</span></p>
          {item.text ? <p className="m-0 text-[0.9375em]" style={{ ...PRETTY, opacity: 0.85, paddingLeft: 26 }}>{item.text}</p> : null}
        </div>
        {item.value ? <p className="m-0 shrink-0 font-semibold" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}><span className="sr-only">參考價值 </span>{item.value}</p> : null}
      </li>)}
    </ul>
    {totalValue ? <p className="m-0 flex items-center justify-between font-bold" style={{ gap: 16, padding: "16px 0 4px" }}><span>{totalLabel}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{totalValue}</span></p> : null}
    {originalPrice || offerLabel ? <p className="m-0 flex flex-wrap items-baseline justify-end" style={{ gap: 12, paddingTop: 8 }}>
      {originalPrice ? <s style={{ opacity: 0.75 }}><span className="sr-only">原價 </span>{originalPrice}</s> : null}
      {offerLabel ? <strong style={{ color: accent, fontSize: mobile ? 22 : 26, fontFamily: tokens.headingFont }}>{offerLabel}</strong> : null}
    </p> : null}
    <p className="m-0 text-[0.875em]" style={{ opacity: 0.85, paddingTop: 12 }}>{note}</p>
  </div>;
}

/* ------------------------------ C-12 場次表 ------------------------------ */

export function SessionScheduleElement({ props, tokens, viewport, interactive, inheritColor }: WebinarElementProps) {
  const { schedule } = useFunnelEvent();
  const now = useFunnelNow(60_000, interactive);
  const accent = accentOf(props, tokens);
  const mobile = isMobile(viewport);
  const sessions = scheduleSessions(props.items);
  const timezone = schedule.timezone;
  const list = sessions.length ? sessions : [{ startsAt: null, title: "第 1 堂：主題", text: "在屬性面板新增場次日期與主題。" }];
  return <ol className="m-0 grid list-none p-0" style={{ gap: 12 }}>
    {list.map((session, index) => {
      const status = now === null ? null : sessionStatus(session.startsAt, now, webinarNumber(props.durationMinutes, 15, 600, 90));
      const ended = status === "ended";
      return <li key={`${index}-${session.title}`} style={{ display: "grid", gridTemplateColumns: mobile ? "minmax(0, 1fr)" : "180px minmax(0, 1fr) auto", gap: mobile ? 6 : 20, alignItems: "center", padding: mobile ? 16 : "18px 22px", borderRadius: 14, border: `1px solid ${HAIRLINE}`, backgroundColor: TINT, opacity: ended ? 0.75 : 1 }}>
        <p className="m-0 font-bold" style={{ color: accent, fontVariantNumeric: "tabular-nums" }}>{session.startsAt ? `${formatFunnelEventDate(session.startsAt, timezone, { year: false })}（${formatFunnelEventWeekday(session.startsAt, timezone)}）${formatFunnelEventTimeRange({ startsAt: session.startsAt, endsAt: null, timezone })}` : FUNNEL_EVENT_TBA}</p>
        <div className="grid min-w-0" style={{ gap: 4 }}>
          <h3 style={headingStyle("h4", tokens, inheritColor)}>{session.title}</h3>
          {session.text ? <p className="m-0 text-[0.9375em]" style={{ ...PRETTY, opacity: 0.88 }}>{session.text}</p> : null}
        </div>
        {status ? <span className="w-fit text-[0.875em] font-bold" style={{ padding: "4px 12px", borderRadius: 9999, ...(status === "open" ? { backgroundColor: accent, color: showcaseReadableOn(accent) } : { border: `1px solid ${HAIRLINE}` }) }}>{SESSION_STATUS_LABELS[status]}</span> : null}
      </li>;
    })}
  </ol>;
}

/* ------------------------------ C-14 報名截止提示 ------------------------------ */

/** Shows the server registration deadline only; renders nothing on public pages when none is configured. */
export function DeadlineNoticeElement({ props, tokens, viewport, interactive }: WebinarElementProps) {
  const { schedule } = useFunnelEvent();
  const now = useFunnelNow(60_000, interactive);
  const accent = accentOf(props, tokens);
  const closes = schedule.registrationClosesAt;
  if (!closes) return interactive ? null : <p className="m-0 text-[0.9375em]" style={{ opacity: 0.8 }}>報名截止提示：在一頁式網站的「營運設定」開啟報名截止後才會顯示。</p>;
  const closed = now !== null && now >= Date.parse(closes);
  const label = showcaseText(props.label, 40) || "報名截止";
  const text = closed ? (showcaseText(props.closedText, 120) || "本場報名已截止") : `${label}：${formatFunnelEventDate(closes, schedule.timezone, { year: false })}（${formatFunnelEventWeekday(closes, schedule.timezone)}）${formatFunnelEventTimeRange({ startsAt: closes, endsAt: null, timezone: schedule.timezone })}`;
  return <p role="status" className="m-0 inline-flex items-center font-semibold" style={{ gap: 8, padding: isMobile(viewport) ? "8px 12px" : "8px 14px", borderRadius: 10, border: `1px solid ${accent}`, overflowWrap: "anywhere" }}>
    <Clock aria-hidden size={18} style={{ color: accent, flexShrink: 0 }} />{text}
  </p>;
}

/* ------------------------------ C-16 裝置框 ------------------------------ */

export function MediaFrameElement({ props, viewport }: WebinarElementProps) {
  const frame = webinarChoice(props.frame, MEDIA_FRAMES, "browser");
  const src = safeContentAssetUrl(props.src) ?? "/placeholder.svg";
  const alt = showcaseText(props.alt, 200);
  const mobile = isMobile(viewport);
  const screen = (aspect: string, radius: number) => <div className="relative overflow-hidden" style={{ aspectRatio: aspect, borderRadius: radius, backgroundColor: "#e2e8f0" }}><img src={src} alt={alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover object-top" /></div>;
  if (frame === "phone") {
    return <div className="mx-auto" style={{ width: "100%", maxWidth: mobile ? 240 : 280, padding: 10, borderRadius: 40, backgroundColor: "#0f172a", boxShadow: "0 20px 50px rgba(15, 23, 42, 0.25)" }}>
      <div aria-hidden className="mx-auto" style={{ width: 70, height: 6, borderRadius: 9999, backgroundColor: "#334155", margin: "4px auto 10px" }} />
      {screen("9 / 19", 28)}
    </div>;
  }
  if (frame === "laptop") {
    return <div className="mx-auto" style={{ width: "100%", maxWidth: 880 }}>
      <div style={{ padding: mobile ? 8 : 14, borderRadius: "16px 16px 0 0", backgroundColor: "#0f172a" }}>{screen("16 / 10", 4)}</div>
      <div aria-hidden style={{ height: mobile ? 10 : 16, borderRadius: "0 0 14px 14px", background: "linear-gradient(#cbd5e1, #94a3b8)", marginInline: "-4%" }} />
    </div>;
  }
  const url = showcaseText(props.url, 80);
  return <div className="overflow-hidden" style={{ borderRadius: 14, border: "1px solid #cbd5e1", backgroundColor: "#ffffff", boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)" }}>
    <div aria-hidden className="flex items-center" style={{ gap: 8, padding: "10px 14px", backgroundColor: "#f1f5f9", borderBottom: "1px solid #e2e8f0" }}>
      {["#f87171", "#fbbf24", "#34d399"].map((dot) => <span key={dot} className="block rounded-full" style={{ width: 10, height: 10, backgroundColor: dot }} />)}
      {url ? <span className="ml-2 min-w-0 flex-1 truncate rounded-md px-3 text-[13px]" style={{ backgroundColor: "#ffffff", color: "#334155", lineHeight: "24px" }}>{url}</span> : null}
    </div>
    {screen(showcaseText(props.aspect) === "4:3" ? "4 / 3" : "16 / 10", 0)}
  </div>;
}

/* ------------------------------ C-17 作品集圖庫 ------------------------------ */

export function ImageGalleryElement({ props, viewport, interactive }: WebinarElementProps) {
  const images = galleryImages(props.items);
  const layout = webinarChoice(props.layout, GALLERY_LAYOUTS, "masonry");
  const columns = responsiveColumns(webinarNumber(props.columns, 2, 4, 3), viewport);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open !== null && !dialog.open) dialog.showModal?.();
    if (open === null && dialog.open) dialog.close();
  }, [open]);
  if (!images.length) return <p className="m-0 text-center text-sm" style={{ opacity: 0.8 }}>尚未加入作品，請在屬性面板上傳圖片。</p>;
  const step = (delta: number) => setOpen((current) => current === null ? current : (current + delta + images.length) % images.length);
  const current = open === null ? null : images[open];
  const tile = (image: (typeof images)[number], index: number) => <li key={`${index}-${image.src}`} style={layout === "masonry" ? { breakInside: "avoid", marginBottom: 16 } : undefined}>
    <figure className="m-0 grid" style={{ gap: 8 }}>
      <button type="button" aria-label={`放大檢視：${image.alt || `作品 ${index + 1}`}`} onClick={(event) => { if (!interactive) return; triggerRef.current = event.currentTarget; setOpen(index); }}
        className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4" style={layout === "grid" ? { aspectRatio: "4 / 3", backgroundColor: "rgba(127, 127, 127, 0.12)" } : undefined}>
        <img src={image.src} alt={image.alt} loading="lazy" className={layout === "grid" ? "absolute inset-0 h-full w-full object-cover" : "block h-auto w-full"} />
        <span aria-hidden className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Expand size={16} /></span>
      </button>
      {image.caption ? <figcaption className="text-[0.875em]" style={{ opacity: 0.85 }}>{image.caption}</figcaption> : null}
    </figure>
  </li>;
  return <>
    <ul className="m-0 list-none p-0" style={layout === "masonry" ? { columnCount: columns, columnWidth: 220, columnGap: 16 } : grid(columns, 16)}>{images.map(tile)}</ul>
    <dialog ref={dialogRef} aria-labelledby={titleId} onClose={() => { setOpen(null); triggerRef.current?.focus(); }} onKeyDown={(event) => { if (event.key === "ArrowRight") step(1); if (event.key === "ArrowLeft") step(-1); }}
      className="m-auto max-h-[92vh] w-[min(92vw,1100px)] max-w-none overflow-hidden rounded-2xl bg-neutral-950 p-0 text-white backdrop:bg-black/80">
      {current ? <div className="grid" style={{ gap: 12, padding: 16 }}>
        <div className="flex items-center justify-between" style={{ gap: 12 }}>
          <p id={titleId} className="m-0 text-sm font-semibold">{current.caption || current.alt || `作品 ${(open ?? 0) + 1}`}<span className="ml-2 opacity-75">{`${(open ?? 0) + 1} / ${images.length}`}</span></p>
          <button type="button" onClick={() => setOpen(null)} aria-label="關閉" className="grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-white/10 focus-visible:outline-2 focus-visible:outline-white"><X size={20} aria-hidden /></button>
        </div>
        <img src={current.src} alt={current.alt} className="mx-auto block max-h-[72vh] w-auto max-w-full object-contain" />
        {images.length > 1 ? <div className="flex justify-center" style={{ gap: 12 }}>
          <button type="button" onClick={() => step(-1)} aria-label="上一張" className="grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-white/10 focus-visible:outline-2 focus-visible:outline-white"><ChevronLeft size={22} aria-hidden /></button>
          <button type="button" onClick={() => step(1)} aria-label="下一張" className="grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-white/10 focus-visible:outline-2 focus-visible:outline-white"><ChevronRight size={22} aria-hidden /></button>
        </div> : null}
      </div> : null}
    </dialog>
  </>;
}

/* ------------------------------ C-18 程式碼片段 ------------------------------ */

const TOKEN_COLORS: Readonly<Record<CodeToken["kind"], string>> = { plain: "#e2e8f0", comment: "#94a3b8", string: "#86efac", keyword: "#c4b5fd", number: "#fcd34d", tag: "#7dd3fc" };

export function CodeSnippetElement({ props, viewport, interactive }: WebinarElementProps) {
  const language = webinarChoice(props.language, CODE_LANGUAGES, "plain");
  const code = typeof props.code === "string" && props.code.trim() ? props.code.replace(/\s+$/u, "") : "// 在屬性面板貼上程式碼（只展示，不會執行）";
  const tokens = highlightCode(code, language);
  const filename = showcaseText(props.filename, 80);
  const [copied, setCopied] = useState(false);
  const lineCount = code.split("\n").length;
  const numbers = props.showLineNumbers !== false && lineCount > 1;
  const copy = async () => {
    if (!interactive) return;
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 2_000); } catch { setCopied(false); }
  };
  return <figure className="m-0 overflow-hidden rounded-xl" style={{ backgroundColor: "#0f172a", color: TOKEN_COLORS.plain, textAlign: "left" }}>
    <figcaption className="flex items-center justify-between" style={{ gap: 12, padding: "8px 8px 8px 16px", borderBottom: "1px solid #1e293b" }}>
      <span className="min-w-0 truncate text-[14px] font-semibold" style={{ color: "#cbd5e1" }}>{filename || CODE_LANGUAGE_LABELS[language]}</span>
      {props.showCopy !== false ? <button type="button" onClick={copy} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: "#e2e8f0", outlineColor: "#e2e8f0" }}>
        {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}{copied ? "已複製" : "複製"}
      </button> : null}
      <span className="sr-only" aria-live="polite">{copied ? "程式碼已複製" : ""}</span>
    </figcaption>
    {/* Horizontal scrolling stays inside this block; the page itself never scrolls sideways. */}
    <pre tabIndex={0} aria-label={`${filename || CODE_LANGUAGE_LABELS[language]}程式碼，可左右捲動`} className="m-0 overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2" style={{ padding: isMobile(viewport) ? "14px 16px" : "18px 20px", fontSize: isMobile(viewport) ? 14 : 15, lineHeight: 1.7, fontFamily: 'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, "Noto Sans Mono CJK TC", monospace', outlineColor: "#e2e8f0", tabSize: 2 }}>
      <code style={{ display: "grid", gridTemplateColumns: numbers ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)", columnGap: 16 }}>
        {numbers ? <span aria-hidden style={{ color: "#64748b", textAlign: "right", userSelect: "none", whiteSpace: "pre" }}>{Array.from({ length: lineCount }, (_, index) => index + 1).join("\n")}</span> : null}
        <span style={{ whiteSpace: "pre" }}>{tokens.map((token, index) => <span key={index} style={{ color: TOKEN_COLORS[token.kind], fontStyle: token.kind === "comment" ? "italic" : undefined }}>{token.text}</span>)}</span>
      </code>
    </pre>
  </figure>;
}

export const WEBINAR_ELEMENTS = {
  event_facts: EventFactsElement,
  speaker_profiles: SpeakerProfilesElement,
  agenda_timeline: AgendaTimelineElement,
  callout: CalloutElement,
  fit_compare: FitCompareElement,
  add_to_calendar: AddToCalendarElement,
  announcement_bar: AnnouncementBarElement,
  value_stack: ValueStackElement,
  session_schedule: SessionScheduleElement,
  deadline_notice: DeadlineNoticeElement,
  media_frame: MediaFrameElement,
  image_gallery: ImageGalleryElement,
  code_snippet: CodeSnippetElement,
} as const;
export type WebinarElementType = keyof typeof WEBINAR_ELEMENTS;

