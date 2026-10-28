import { showcaseChoice, showcaseNumber, showcaseText } from "@/lib/funnel-showcase";
import { safeContentAssetUrl, safeContentHref } from "@/lib/safe-url";

/**
 * Pure prop readers for the webinar elements (C-01～C-18). Like
 * `@/lib/funnel-showcase`, stored props are free-form JSON, so every reader
 * re-validates on render: text is trimmed and capped, links and images go
 * through `@/lib/safe-url`. Dates are never read from here: every element
 * takes its times from `@/lib/funnel-event-time` (I-5).
 *
 * Contract note: later batches may only ADD optional props; renaming or
 * removing a prop breaks saved pages.
 */

export const FUNNEL_WEBINAR_MAX_ITEMS = 12;

function records(value: unknown, max = FUNNEL_WEBINAR_MAX_ITEMS): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, max);
}

/** Lines of a textarea or an array of strings, trimmed, empty lines dropped. */
export function webinarLines(value: unknown, max = 12, length = 300): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/u) : [];
  return list.flatMap((item) => {
    const text = typeof item === "string" ? item.trim() : item && typeof item === "object" && !Array.isArray(item) ? showcaseText((item as Record<string, unknown>).text) : "";
    return text ? [text.slice(0, length)] : [];
  }).slice(0, max);
}

/* ------------------------------ C-01 活動資訊列 ------------------------------ */

export const EVENT_FACTS_LAYOUTS = ["row", "grid", "card"] as const;
export type EventFactsLayout = (typeof EVENT_FACTS_LAYOUTS)[number];

/* ------------------------------ C-02 講者卡 ------------------------------ */

export const SPEAKER_LAYOUTS = ["featured", "grid", "duo"] as const;
export type SpeakerLayout = (typeof SPEAKER_LAYOUTS)[number];
export const SPEAKER_PHOTO_SHAPES = ["square", "portrait", "circle"] as const;
export type SpeakerPhotoShape = (typeof SPEAKER_PHOTO_SHAPES)[number];

export type WebinarSpeaker = { photo: string | null; alt: string; name: string; role: string; bio: string; tags: string[]; href: string | null; linkLabel: string };

/** Up to 3 achievement tags, separated by commas, 、 or new lines. */
export function speakerTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n") : typeof value === "string" ? value : "";
  return raw.split(/[,，、\n]/u).map((tag) => tag.trim().slice(0, 24)).filter(Boolean).slice(0, 3);
}

export function webinarSpeakers(value: unknown): WebinarSpeaker[] {
  return records(value, 8).flatMap((item) => {
    const name = showcaseText(item.name, 60);
    const bio = showcaseText(item.bio, 400);
    if (!name && !bio) return [];
    return [{ photo: safeContentAssetUrl(item.photo), alt: showcaseText(item.alt, 160) || name, name, role: showcaseText(item.role, 120), bio, tags: speakerTags(item.tags), href: safeContentHref(item.href), linkLabel: showcaseText(item.linkLabel, 40) }];
  });
}

/** Initials for the gradient avatar: first CJK character, or the first letters of up to two Latin words. */
export function speakerInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "★";
  const first = Array.from(trimmed)[0]!;
  if (!/[A-Za-z]/u.test(first)) return first;
  return trimmed.split(/[\s-]+/u).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
}

/* ------------------------------ C-03 議程時間軸 ------------------------------ */

export const AGENDA_LAYOUTS = ["vertical", "cards", "steps"] as const;
export type AgendaLayout = (typeof AGENDA_LAYOUTS)[number];
export type AgendaItem = { time: string; title: string; text: string; speaker: string; tag: string };

export function agendaItems(value: unknown): AgendaItem[] {
  return records(value).flatMap((item) => {
    const title = showcaseText(item.title, 160);
    const text = showcaseText(item.text, 600);
    if (!title && !text) return [];
    return [{ time: showcaseText(item.time, 24), title, text, speaker: showcaseText(item.speaker, 80), tag: showcaseText(item.tag, 24) }];
  });
}

/* ------------------------------ C-06 倒數 ------------------------------ */

export const COUNTDOWN_VARIANTS = ["blocks", "inline", "bar"] as const;
export type CountdownVariant = (typeof COUNTDOWN_VARIANTS)[number];
export const COUNTDOWN_SOURCES = ["fixed", "webinar_start", "registration_close"] as const;
export type CountdownSource = (typeof COUNTDOWN_SOURCES)[number];

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number };
export function countdownParts(remainingMs: number): CountdownParts {
  const value = Math.max(0, Math.floor(remainingMs / 1000));
  return { days: Math.floor(value / 86_400), hours: Math.floor((value % 86_400) / 3_600), minutes: Math.floor((value % 3_600) / 60), seconds: value % 60 };
}
const pad = (value: number) => String(value).padStart(2, "0");
/** 「2 天 03:12:45」；不到一天時省略天數。`seconds: false` 時只到分鐘。 */
export function formatCountdownInline(parts: CountdownParts, seconds = true): string {
  const clock = `${pad(parts.hours)}:${pad(parts.minutes)}${seconds ? `:${pad(parts.seconds)}` : ""}`;
  return parts.days > 0 ? `${parts.days} 天 ${clock}` : clock;
}
/** Screen-reader sentence, minute precision (announced at most once a minute). */
export function formatCountdownSpoken(parts: CountdownParts): string {
  return `${parts.days ? `${parts.days} 天 ` : ""}${parts.hours} 小時 ${parts.minutes} 分鐘`;
}

/* ------------------------------ C-07 提示框 ------------------------------ */

export const CALLOUT_TONES = ["info", "warning", "compliance"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];
/** Paragraphs split by blank lines, at most 3. */
export function calloutParagraphs(value: unknown): string[] {
  return (typeof value === "string" ? value : "").split(/\r?\n\s*\r?\n/u).map((part) => part.trim().slice(0, 800)).filter(Boolean).slice(0, 3);
}

/* ------------------------------ C-11 價值清單 ------------------------------ */

/**
 * 純展示：value 一律是商家輸入的文字（例如「NT$3,980」），不解析成數字、不加總，
 * 也絕不進入訂單或結帳計算（AGENTS.md：金額只來自伺服器紀錄）。
 */
export type ValueStackItem = { title: string; text: string; value: string };
export function valueStackItems(value: unknown): ValueStackItem[] {
  return records(value).flatMap((item) => {
    const title = showcaseText(item.title, 160);
    return title ? [{ title, text: showcaseText(item.text, 400), value: showcaseText(item.value, 40) }] : [];
  });
}
export const VALUE_STACK_DEFAULT_NOTE = "價值為講者自訂參考，非售價承諾";

/* ------------------------------ C-12 場次表 ------------------------------ */

export type SessionStatus = "ended" | "soon" | "open";
export const SESSION_STATUS_LABELS: Readonly<Record<SessionStatus, string>> = { ended: "已結束", soon: "即將開始", open: "報名中" };
export type ScheduleSession = { startsAt: string | null; title: string; text: string };

export function scheduleSessions(value: unknown): ScheduleSession[] {
  return records(value).flatMap((item) => {
    const title = showcaseText(item.title, 160);
    if (!title) return [];
    const time = typeof item.startsAt === "string" ? Date.parse(item.startsAt) : Number.NaN;
    return [{ startsAt: Number.isFinite(time) ? new Date(time).toISOString() : null, title, text: showcaseText(item.text, 300) }];
  });
}

/** 依日期自動計算，不接受手填「額滿」：開始後為已結束，24 小時內為即將開始，其餘為報名中。 */
export function sessionStatus(startsAt: string | null, now: number, durationMinutes = 90): SessionStatus | null {
  if (!startsAt) return null;
  const start = Date.parse(startsAt);
  if (now >= start + durationMinutes * 60_000) return "ended";
  if (start - now <= 86_400_000) return "soon";
  return "open";
}

/* ------------------------------ C-15 依活動狀態切換 ------------------------------ */

export const WEBINAR_STATE_KEYS = ["upcoming", "live", "replay", "ended"] as const;
export type WebinarStateKey = (typeof WEBINAR_STATE_KEYS)[number];
export const WEBINAR_STATE_LABELS: Readonly<Record<WebinarStateKey, string>> = { upcoming: "開場前（含時間未定）", live: "直播中", replay: "回放期", ended: "已結束" };
export function webinarStateKey(value: unknown): WebinarStateKey | null {
  return typeof value === "string" && (WEBINAR_STATE_KEYS as readonly string[]).includes(value) ? value as WebinarStateKey : null;
}

/* ------------------------------ C-16 裝置框 ------------------------------ */

export const MEDIA_FRAMES = ["browser", "phone", "laptop"] as const;
export type MediaFrame = (typeof MEDIA_FRAMES)[number];

/* ------------------------------ C-17 作品集圖庫 ------------------------------ */

export const GALLERY_LAYOUTS = ["masonry", "grid"] as const;
export type GalleryImage = { src: string; alt: string; caption: string };
export function galleryImages(value: unknown): GalleryImage[] {
  return records(value, 24).flatMap((item) => {
    const src = safeContentAssetUrl(item.src);
    return src ? [{ src, alt: showcaseText(item.alt, 200), caption: showcaseText(item.caption, 200) }] : [];
  });
}

/* ------------------------------ C-18 程式碼片段 ------------------------------ */

export const CODE_LANGUAGES = ["plain", "javascript", "typescript", "python", "bash", "html", "css", "json"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];
export const CODE_LANGUAGE_LABELS: Readonly<Record<CodeLanguage, string>> = { plain: "純文字", javascript: "JavaScript", typescript: "TypeScript", python: "Python", bash: "Shell", html: "HTML", css: "CSS", json: "JSON" };
export const CODE_SNIPPET_MAX_LENGTH = 6_000;

export type CodeToken = { text: string; kind: "plain" | "comment" | "string" | "keyword" | "number" | "tag" };
const KEYWORDS: Readonly<Record<CodeLanguage, readonly string[]>> = {
  plain: [],
  javascript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "await", "async", "import", "from", "export", "new", "class", "true", "false", "null", "undefined"],
  typescript: ["const", "let", "function", "return", "if", "else", "for", "await", "async", "import", "from", "export", "new", "class", "type", "interface", "true", "false", "null", "undefined"],
  python: ["def", "return", "if", "elif", "else", "for", "while", "import", "from", "as", "class", "with", "True", "False", "None", "in", "not", "and", "or", "async", "await"],
  bash: ["if", "then", "fi", "for", "do", "done", "echo", "export", "npm", "npx", "cd", "git"],
  html: [],
  css: [],
  json: ["true", "false", "null"],
};

/**
 * Display-only highlighting (never executed): comments, strings, numbers,
 * keywords and HTML tags. Everything else stays plain text; the renderer
 * outputs tokens as React text, so code is never interpreted as markup.
 */
export function highlightCode(code: string, language: CodeLanguage): CodeToken[] {
  const source = code.slice(0, CODE_SNIPPET_MAX_LENGTH);
  if (language === "plain") return [{ text: source, kind: "plain" }];
  const comment = language === "python" || language === "bash" ? "#[^\\n]*" : language === "html" ? "<!--[\\s\\S]*?-->" : language === "css" ? "\\/\\*[\\s\\S]*?\\*\\/" : language === "json" ? "(?!)" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const tag = language === "html" ? "<\\/?[A-Za-z][A-Za-z0-9-]*" : "(?!)";
  const pattern = new RegExp(`(${comment})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(${tag})|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Za-z_][A-Za-z0-9_]*)\\b`, "gu");
  const keywords = new Set(KEYWORDS[language]);
  const tokens: CodeToken[] = [];
  let last = 0;
  const push = (text: string, kind: CodeToken["kind"]) => {
    if (!text) return;
    const previous = tokens[tokens.length - 1];
    if (previous && previous.kind === kind) previous.text += text; else tokens.push({ text, kind });
  };
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    push(source.slice(last, index), "plain");
    const [whole, commentText, stringText, tagText, numberText, word] = match;
    if (commentText) push(whole, "comment");
    else if (stringText) push(whole, "string");
    else if (tagText) push(whole, "tag");
    else if (numberText) push(whole, "number");
    else push(whole, word && keywords.has(word) ? "keyword" : "plain");
    last = index + whole.length;
  }
  push(source.slice(last), "plain");
  return tokens;
}

/* ------------------------------ 共用 ------------------------------ */

export function webinarChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return showcaseChoice(value, choices, fallback);
}
export function webinarNumber(value: unknown, min: number, max: number, fallback: number): number {
  return showcaseNumber(value, min, max, fallback);
}
