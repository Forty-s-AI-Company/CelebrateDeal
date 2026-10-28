import type { CSSProperties } from "react";

import type { FunnelNode, FunnelPageSettings } from "@/lib/funnel-page-document";

/**
 * Typography system shared by the editor canvas, preview and the public `/lp`
 * render. Everything here is a pure function of the page settings and the
 * viewport, so server and browser renders stay identical (no hydration drift)
 * and explicit node styles can always be layered on top.
 */
export type FunnelTypographyViewport = "desktop" | "tablet" | "mobile";

/** I-1 breakpoints of the public page (CSS px): ≤ 639 mobile, 640–1079 tablet, ≥ 1080 desktop. */
export const FUNNEL_TABLET_MIN_WIDTH = 640;
export const FUNNEL_DESKTOP_MIN_WIDTH = 1080;
export function funnelViewportForWidth(width: number): FunnelTypographyViewport {
  return width < FUNNEL_TABLET_MIN_WIDTH ? "mobile" : width < FUNNEL_DESKTOP_MIN_WIDTH ? "tablet" : "desktop";
}

/**
 * Curated font stacks. The Noto TC, LXGW WenKai TC and Space Grotesk options
 * are self-hosted web fonts (I-2, `funnel-fonts.ts`): the stack starts with the
 * CSS variable next/font declares on the renderer root, so a page whose font
 * did not load (or a surface without the variable) falls back to system fonts.
 * Only the unicode-range slices a page actually renders are downloaded.
 * Unknown stored values (older documents typed a free-form family) are kept as-is.
 */
export const FUNNEL_FONT_OPTIONS = [
  { value: "system-ui", label: "系統預設", stack: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif' },
  { value: "sans-tc", label: "思源黑體（Noto Sans TC）", stack: 'var(--funnel-font-sans-tc, "Noto Sans TC"), "PingFang TC", "Microsoft JhengHei", "Heiti TC", system-ui, -apple-system, "Segoe UI", sans-serif' },
  { value: "serif-tc", label: "思源宋體（Noto Serif TC）", stack: 'var(--funnel-font-serif-tc, "Noto Serif TC"), "Songti TC", "PMingLiU", "MingLiU", Georgia, "Times New Roman", serif' },
  { value: "wenkai-tc", label: "霞鶩文楷（手寫溫暖）", stack: 'var(--funnel-font-wenkai-tc, "LXGW WenKai TC"), "Kaiti TC", "DFKai-SB", "BiauKai", "Noto Serif TC", serif' },
  { value: "display-latin", label: "Space Grotesk（英數點綴）", stack: 'var(--funnel-font-display-latin, "Space Grotesk"), "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif' },
  { value: "rounded-tc", label: "圓體", stack: 'ui-rounded, "Yuanti TC", "jf-openhuninn", "Arial Rounded MT Bold", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif' },
  { value: "humanist", label: "人文無襯線", stack: '"Segoe UI", "Helvetica Neue", Arial, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif' },
  { value: "mono", label: "等寬", stack: 'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, "Noto Sans Mono CJK TC", "Microsoft JhengHei", monospace' },
] as const;
export type FunnelFontOptionValue = (typeof FUNNEL_FONT_OPTIONS)[number]["value"];

const fontStacks = new Map<string, string>(FUNNEL_FONT_OPTIONS.map((option) => [option.value, option.stack]));
const DEFAULT_STACK = FUNNEL_FONT_OPTIONS[0].stack;

/** Same token guard as the persisted schema; anything else falls back to the system stack. */
function safeFontToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || /[{};<>\\]/u.test(trimmed) || /\b(?:javascript|data|vbscript|expression|url)\s*[:(]/iu.test(trimmed)) return null;
  return trimmed;
}

export function resolveFunnelFontStack(value: unknown): string {
  const token = safeFontToken(value);
  if (!token) return DEFAULT_STACK;
  return fontStacks.get(token) ?? token;
}

export function isCuratedFunnelFont(value: unknown): value is FunnelFontOptionValue {
  return typeof value === "string" && fontStacks.has(value);
}

export const FUNNEL_TEXT_STYLES = ["body", "lead", "small", "eyebrow"] as const;
export type FunnelTextStyle = (typeof FUNNEL_TEXT_STYLES)[number];
export const FUNNEL_TEXT_STYLE_LABELS: Readonly<Record<FunnelTextStyle, string>> = { body: "內文", lead: "引言（較大）", small: "小字", eyebrow: "眉標" };

export type FunnelHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type FunnelTypographyKind = FunnelHeadingLevel | FunnelTextStyle | "list" | "button";

export type FunnelTypographyTokens = {
  viewport: FunnelTypographyViewport;
  bodyFont: string;
  headingFont: string;
  /** Effective body size for this viewport, in px. */
  baseSize: number;
  lineHeight: number;
  textColor: string;
  headingColor: string;
  linkColor: string;
  alignment: "left" | "center" | "right";
};

/** Desktop / tablet / mobile ratios against the body size (a ~1.25 modular scale). */
const HEADING_SCALE: Readonly<Record<FunnelHeadingLevel, { desktop: number; tablet: number; mobile: number; weight: number; lineHeight: number; letterSpacing: string }>> = {
  h1: { desktop: 3, tablet: 2.5, mobile: 2, weight: 800, lineHeight: 1.2, letterSpacing: "-0.015em" },
  h2: { desktop: 2.25, tablet: 1.875, mobile: 1.625, weight: 700, lineHeight: 1.25, letterSpacing: "-0.01em" },
  h3: { desktop: 1.5, tablet: 1.375, mobile: 1.25, weight: 700, lineHeight: 1.35, letterSpacing: "0" },
  h4: { desktop: 1.25, tablet: 1.1875, mobile: 1.125, weight: 700, lineHeight: 1.4, letterSpacing: "0" },
  h5: { desktop: 1.125, tablet: 1.125, mobile: 1.0625, weight: 700, lineHeight: 1.4, letterSpacing: "0" },
  h6: { desktop: 1, tablet: 1, mobile: 1, weight: 700, lineHeight: 1.4, letterSpacing: "0" },
};

/** Mobile body text never grows past 18px, matching the previous renderer behaviour. */
export const FUNNEL_MOBILE_MAX_BODY_SIZE = 18;

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgb\([0-9, .]+\)|rgba\([0-9, .]+\)|transparent|white|black)$/iu;
function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && SAFE_COLOR.test(value.trim()) ? value.trim() : fallback;
}

export function resolveFunnelTypography(settings: Pick<FunnelPageSettings, "typography">, viewport: FunnelTypographyViewport): FunnelTypographyTokens {
  const typography = settings.typography;
  const requested = Number.isFinite(typography.bodySize) ? typography.bodySize : 16;
  const baseSize = viewport === "desktop" ? requested : Math.min(requested, FUNNEL_MOBILE_MAX_BODY_SIZE);
  const textColor = safeColor(typography.textColor, "#0f172a");
  return {
    viewport,
    bodyFont: resolveFunnelFontStack(typography.bodyFont),
    headingFont: resolveFunnelFontStack(typography.headingFont),
    baseSize,
    lineHeight: Number.isFinite(typography.bodyLineHeight) ? typography.bodyLineHeight : 1.5,
    textColor,
    headingColor: safeColor(typography.headingColor, textColor),
    linkColor: safeColor(typography.linkColor, "#2563eb"),
    alignment: typography.alignment,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

export function funnelHeadingSize(level: FunnelHeadingLevel, tokens: FunnelTypographyTokens): number {
  return round(tokens.baseSize * HEADING_SCALE[level][tokens.viewport]);
}

export function funnelHeadingLevel(value: unknown): FunnelHeadingLevel {
  return value === "h1" || value === "h3" || value === "h4" || value === "h5" || value === "h6" ? value : "h2";
}

export function funnelTextStyle(value: unknown): FunnelTextStyle {
  return value === "lead" || value === "small" || value === "eyebrow" ? value : "body";
}

/** Which typographic role a node plays, or null when it has no text defaults. */
export function funnelTypographyKind(node: Pick<FunnelNode, "type">, props: Record<string, unknown>): FunnelTypographyKind | null {
  switch (node.type) {
    case "headline": return funnelHeadingLevel(props.level);
    case "text": return funnelTextStyle(props.textStyle);
    case "bulleted_list": return "list";
    case "button": return "button";
    default: return null;
  }
}

/**
 * Default text styles for a role. Spacing between siblings comes from the
 * containers' gap (rows, content boxes, forms), so text margins are reset
 * explicitly; a node's own `margin` replaces it.
 */
export function funnelTypographyDefaults(kind: FunnelTypographyKind, tokens: FunnelTypographyTokens): CSSProperties {
  const mobile = tokens.viewport === "mobile";
  if (kind in HEADING_SCALE) {
    const level = kind as FunnelHeadingLevel;
    const scale = HEADING_SCALE[level];
    return { fontFamily: tokens.headingFont, fontSize: `${funnelHeadingSize(level, tokens)}px`, fontWeight: scale.weight, lineHeight: scale.lineHeight, letterSpacing: scale.letterSpacing, color: tokens.headingColor, margin: 0, overflowWrap: "break-word", textWrap: "balance" };
  }
  switch (kind) {
    // Body text may break long URLs / Latin strings anywhere (qa-standards 3.2-5); headings keep break-word.
    case "lead": return { fontSize: `${round(tokens.baseSize * (mobile ? 1.125 : tokens.viewport === "tablet" ? 1.1875 : 1.25))}px`, fontWeight: 400, lineHeight: Math.max(tokens.lineHeight, 1.6), letterSpacing: "0", margin: 0, overflowWrap: "anywhere" };
    case "small": return { fontSize: `${round(Math.max(12, tokens.baseSize * 0.875))}px`, fontWeight: 400, lineHeight: Math.max(tokens.lineHeight, 1.5), letterSpacing: "0", margin: 0, overflowWrap: "anywhere" };
    case "eyebrow": return { fontSize: `${round(Math.max(12, tokens.baseSize * 0.8125))}px`, fontWeight: 700, lineHeight: 1.4, letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.linkColor, margin: 0, overflowWrap: "anywhere" };
    case "list": return { fontSize: `${tokens.baseSize}px`, fontWeight: 400, lineHeight: tokens.lineHeight, letterSpacing: "0", margin: 0, overflowWrap: "anywhere" };
    case "button": return { fontFamily: tokens.bodyFont, fontSize: `${Math.max(16, tokens.baseSize)}px`, fontWeight: 700, lineHeight: 1.25, letterSpacing: "0", margin: 0 };
    default: return { fontSize: `${tokens.baseSize}px`, fontWeight: 400, lineHeight: tokens.lineHeight, letterSpacing: "0", margin: 0, overflowWrap: "anywhere" };
  }
}

/** Default look of a button control; any explicit node visual style replaces the matching key. */
export function funnelButtonDefaults(tokens: FunnelTypographyTokens): CSSProperties {
  const mobile = tokens.viewport === "mobile";
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5em", textAlign: "center",
    // qa-standards L-5: primary CTAs are at least 48px tall on every device.
    minHeight: mobile ? 48 : 50, padding: mobile ? "12px 22px" : "14px 28px", borderRadius: 10,
    backgroundColor: "#f59e0b", color: "#0f172a", textDecoration: "none",
  };
}

/** Layout tokens the renderer uses for containers (px). */
export function funnelLayoutTokens(viewport: FunnelTypographyViewport) {
  const mobile = viewport === "mobile";
  return { rowGap: mobile ? 16 : 20, columnGap: mobile ? 20 : viewport === "tablet" ? 24 : 32, boxGap: 12, formGap: 16, sectionGutter: mobile ? 20 : 24 };
}

/**
 * Container-aware card grid (qa-standards L-10): at most `columns` tracks, each
 * at least `min` px wide, so a grid placed inside a narrow column drops a
 * column instead of squeezing its cards. Pure CSS, identical on server and client.
 */
export function funnelFluidGridColumns(columns: number, gap: number, min = 240): string {
  const count = Math.max(1, Math.round(columns));
  if (count === 1) return "minmax(0, 1fr)";
  return `repeat(auto-fill, minmax(min(100%, max(${min}px, calc((100% - ${(count - 1) * gap}px) / ${count}))), 1fr))`;
}

/** Root style: inherited body text and CSS variables for nested surfaces. */
export function funnelPageTypographyStyle(tokens: FunnelTypographyTokens): CSSProperties {
  return {
    fontFamily: tokens.bodyFont, fontSize: `${tokens.baseSize}px`, lineHeight: tokens.lineHeight, color: tokens.textColor, textAlign: tokens.alignment,
    ["--funnel-heading-font" as string]: tokens.headingFont,
    ["--funnel-heading-color" as string]: tokens.headingColor,
    ["--funnel-link-color" as string]: tokens.linkColor,
  } as CSSProperties;
}

/* ---------- WCAG contrast helpers (used by tests and the settings panel) ---------- */

const NAMED: Readonly<Record<string, string>> = { white: "#ffffff", black: "#000000" };

/** Parses #rgb, #rrggbb, rgb() and the two named colours; alpha/transparent return null. */
export function parseFunnelColor(value: string): [number, number, number] | null {
  const input = (NAMED[value.trim().toLowerCase()] ?? value).trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(input);
  if (short) return [short[1]!, short[2]!, short[3]!].map((part) => parseInt(part + part, 16)) as [number, number, number];
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(input);
  if (long) return [long[1]!, long[2]!, long[3]!].map((part) => parseInt(part, 16)) as [number, number, number];
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/iu.exec(input);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((part) => Math.min(255, part)) as [number, number, number];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, or null when either colour is not opaque/parseable. */
export function funnelContrastRatio(foreground: string, background: string): number | null {
  const fg = parseFunnelColor(foreground);
  const bg = parseFunnelColor(background);
  if (!fg || !bg) return null;
  const [high, low] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (high + 0.05) / (low + 0.05);
}
