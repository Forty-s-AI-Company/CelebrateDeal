import { safeContentAssetUrl, safeContentHref } from "@/lib/safe-url";
import { funnelContrastRatio } from "@/lib/funnel-typography";

/**
 * Pure prop readers for the showcase elements (navigation bar, logo strip,
 * stats, icon list, shape divider, section title, image cards, testimonial
 * wall, content cards, video gallery). Stored props are free-form JSON, so
 * every reader re-validates on render: text is trimmed and capped, links go
 * through `@/lib/safe-url`, colours through the same allow-list as styles.
 * Nothing here touches the DOM, so server and browser renders agree.
 */

export const FUNNEL_SHOWCASE_MAX_ITEMS = 24;
/** Default accent of the showcase elements: a warm gold that passes AA on near-black (not on light backgrounds). */
export const FUNNEL_SHOWCASE_DEFAULT_ACCENT = "#c9a063";

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgb\([0-9, .]+\)|rgba\([0-9, .]+\)|transparent|white|black)$/iu;

export function showcaseColor(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_COLOR.test(value.trim()) ? value.trim() : undefined;
}

/** Near-black or warm white, whichever reads better on `background` (badges and pills on the accent colour). */
export function showcaseReadableOn(background: string): "#111111" | "#ffffff" {
  const dark = funnelContrastRatio("#111111", background) ?? 21;
  const light = funnelContrastRatio("#ffffff", background) ?? 1;
  return dark >= light ? "#111111" : "#ffffff";
}

/** Splits "把人生的舵，*交回自己手上*" into plain and accented parts (single asterisks mark the accent). */
export function showcaseAccentParts(value: string): Array<{ text: string; accent: boolean }> {
  return value.split(/(\*[^*\n]+\*)/u).filter(Boolean).map((part) => part.length > 2 && part.startsWith("*") && part.endsWith("*") ? { text: part.slice(1, -1), accent: true } : { text: part, accent: false });
}

export function showcaseText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function showcaseNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

export function showcaseChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === "string" && (choices as readonly string[]).includes(value) ? value as T : fallback;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, FUNNEL_SHOWCASE_MAX_ITEMS);
}

const href = (value: unknown) => safeContentHref(value);
const asset = (value: unknown) => safeContentAssetUrl(value);

/* ------------------------------ 導覽列 ------------------------------ */

export type ShowcaseLink = { label: string; href: string | null };
export type ShowcaseNavItem = ShowcaseLink & { children: ShowcaseLink[] };

/** Sub-menu lines are "名稱 | 網址" (the same convention as the menu element). */
function submenu(value: unknown): ShowcaseLink[] {
  if (Array.isArray(value)) return records(value).flatMap((item) => { const label = showcaseText(item.label, 80); return label ? [{ label, href: href(item.href) }] : []; });
  if (typeof value !== "string") return [];
  return value.split(/\r?\n/u).slice(0, 12).flatMap((line) => {
    const [label, target] = line.split("|").map((part) => part.trim());
    return label ? [{ label: label.slice(0, 80), href: href(target) }] : [];
  });
}

export function showcaseNavItems(value: unknown): ShowcaseNavItem[] {
  return records(value).slice(0, 10).flatMap((item) => {
    const label = showcaseText(item.label, 80);
    return label ? [{ label, href: href(item.href), children: submenu(item.submenu ?? item.children) }] : [];
  });
}

export const SHOWCASE_SOCIAL_NETWORKS = ["facebook", "instagram", "youtube", "line", "x", "threads", "linkedin", "email"] as const;
export type ShowcaseSocialNetwork = (typeof SHOWCASE_SOCIAL_NETWORKS)[number];
export const SHOWCASE_SOCIAL_LABELS: Readonly<Record<ShowcaseSocialNetwork, string>> = {
  facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", line: "LINE", x: "X", threads: "Threads", linkedin: "LinkedIn", email: "Email",
};

/** Email links are stored as `mailto:`; every other network needs a safe HTTPS / same-origin link. */
export function showcaseSocialLinks(value: unknown): Array<{ network: ShowcaseSocialNetwork; href: string }> {
  return records(value).slice(0, 8).flatMap((item): Array<{ network: ShowcaseSocialNetwork; href: string }> => {
    const network = showcaseChoice(item.network, SHOWCASE_SOCIAL_NETWORKS, "facebook");
    const raw = showcaseText(item.href, 2_048);
    if (network === "email") {
      const address = raw.replace(/^mailto:/iu, "");
      return /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/u.test(address) ? [{ network, href: `mailto:${address}` }] : [];
    }
    const safe = href(raw);
    return safe ? [{ network, href: safe }] : [];
  });
}

/* ------------------------------ Logo 列 ------------------------------ */

export const SHOWCASE_LOGO_TONES = ["original", "grayscale", "light", "dark"] as const;
export type ShowcaseLogoTone = (typeof SHOWCASE_LOGO_TONES)[number];

export function showcaseLogoItems(value: unknown): Array<{ src: string; alt: string; href: string | null }> {
  return records(value).flatMap((item) => {
    const src = asset(item.src);
    return src ? [{ src, alt: showcaseText(item.alt, 120), href: href(item.href) }] : [];
  });
}

/** CSS filter per tone: 灰階, 單色淺（深色背景用）, 單色深（淺色背景用）. */
export function showcaseLogoFilter(tone: ShowcaseLogoTone): string | undefined {
  switch (tone) {
    case "grayscale": return "grayscale(1)";
    case "light": return "brightness(0) invert(1)";
    case "dark": return "brightness(0)";
    default: return undefined;
  }
}

/* ------------------------------ 數據統計 ------------------------------ */

export type ShowcaseStat = { value: number | null; display: string; decimals: number; prefix: string; suffix: string; label: string };

/** "12,800" → 12800; non-numeric values ("24/7") are shown as typed and never animated. */
export function showcaseStatItems(value: unknown): ShowcaseStat[] {
  return records(value).slice(0, 8).flatMap((item) => {
    const display = showcaseText(item.value, 24);
    const label = showcaseText(item.label, 160);
    if (!display && !label) return [];
    const normalized = display.replaceAll(",", "");
    const numeric = /^\d+(?:\.\d+)?$/u.test(normalized) ? Number(normalized) : null;
    const decimals = numeric !== null && normalized.includes(".") ? Math.min(2, normalized.split(".")[1]!.length) : 0;
    return [{ value: numeric, display, decimals, prefix: showcaseText(item.prefix, 8), suffix: showcaseText(item.suffix, 12), label }];
  });
}

/** Formats a count-up frame with thousands separators, keeping the configured decimals. */
export function formatShowcaseStat(value: number, decimals: number, grouped: boolean): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
}

/* ------------------------------ 圖示重點 ------------------------------ */

export const SHOWCASE_ICONS = ["spark", "target", "compass", "book", "chart", "users", "heart", "shield", "clock", "star", "check", "trophy", "lightbulb", "rocket", "play", "message", "gem", "leaf", "anchor", "sail", "cap", "mountain"] as const;
export type ShowcaseIcon = (typeof SHOWCASE_ICONS)[number];
export const SHOWCASE_ICON_LABELS: Readonly<Record<ShowcaseIcon, string>> = {
  spark: "星芒", target: "目標", compass: "羅盤", book: "書本", chart: "成長圖表", users: "社群", heart: "愛心", shield: "保障", clock: "時間", star: "星星", check: "勾選",
  trophy: "獎盃", lightbulb: "靈感", rocket: "火箭", play: "播放", message: "對話", gem: "寶石", leaf: "葉子", anchor: "船錨", sail: "帆船", cap: "學士帽", mountain: "山峰",
};

export function showcaseIconItems(value: unknown): Array<{ icon: ShowcaseIcon; title: string; text: string }> {
  return records(value).slice(0, 12).flatMap((item) => {
    const title = showcaseText(item.title, 160);
    const text = showcaseText(item.text, 1_000);
    return title || text ? [{ icon: showcaseChoice(item.icon, SHOWCASE_ICONS, "check"), title, text }] : [];
  });
}

/* ------------------------------ 分隔形狀 ------------------------------ */

export const SHOWCASE_DIVIDER_SHAPES = ["triangle", "slant", "wave", "curve"] as const;
export type ShowcaseDividerShape = (typeof SHOWCASE_DIVIDER_SHAPES)[number];

/**
 * Path in a 1200×100 box. "top" hangs the shape from the top edge (the colour
 * continues the section above, e.g. an inverted triangle pointing down);
 * "bottom" rises from the bottom edge into the section above.
 */
export function showcaseDividerPath(shape: ShowcaseDividerShape, position: "top" | "bottom"): string {
  const top: Record<ShowcaseDividerShape, string> = {
    triangle: "M0 0H1200L600 100Z",
    slant: "M0 0H1200L0 100Z",
    wave: "M0 0H1200V46C1100 86 1000 86 900 56S700 6 600 36 400 96 300 76 100 26 0 56Z",
    curve: "M0 0H1200V10C900 110 300 110 0 10Z",
  };
  const bottom: Record<ShowcaseDividerShape, string> = {
    triangle: "M0 100H1200L600 0Z",
    slant: "M0 100H1200V0Z",
    wave: "M0 100H1200V54C1100 14 1000 14 900 44S700 94 600 64 400 4 300 24 100 74 0 44Z",
    curve: "M0 100H1200V90C900 -10 300 -10 0 90Z",
  };
  return (position === "top" ? top : bottom)[shape];
}

/* ------------------------------ 卡片 ------------------------------ */

export type ShowcaseCard = { src: string | null; alt: string; title: string; text: string; href: string | null; linkLabel: string; category: string; date: string };

export function showcaseCards(value: unknown): ShowcaseCard[] {
  return records(value).flatMap((item) => {
    const title = showcaseText(item.title, 200);
    const src = asset(item.src);
    if (!title && !src) return [];
    return [{ src, alt: showcaseText(item.alt, 200), title, text: showcaseText(item.text ?? item.excerpt, 1_000), href: href(item.href), linkLabel: showcaseText(item.linkLabel, 40), category: showcaseText(item.category, 40), date: showcaseText(item.date, 40) }];
  });
}

/* ------------------------------ 評價牆 ------------------------------ */

export type ShowcaseTestimonial = { avatar: string | null; name: string; verified: boolean; date: string; rating: number; title: string; text: string };

export function showcaseTestimonials(value: unknown): ShowcaseTestimonial[] {
  return records(value).flatMap((item) => {
    const name = showcaseText(item.name, 80);
    const text = showcaseText(item.text, 1_200);
    if (!name && !text) return [];
    return [{ avatar: asset(item.avatar), name, verified: item.verified === true, date: showcaseText(item.date, 40), rating: Math.round(showcaseNumber(item.rating, 0, 5, 5)), title: showcaseText(item.title, 160), text }];
  });
}

/** Two marquee rows take alternate entries so each row has different content. */
export function showcaseTestimonialRows<T>(items: readonly T[], rows: 1 | 2): T[][] {
  if (rows === 1 || items.length < 4) return [items.slice()];
  return [items.filter((_, index) => index % 2 === 0), items.filter((_, index) => index % 2 === 1)];
}

/* ------------------------------ 影片牆 ------------------------------ */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com", "youtube-nocookie.com"]);

/** Video id from the usual YouTube URL forms (watch, youtu.be, embed, shorts, live); null otherwise. */
export function youtubeVideoId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const candidate = url.hostname.toLowerCase() === "youtu.be" ? segments[0]
    : segments[0] === "watch" || url.pathname === "/watch" ? url.searchParams.get("v")
      : ["embed", "shorts", "live", "v"].includes(segments[0] ?? "") ? segments[1] : null;
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

/** Privacy-enhanced embed; loaded only after the visitor presses play. */
export function youtubeNoCookieEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`;
}

export type ShowcaseVideo = { title: string; youtubeId: string | null; href: string | null; thumbnail: string | null };

/** YouTube links play inline (youtube-nocookie); any other safe link opens in a new tab. */
export function showcaseVideos(value: unknown): ShowcaseVideo[] {
  return records(value).flatMap((item) => {
    const title = showcaseText(item.title, 200);
    const youtubeId = youtubeVideoId(item.url);
    const link = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : href(item.url);
    const thumbnail = asset(item.thumbnail) ?? (youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null);
    return title || link || thumbnail ? [{ title, youtubeId, href: link, thumbnail }] : [];
  });
}
