import type { z } from "zod";

import {
  FUNNEL_NODE_REGISTRY,
  FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION,
  createEmptyPageDocument,
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type FunnelNodeStyle,
  type FunnelNodeType,
  type PageDocument,
} from "@/lib/funnel-page-document";
import {
  parseLandingPageContent,
  type LandingPageAction,
  type LandingPageComponentType,
  type LandingPageContent,
  type LandingPageFormReference,
  type LandingPageLiveReference,
  type LandingPageStyleSchema,
} from "@/lib/landing-page-content";

/**
 * Converts a legacy (schema v1 `LandingPageContent`) page into the structured
 * `PageDocument` the editor understands. The function is pure: the same input
 * and options always produce the same document, and node IDs are derived from
 * the legacy block IDs, so reopening a legacy draft yields identical IDs.
 *
 * Nothing here persists anything. The editor shows the result and only the
 * merchant's explicit save writes the new format.
 *
 * Every legacy setting without an exact equivalent is reported as an issue,
 * and content (text, images, links) is never dropped: it is kept as visible
 * nodes (or, for slots the legacy page itself never showed, as hidden nodes
 * that remain visible in the editor).
 */

type LegacyBlock = LandingPageContent["data"]["content"][number];
type LegacyBlockOf<T extends LandingPageComponentType> = Extract<LegacyBlock, { type: T }>;
type LegacyStyle = z.infer<typeof LandingPageStyleSchema>;

export type LegacyConversionIssue = {
  /** Legacy block id, or `page` for page-level settings. */
  blockId: string;
  blockType: LandingPageComponentType | "Page";
  /** Merchant-facing block name (zh-TW). */
  blockLabel: string;
  /** Merchant-facing explanation of what changed (zh-TW). */
  message: string;
};

export type LegacyLandingPageConversion =
  | { ok: true; document: PageDocument; issues: LegacyConversionIssue[] }
  | { ok: false; reason: "invalid_legacy_content" | "conversion_invalid" };

export type LegacyConversionOptions = {
  /** PageDocument id (the landing page id in the editor). */
  id?: string;
  /** Page name; defaults to the legacy SEO title. */
  name?: string;
  /** Registration forms the merchant can bind (same vendor and project). */
  forms?: readonly LandingPageFormReference[];
  /** The live currently bound to the draft, for registration links and live-linked countdowns. */
  live?: LandingPageLiveReference;
};

export const LEGACY_BLOCK_LABELS: Readonly<Record<LandingPageComponentType, string>> = {
  Heading: "標題", Text: "內文", Image: "圖片", Video: "影片", Button: "按鈕", Section: "區段", Columns: "欄位",
  Hero: "主視覺", Speaker: "講者", Benefits: "亮點", Agenda: "議程", Carousel: "圖片輪播", Pricing: "方案價格",
  Countdown: "倒數計時", Testimonials: "見證", FAQ: "常見問題", CTA: "行動呼籲",
};

/* ------------------------------------------------------------------ */
/* Legacy design tokens (Tailwind values the legacy renderer used).   */
/* ------------------------------------------------------------------ */

const SPACE_PX = { sm: 12, md: 20, lg: 32, xl: 48 } as const;
const RADIUS_PX = { sm: 4, md: 12, lg: 16, full: 500 } as const;
const FONT_PX = { sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "4xl": 36 } as const;
const MAX_WIDTH_PX = { sm: 576, md: 768, lg: 1024, xl: 1152 } as const;
/** Legacy pages were a centred `max-w-6xl` column with `px-6` gutters. */
const PAGE_CONTENT_WIDTH = 1104;

const COLOR = {
  white: "#ffffff", blue700: "#1d4ed8", blue600: "#2563eb", blue900: "#1e3a8a", blue200: "#bfdbfe", blue100: "#dbeafe",
  slate600: "#475569", slate700: "#334155", slate200: "#e2e8f0", slate50: "#f8fafc", slate300: "#cbd5e1",
  amber700: "#b45309", amber200: "#fde68a", amber50: "#fffbeb",
} as const;

const LEGACY_BUTTON: FunnelNodeStyle = { backgroundColor: COLOR.blue700, color: COLOR.white, borderRadius: 12 };
const LEGACY_BUTTON_INVERSE: FunnelNodeStyle = { backgroundColor: COLOR.white, color: COLOR.blue900, borderRadius: 12 };

type Look = { style: FunnelNodeStyle; mobile?: FunnelNodeStyle; gap?: number };
const HERO_LOOK: Look = { style: { backgroundColor: COLOR.blue900, color: COLOR.white, borderRadius: 24, padding: "64px 48px", shadow: "medium" }, mobile: { padding: "48px 28px" }, gap: 16 };
const CTA_LOOK: Look = { style: { backgroundColor: COLOR.blue600, color: COLOR.white, borderRadius: 24, padding: 32, shadow: "medium", textAlign: "center" }, gap: 16 };
const COUNTDOWN_LOOK: Look = { style: { backgroundColor: COLOR.amber50, borderColor: COLOR.amber200, borderWidth: 1, borderRadius: 16, padding: 24, textAlign: "center" }, gap: 16 };
const VIDEO_LINK_LOOK: Look = { style: { backgroundColor: COLOR.slate50, borderColor: COLOR.slate300, borderWidth: 1, borderRadius: 16, padding: 20 }, gap: 12 };

/* ------------------------------------------------------------------ */
/* Deterministic IDs                                                   */
/* ------------------------------------------------------------------ */

const MAX_ID_LENGTH = 100;

/** 32-bit FNV-1a, hex. Only used to shorten over-long derived IDs deterministically. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

class IdAllocator {
  private readonly used = new Set<string>();
  constructor(private readonly reserved: ReadonlySet<string>) {}

  /** The legacy block id itself (reserved up front, so it is always free for its owner). */
  own(legacyId: string): string {
    this.used.add(legacyId);
    return legacyId;
  }

  /** `${base}-${role}`, made unique against every legacy id and every id handed out before. */
  derive(base: string, role: string): string {
    const candidate = this.fit(`${base}-${role}`);
    if (!this.taken(candidate)) return this.claim(candidate);
    for (let suffix = 2; ; suffix += 1) {
      const next = this.fit(`${candidate}-${suffix}`);
      if (!this.taken(next)) return this.claim(next);
    }
  }

  /** Snapshot for a trial conversion that may be discarded. */
  checkpoint(): () => void {
    const saved = new Set(this.used);
    return () => { this.used.clear(); saved.forEach((id) => this.used.add(id)); };
  }

  private fit(candidate: string) {
    return candidate.length <= MAX_ID_LENGTH ? candidate : `${candidate.slice(0, MAX_ID_LENGTH - 9)}-${shortHash(candidate)}`;
  }
  private taken(id: string) { return this.used.has(id) || this.reserved.has(id); }
  private claim(id: string) { this.used.add(id); return id; }
}

function childSlots(block: LegacyBlock): LegacyBlock[][] {
  if (block.type === "Section") return [block.props.children as LegacyBlock[]];
  if (block.type === "Columns") return [block.props.first as LegacyBlock[], block.props.second as LegacyBlock[], block.props.third as LegacyBlock[]];
  return [];
}

function collectLegacyIds(blocks: readonly LegacyBlock[], ids = new Set<string>()): Set<string> {
  for (const block of blocks) {
    ids.add(block.props.id);
    for (const slot of childSlots(block)) collectLegacyIds(slot, ids);
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Node helpers                                                        */
/* ------------------------------------------------------------------ */

/** Where converted nodes are placed: directly in a row, in a grid cell, or in a content box. */
type Ctx = "row" | "column" | "box";
const CTX_PARENT: Record<Ctx, FunnelNodeType> = { row: "row", column: "columns_2", box: "content_box" };

function allowed(type: FunnelNodeType, ctx: Ctx) {
  return FUNNEL_NODE_REGISTRY[type].allowedParents.includes(CTX_PARENT[ctx]);
}
/** Content boxes group nodes in rows and grid cells, but cannot be nested in another box. */
const canGroup = (ctx: Ctx) => allowed("content_box", ctx);

function node(type: FunnelNodeType, id: string, props: Record<string, unknown> = {}, style: FunnelNodeStyle = {}, children?: FunnelNode[]): FunnelNode {
  return {
    schemaVersion: FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION, id, type, props, style, overrides: {}, visible: true, actions: [], attributes: {},
    ...(FUNNEL_NODE_REGISTRY[type].children ? { children: children ?? [] } : {}),
  };
}

function withColor(style: FunnelNodeStyle, color: string | undefined): FunnelNodeStyle {
  return color ? { ...style, color } : style;
}

function setMobile(target: FunnelNode, mobile: { style?: FunnelNodeStyle; visible?: boolean }) {
  const current = target.overrides.mobile ?? {};
  const style = { ...(current.style ?? {}), ...(mobile.style ?? {}) };
  target.overrides = {
    ...target.overrides,
    mobile: { ...current, ...(Object.keys(style).length ? { style } : {}), ...(mobile.visible === false ? { visible: false } : {}) },
  };
}

function hideOnMobile(nodes: FunnelNode[], hidden: boolean) {
  if (hidden) nodes.forEach((item) => setMobile(item, { visible: false }));
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Legacy style mapping                                                */
/* ------------------------------------------------------------------ */

type MappedStyle = {
  /** Container keys: background, text colour, alignment, spacing, radius, width. */
  container: FunnelNodeStyle;
  containerMobile: FunnelNodeStyle;
  hiddenOnMobile: boolean;
  /** Text-size keys, only meaningful on a text or heading node. */
  text: FunnelNodeStyle;
  textMobile: FunnelNodeStyle;
  /** zh-TW names of legacy settings that have no equivalent. */
  unsupported: string[];
};

function mapContainerStyle(style: LegacyStyle): FunnelNodeStyle {
  const container: FunnelNodeStyle = {};
  if (style.backgroundColor) container.backgroundColor = style.backgroundColor;
  if (style.color) container.color = style.color;
  if (style.textAlign) container.textAlign = style.textAlign;
  if (style.padding && style.padding !== "none") container.padding = SPACE_PX[style.padding];
  if (style.borderRadius && style.borderRadius !== "none") container.borderRadius = RADIUS_PX[style.borderRadius];
  const margin = style.margin && style.margin !== "none" ? SPACE_PX[style.margin] : 0;
  if (style.maxWidth && style.maxWidth !== "full") {
    // Legacy `mx-auto max-w-*`: a centred column of at most this width.
    container.width = `min(100%, ${MAX_WIDTH_PX[style.maxWidth]}px)`;
    container.margin = `${margin}px auto`;
  } else if (margin) container.margin = margin;
  return container;
}

function mapLegacyStyle(style: LegacyStyle | undefined): MappedStyle {
  const mobile = style?.mobile;
  return {
    container: style ? mapContainerStyle(style) : {},
    containerMobile: mobile?.padding && mobile.padding !== "none" ? { padding: SPACE_PX[mobile.padding] } : {},
    hiddenOnMobile: mobile?.hidden === true,
    text: style?.fontSize ? { fontSize: FONT_PX[style.fontSize] } : {},
    textMobile: mobile?.fontSize ? { fontSize: FONT_PX[mobile.fontSize] } : {},
    unsupported: style?.fontWeight ? ["字重"] : [],
  };
}

const hasKeys = (style: FunnelNodeStyle) => Object.keys(style).length > 0;
const isStyled = (mapped: MappedStyle) => hasKeys(mapped.container) || hasKeys(mapped.containerMobile);
const hasTextSize = (mapped: MappedStyle) => hasKeys(mapped.text) || hasKeys(mapped.textMobile);
const LOST_CONTAINER_STYLE = "區塊背景與間距（放在這個巢狀位置時無法套用）";

/* ------------------------------------------------------------------ */
/* Conversion state                                                    */
/* ------------------------------------------------------------------ */

type State = {
  ids: IdAllocator;
  htmlIds: Set<string>;
  issues: LegacyConversionIssue[];
  forms: readonly LandingPageFormReference[];
  live?: LandingPageLiveReference;
};

/** Restores ids, anchors and issues after a discarded trial conversion. */
function checkpoint(state: State): () => void {
  const restoreIds = state.ids.checkpoint();
  const htmlIds = new Set(state.htmlIds);
  const issues = state.issues.length;
  return () => {
    restoreIds();
    state.htmlIds.clear(); htmlIds.forEach((id) => state.htmlIds.add(id));
    state.issues.length = issues;
  };
}

function report(state: State, block: LegacyBlock, message: string) {
  state.issues.push({ blockId: block.props.id, blockType: block.type, blockLabel: LEGACY_BLOCK_LABELS[block.type] ?? String(block.type), message });
}

function reportUnsupportedStyle(state: State, block: LegacyBlock, names: string[]) {
  if (names.length) report(state, block, `這些樣式在新版編輯器沒有對應設定，已略過：${[...new Set(names)].join("、")}。`);
}

/** Legacy actions become a single equivalent button action. */
function convertAction(state: State, block: LegacyBlock, action: LandingPageAction, label: string): FunnelNodeAction {
  if (action.type === "external") return { type: "open_url", href: action.href, newTab: false };
  if (action.type === "anchor") return { type: "open_url", href: `#${action.targetId}`, newTab: false };
  const form = state.forms.find((candidate) => candidate.id === action.formId);
  if (!form) {
    report(state, block, `「${label}」原本連到的報名表已停用或不屬於這個專案，按鈕暫時沒有動作，請重新設定。`);
    return { type: "none" };
  }
  // Keep the form binding itself: the renderer resolves the slug and the bound live from server records,
  // and the server re-validates the form on every save, publish and public load.
  return { type: "registration", formId: form.id, useBoundLive: true };
}

/** Merchant-facing description of where a legacy action led. */
function describeAction(state: State, action: LandingPageAction): string {
  if (action.type === "external") return `「${action.href}」`;
  if (action.type === "anchor") return `頁面錨點 #${action.targetId}`;
  const form = state.forms.find((candidate) => candidate.id === action.formId);
  return form ? `報名表「${form.name}」` : "已停用或不屬於這個專案的報名表";
}

function button(state: State, block: LegacyBlock, id: string, label: string, action: LandingPageAction, style: FunnelNodeStyle): FunnelNode {
  const result = node("button", id, { label }, style);
  result.actions = [convertAction(state, block, action, label)];
  return result;
}

/** A CTA label without an action was never shown by the legacy renderer. */
function optionalCta(state: State, block: LegacyBlock, base: string, label: string | undefined, action: LandingPageAction | undefined, style: FunnelNodeStyle): FunnelNode[] {
  if (!label) return [];
  if (!action) {
    report(state, block, `按鈕文字「${label}」沒有設定動作，舊版頁面原本就不會顯示它，因此沒有建立按鈕。`);
    return [];
  }
  return [button(state, block, state.ids.derive(base, "cta"), label, action, style)];
}

/** YouTube / Vimeo links the legacy renderer embedded in an iframe. */
export function legacyVideoEmbedUrl(src: string): string | null {
  try {
    const url = new URL(src);
    const host = url.hostname.toLowerCase();
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      const id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,})$/u)?.[1];
      return id && /^[A-Za-z0-9_-]{6,}$/u.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === "youtu.be" || host === "www.youtu.be") {
      const id = url.pathname.match(/^\/([A-Za-z0-9_-]{6,})$/u)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
      const id = url.pathname.match(/^(?:\/video)?\/([0-9]{6,})$/u)?.[1];
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch { /* An unparseable URL is treated as a direct video file, like the legacy renderer. */ }
  return null;
}

/* ------------------------------------------------------------------ */
/* Block conversion                                                    */
/* ------------------------------------------------------------------ */

/**
 * `owns` is false for a top-level block: its section row already carries the
 * block's container style, and the block only emits content. Otherwise the
 * block applies its own style (on the leaf, or on a wrapping content box when
 * the position allows one).
 */
function convertBlocks(state: State, blocks: readonly LegacyBlock[], ctx: Ctx): FunnelNode[] {
  return blocks.flatMap((block) => convertBlock(state, block, ctx, true));
}

function convertBlock(state: State, block: LegacyBlock, ctx: Ctx, owns: boolean): FunnelNode[] {
  switch (block.type) {
    case "Heading": return leaf(state, block, ctx, owns, node("headline", "", { text: block.props.text, level: block.props.level }));
    case "Text": return leaf(state, block, ctx, owns, node("text", "", { text: block.props.text }));
    case "Image": return leaf(state, block, ctx, owns, node("image", "", { src: block.props.src, alt: block.props.alt, ...(block.props.caption ? { caption: block.props.caption } : {}) }, { imageWidth: 100 }));
    case "Video": return video(state, block, ctx, owns);
    case "Button": return leaf(state, block, ctx, owns, button(state, block, "", block.props.label, block.props.action, LEGACY_BUTTON));
    case "Section": return nestedSection(state, block, ctx);
    case "Columns": return columns(state, block, ctx, owns);
    case "Hero": return composite(state, block, ctx, owns, HERO_LOOK, (inner, ink, onLook) => hero(state, block, inner, ink, onLook));
    case "CTA": return composite(state, block, ctx, owns, CTA_LOOK, (inner, ink, onLook) => cta(state, block, inner, ink, onLook));
    case "Speaker": return composite(state, block, ctx, owns, undefined, (inner, ink) => speaker(state, block, inner, ink));
    case "Benefits": return composite(state, block, ctx, owns, undefined, (inner, ink) => benefits(state, block, inner, ink));
    case "Agenda": return composite(state, block, ctx, owns, undefined, (inner, ink) => agenda(state, block, inner, ink));
    case "Carousel": return composite(state, block, ctx, owns, undefined, (inner, ink) => carousel(state, block, inner, ink));
    case "Pricing": return composite(state, block, ctx, owns, undefined, (inner, ink) => pricing(state, block, inner, ink));
    case "Testimonials": return composite(state, block, ctx, owns, undefined, (inner, ink) => testimonials(state, block, inner, ink));
    case "FAQ": return composite(state, block, ctx, owns, undefined, (inner, ink) => faq(state, block, inner, ink), { keepElement: "faq" });
    case "Countdown": return composite(state, block, ctx, owns, COUNTDOWN_LOOK, (inner, ink) => countdown(state, block, inner, ink), { keepElement: "countdown" });
    default: return unsupportedBlock(state, block, ctx, owns);
  }
}

/** Defensive: a block type this converter does not know stays visible as a placeholder. */
function unsupportedBlock(state: State, block: LegacyBlock, ctx: Ctx, owns: boolean): FunnelNode[] {
  const type = String((block as { type?: unknown }).type ?? "未知");
  report(state, block, `「${type}」區塊沒有對應的新版元件，已保留為提示文字；公開頁不會顯示原本的內容，請改用新版元件重建。`);
  const id = owns ? state.ids.own(block.props.id) : state.ids.derive(block.props.id, "notice");
  const notice = `無法轉換的舊版區塊（${type}），請改用新版元件重建。`;
  if (!canGroup(ctx)) return [node("text", id, { text: notice })];
  return [node("content_box", id, {}, VIDEO_LINK_LOOK.style, [node("text", state.ids.derive(block.props.id, "notice-text"), { text: notice })])];
}

/** Heading, Text, Image, Video file, Button: one node that carries its own style. */
function leaf(state: State, block: LegacyBlock, ctx: Ctx, owns: boolean, target: FunnelNode): FunnelNode[] {
  const mapped = mapLegacyStyle(block.props.style);
  const unsupported = [...mapped.unsupported];
  if (target.type === "headline" || target.type === "text") {
    target.style = { ...target.style, ...mapped.text };
    if (hasKeys(mapped.textMobile)) setMobile(target, { style: mapped.textMobile });
  } else if (hasTextSize(mapped)) unsupported.push("字級");
  // Top level: the enclosing section already owns the legacy id and the container style.
  if (!owns) {
    reportUnsupportedStyle(state, block, unsupported);
    target.id = state.ids.derive(block.props.id, target.type);
    return [target];
  }
  // A legacy button's container style coloured the area around it, not the button itself.
  if (target.type === "button" && isStyled(mapped)) {
    if (canGroup(ctx)) {
      reportUnsupportedStyle(state, block, unsupported);
      const wrapper = node("content_box", state.ids.own(block.props.id), {}, { padding: 0, ...mapped.container }, [target]);
      target.id = state.ids.derive(block.props.id, "button");
      if (hasKeys(mapped.containerMobile)) setMobile(wrapper, { style: mapped.containerMobile });
      return hideOnMobile([wrapper], mapped.hiddenOnMobile);
    }
    const { textAlign, margin, width } = mapped.container;
    const kept: FunnelNodeStyle = { ...(textAlign ? { textAlign } : {}), ...(margin !== undefined ? { margin } : {}), ...(width !== undefined ? { width } : {}) };
    if (Object.keys(mapped.container).length > Object.keys(kept).length || hasKeys(mapped.containerMobile)) unsupported.push(LOST_CONTAINER_STYLE);
    reportUnsupportedStyle(state, block, unsupported);
    target.id = state.ids.own(block.props.id);
    target.style = { ...target.style, ...kept };
    return hideOnMobile([target], mapped.hiddenOnMobile);
  }
  reportUnsupportedStyle(state, block, unsupported);
  target.id = state.ids.own(block.props.id);
  target.style = { ...target.style, ...mapped.container };
  if (hasKeys(mapped.containerMobile)) setMobile(target, { style: mapped.containerMobile });
  return hideOnMobile([target], mapped.hiddenOnMobile);
}

const EMBED_NOTICE = "YouTube／Vimeo 影片在新版編輯器還沒有內嵌播放元件，已改為影片標題與「觀看影片」連結（另開新分頁）。";

function video(state: State, block: LegacyBlockOf<"Video">, ctx: Ctx, owns: boolean): FunnelNode[] {
  if (!legacyVideoEmbedUrl(block.props.src)) return leaf(state, block, ctx, owns, node("video", "", { src: block.props.src, title: block.props.title }));
  report(state, block, EMBED_NOTICE);
  return composite(state, block, ctx, owns, VIDEO_LINK_LOOK, (_inner, ink) => {
    const watch = node("button", state.ids.derive(block.props.id, "watch"), { label: "觀看影片" }, LEGACY_BUTTON);
    watch.actions = [{ type: "open_url", href: block.props.src, newTab: true }];
    return [node("headline", state.ids.derive(block.props.id, "title"), { text: block.props.title, level: "h3" }, withColor({}, ink)), watch];
  });
}

/**
 * Multi-node blocks. Top-level blocks (`owns` false) emit their content into
 * the section row, which carries their look. Nested blocks wrap their content
 * in a styled content box when the position allows one; elements a content box
 * cannot hold (`keepElement`) stay unwrapped so they keep working.
 *
 * `build` receives where its nodes go, the text colour for headings, and
 * whether they sit on the block's own look (for example white text on the
 * dark hero card) or on the plain page.
 */
function composite(
  state: State, block: LegacyBlock, ctx: Ctx, owns: boolean, look: Look | undefined,
  build: (inner: Ctx, ink: string | undefined, onLook: boolean) => FunnelNode[],
  options: { keepElement?: FunnelNodeType } = {},
): FunnelNode[] {
  const mapped = mapLegacyStyle(block.props.style);
  const unsupported = [...mapped.unsupported];
  if (hasTextSize(mapped)) unsupported.push("字級");
  if (!owns) {
    reportUnsupportedStyle(state, block, unsupported);
    return build(ctx, mapped.container.color ?? look?.style.color, Boolean(look));
  }
  const styled = isStyled(mapped);
  const keepUnwrapped = options.keepElement !== undefined && allowed(options.keepElement, ctx);
  if ((!look && !styled) || keepUnwrapped || !canGroup(ctx)) {
    if (styled) unsupported.push(LOST_CONTAINER_STYLE);
    reportUnsupportedStyle(state, block, unsupported);
    return hideOnMobile(build(ctx, mapped.container.color, false), mapped.hiddenOnMobile);
  }
  reportUnsupportedStyle(state, block, unsupported);
  const wrapper = node("content_box", state.ids.own(block.props.id), { gap: look?.gap ?? 16 }, { ...(look?.style ?? { padding: 0 }), ...mapped.container });
  wrapper.children = build("box", mapped.container.color ?? look?.style.color, Boolean(look));
  if (look?.mobile || hasKeys(mapped.containerMobile)) setMobile(wrapper, { style: { ...(look?.mobile ?? {}), ...mapped.containerMobile } });
  return hideOnMobile([wrapper], mapped.hiddenOnMobile);
}

function heading(state: State, base: string, role: string, text: string, level: "h1" | "h2" | "h3" | "h4", ink: string | undefined, style: FunnelNodeStyle = {}) {
  return node("headline", state.ids.derive(base, role), { text, level }, withColor(style, ink));
}
function paragraph(state: State, base: string, role: string, text: string, style: FunnelNodeStyle = {}, textStyle?: "lead" | "small" | "eyebrow") {
  return node("text", state.ids.derive(base, role), textStyle ? { text, textStyle } : { text }, style);
}
/** A card where content boxes are allowed; otherwise its children in sequence. */
function card(state: State, ctx: Ctx, base: string, role: string, style: FunnelNodeStyle, children: FunnelNode[], gap = 8): FunnelNode[] {
  return canGroup(ctx) ? [node("content_box", state.ids.derive(base, role), { gap }, style, children)] : children;
}
/** Item cards: side by side in a grid when placed directly in a row, otherwise stacked. */
function cards(state: State, ctx: Ctx, base: string, count: 2 | 3, build: (cellCtx: Ctx) => FunnelNode[][]): FunnelNode[] {
  const grid = ctx === "row";
  const items = build(grid ? "column" : ctx);
  if (!grid || items.length < 2) return items.flat();
  return [node(count === 3 ? "columns_3" : "columns_2", state.ids.derive(base, "grid"), { gap: 16 }, {}, items.flat())];
}

function hero(state: State, block: LegacyBlockOf<"Hero">, _ctx: Ctx, ink: string | undefined, onLook: boolean): FunnelNode[] {
  const { id, eyebrow, title, description, imageUrl, ctaLabel, ctaAction } = block.props;
  const nodes = [
    ...(eyebrow ? [paragraph(state, id, "eyebrow", eyebrow, onLook ? { color: COLOR.blue200 } : {}, "eyebrow")] : []),
    heading(state, id, "title", title, "h1", ink),
    ...(description ? [paragraph(state, id, "description", description, onLook ? { color: COLOR.blue100 } : {}, "lead")] : []),
    ...optionalCta(state, block, id, ctaLabel, ctaAction, onLook ? LEGACY_BUTTON_INVERSE : LEGACY_BUTTON),
  ];
  if (imageUrl) {
    report(state, block, "主視覺的背景圖片在新版沒有對應設定，已改成區塊內的一般圖片，請確認位置與大小。");
    nodes.push(node("image", state.ids.derive(id, "image"), { src: imageUrl, alt: "" }, { imageWidth: 100, borderRadius: 16 }));
  }
  return nodes;
}

function cta(state: State, block: LegacyBlockOf<"CTA">, _ctx: Ctx, ink: string | undefined, onLook: boolean): FunnelNode[] {
  const { id, title, description, ctaLabel, ctaAction } = block.props;
  return [
    heading(state, id, "title", title, "h2", ink),
    ...(description ? [paragraph(state, id, "description", description, onLook ? { color: COLOR.blue100 } : {})] : []),
    ...optionalCta(state, block, id, ctaLabel, ctaAction, onLook ? LEGACY_BUTTON_INVERSE : LEGACY_BUTTON),
  ];
}

function speaker(state: State, block: LegacyBlockOf<"Speaker">, _ctx: Ctx, ink: string | undefined): FunnelNode[] {
  const { id, name, role, bio, imageUrl } = block.props;
  return [
    ...(imageUrl ? [node("image", state.ids.derive(id, "photo"), { src: imageUrl, alt: `${name}照片` }, { width: "80px", imageWidth: 100, borderRadius: 500 })] : []),
    heading(state, id, "name", name, "h2", ink),
    ...(role ? [paragraph(state, id, "role", role, { color: COLOR.slate600 })] : []),
    ...(bio ? [paragraph(state, id, "bio", bio, { color: COLOR.slate700 })] : []),
  ];
}

function benefits(state: State, block: LegacyBlockOf<"Benefits">, ctx: Ctx, ink: string | undefined): FunnelNode[] {
  const { id, title, items } = block.props;
  return [
    ...(title ? [heading(state, id, "title", title, "h2", ink)] : []),
    ...cards(state, ctx, id, 2, (cellCtx) => items.map((item, index) => card(state, cellCtx, id, `item-${index + 1}`, { borderColor: COLOR.slate200, borderWidth: 1, borderRadius: 16, padding: 20 }, [
      heading(state, id, `item-${index + 1}-title`, item.title, "h3", ink),
      ...(item.description ? [paragraph(state, id, `item-${index + 1}-description`, item.description, { color: COLOR.slate600 })] : []),
    ]))),
  ];
}

function agenda(state: State, block: LegacyBlockOf<"Agenda">, ctx: Ctx, ink: string | undefined): FunnelNode[] {
  const { id, title, items } = block.props;
  return [
    ...(title ? [heading(state, id, "title", title, "h2", ink)] : []),
    ...items.flatMap((item, index) => card(state, ctx, id, `item-${index + 1}`, { padding: 0 }, [
      ...(item.time ? [paragraph(state, id, `item-${index + 1}-time`, item.time, { color: COLOR.blue700 }, "small")] : []),
      heading(state, id, `item-${index + 1}-title`, item.title, "h3", ink),
      ...(item.description ? [paragraph(state, id, `item-${index + 1}-description`, item.description, { color: COLOR.slate600 })] : []),
    ], 4)),
  ];
}

function carousel(state: State, block: LegacyBlockOf<"Carousel">, ctx: Ctx, ink: string | undefined): FunnelNode[] {
  const { id, title, slides } = block.props;
  report(state, block, "新版的輪播元件還不能放入圖片，已改成依序排列的圖片（含標題與說明），內容都有保留。");
  return [
    ...(title ? [heading(state, id, "title", title, "h2", ink)] : []),
    ...cards(state, ctx, id, 3, (cellCtx) => slides.map((slide, index) => card(state, cellCtx, id, `slide-${index + 1}`, { padding: 0 }, [
      node("image", state.ids.derive(id, `slide-${index + 1}-image`), { src: slide.imageUrl, alt: slide.alt }, { imageWidth: 100, borderRadius: 16 }),
      ...(slide.title ? [heading(state, id, `slide-${index + 1}-title`, slide.title, "h3", ink)] : []),
      ...(slide.description ? [paragraph(state, id, `slide-${index + 1}-description`, slide.description, { color: COLOR.slate600 })] : []),
    ]))),
  ];
}

function pricing(state: State, block: LegacyBlockOf<"Pricing">, ctx: Ctx, ink: string | undefined): FunnelNode[] {
  const { id, title, plans } = block.props;
  return [
    ...(title ? [heading(state, id, "title", title, "h2", ink)] : []),
    ...cards(state, ctx, id, 3, (cellCtx) => plans.map((plan, index) => {
      const base = `plan-${index + 1}`;
      return card(state, cellCtx, id, base, { backgroundColor: COLOR.white, borderColor: COLOR.slate200, borderWidth: 1, borderRadius: 16, padding: 24, shadow: "soft" }, [
        ...(plan.label ? [paragraph(state, id, `${base}-label`, plan.label, { color: COLOR.amber700 }, "small")] : []),
        heading(state, id, `${base}-name`, plan.name, "h3", undefined),
        heading(state, id, `${base}-price`, plan.price, "h4", undefined, { fontSize: 30 }),
        ...(plan.description ? [paragraph(state, id, `${base}-description`, plan.description, { color: COLOR.slate600 })] : []),
        ...(plan.features.length ? [node("bulleted_list", state.ids.derive(id, `${base}-features`), { items: [...plan.features] })] : []),
        ...(plan.action ? [button(state, block, state.ids.derive(id, `${base}-cta`), "選擇此方案", plan.action, LEGACY_BUTTON)] : []),
      ], 12);
    })),
  ];
}

function testimonials(state: State, block: LegacyBlockOf<"Testimonials">, ctx: Ctx, ink: string | undefined): FunnelNode[] {
  const { id, title, items } = block.props;
  return [
    ...(title ? [heading(state, id, "title", title, "h2", ink)] : []),
    ...cards(state, ctx, id, 2, (cellCtx) => items.map((item, index) => card(state, cellCtx, id, `item-${index + 1}`, { backgroundColor: COLOR.slate50, borderRadius: 16, padding: 20 }, [
      paragraph(state, id, `item-${index + 1}-quote`, `「${item.quote}」`),
      ...(item.imageUrl ? [node("image", state.ids.derive(id, `item-${index + 1}-photo`), { src: item.imageUrl, alt: "" }, { width: "32px", imageWidth: 100, borderRadius: 500 })] : []),
      heading(state, id, `item-${index + 1}-name`, `${item.name}${item.role ? `｜${item.role}` : ""}`, "h4", undefined, { fontSize: 16 }),
    ]))),
  ];
}

function faq(state: State, block: LegacyBlockOf<"FAQ">, ctx: Ctx, ink: string | undefined): FunnelNode[] {
  const { id, title, items } = block.props;
  const titleNodes = title ? [heading(state, id, "title", title, "h2", ink)] : [];
  if (allowed("faq", ctx)) {
    return [...titleNodes, node("faq", state.ids.derive(id, "items"), { question: title ?? "常見問題", items: items.map((item) => ({ question: item.question, answer: item.answer })) })];
  }
  report(state, block, "常見問題放在巢狀區段內時無法使用可展開的問答元件，已改成問題與答案依序排列。");
  return [...titleNodes, ...items.flatMap((item, index) => card(state, ctx, id, `item-${index + 1}`, { borderColor: COLOR.slate200, borderWidth: 1, borderRadius: 12, padding: 16 }, [
    heading(state, id, `item-${index + 1}-question`, item.question, "h4", ink),
    paragraph(state, id, `item-${index + 1}-answer`, item.answer, { color: COLOR.slate600 }),
  ]))];
}

const EXPIRED_ACTION_LABEL = { show_message: "顯示", hide_cta: "隱藏報名按鈕", redirect: "轉址到" } as const;

function countdown(state: State, block: LegacyBlockOf<"Countdown">, ctx: Ctx, ink: string | undefined): FunnelNode[] {
  const { id, title, mode, targetAt, ctaLabel, ctaAction, expiredMessage, expiredAction, expiredRedirect } = block.props;
  let target = mode === "fixed_date" ? targetAt : undefined;
  if (mode === "live_linked") {
    if (state.live?.scheduledAt) {
      target = state.live.scheduledAt;
      report(state, block, `原本依直播開播時間倒數，已改為固定截止時間（${state.live.scheduledAt}）；若直播改期，請手動更新倒數時間。`);
    } else report(state, block, "原本依直播開播時間倒數，但目前沒有綁定直播場次，請設定倒數的截止時間。");
  }
  const expiry = expiredAction === "show_message" ? `${EXPIRED_ACTION_LABEL.show_message}「${expiredMessage}」`
    : expiredAction === "redirect" ? `${EXPIRED_ACTION_LABEL.redirect}${expiredRedirect ? describeAction(state, expiredRedirect) : "指定頁面"}`
      : EXPIRED_ACTION_LABEL[expiredAction];
  report(state, block, `倒數結束後原本會${expiry}；新版倒數元件尚不支援到期處理，結束時會停在 0，請視需要手動調整頁面。`);
  const titleNodes = title ? [heading(state, id, "title", title, "h2", ink)] : [];
  const cta = optionalCta(state, block, id, ctaLabel, ctaAction, LEGACY_BUTTON);
  if (allowed("countdown", ctx)) {
    return [...titleNodes, node("countdown", state.ids.derive(id, "timer"), { ...(target ? { targetDate: target } : {}), expiredMessage, expiredAction }), ...cta];
  }
  report(state, block, "倒數計時放在巢狀區段內時無法使用倒數元件，已改成顯示截止時間的文字。");
  return [...titleNodes, paragraph(state, id, "deadline", target ? `截止時間：${target}` : "截止時間：尚未設定"), ...cta];
}

function claimAnchor(state: State, block: LegacyBlockOf<"Section">): string | undefined {
  const anchor = block.props.anchorId;
  if (!anchor) return undefined;
  if (state.htmlIds.has(anchor)) {
    report(state, block, `錨點「${anchor}」與前面的區段重複，新版頁面的錨點必須唯一，這個區段的錨點已移除。`);
    return undefined;
  }
  state.htmlIds.add(anchor);
  return anchor;
}

/** A Section nested inside another section or a column. */
function nestedSection(state: State, block: LegacyBlockOf<"Section">, ctx: Ctx): FunnelNode[] {
  const mapped = mapLegacyStyle(block.props.style);
  const children = block.props.children as LegacyBlock[];
  const unsupported = [...mapped.unsupported];
  if (hasTextSize(mapped)) unsupported.push("字級");
  const anchor = claimAnchor(state, block);
  const styled = isStyled(mapped);
  if (canGroup(ctx) && (anchor || styled)) {
    reportUnsupportedStyle(state, block, unsupported);
    const wrapper = node("content_box", state.ids.own(block.props.id), { gap: 16 }, { padding: 0, ...mapped.container }, convertBlocks(state, children, "box"));
    if (anchor) wrapper.attributes = { id: anchor };
    if (hasKeys(mapped.containerMobile)) setMobile(wrapper, { style: mapped.containerMobile });
    return hideOnMobile([wrapper], mapped.hiddenOnMobile);
  }
  // An unstyled section only grouped its children; inside a box there is no group to keep.
  if (styled) unsupported.push(LOST_CONTAINER_STYLE);
  reportUnsupportedStyle(state, block, unsupported);
  const nodes = convertBlocks(state, children, ctx);
  if (anchor) {
    const first = nodes[0];
    if (first && !first.attributes.id) first.attributes = { ...first.attributes, id: anchor };
    else {
      state.htmlIds.delete(anchor);
      report(state, block, `錨點「${anchor}」在這個位置沒有可以掛上的內容，已移除；按鈕若連到這個錨點，請重新設定。`);
    }
  }
  return hideOnMobile(nodes, mapped.hiddenOnMobile);
}

function columns(state: State, block: LegacyBlockOf<"Columns">, ctx: Ctx, owns: boolean): FunnelNode[] {
  const { id, columns: count, ratio } = block.props;
  const slots = [block.props.first, block.props.second, block.props.third] as LegacyBlock[][];
  const visibleCount = count === "one" ? 1 : count === "three" ? 3 : 2;
  const mapped = mapLegacyStyle(block.props.style);
  const unsupported = [...mapped.unsupported];
  if (hasTextSize(mapped)) unsupported.push("字級");
  if (visibleCount === 2 && ratio !== "equal") unsupported.push("兩欄寬度比例（新版欄位固定等寬）");

  const group = (slot: LegacyBlock[], role: string, slotCtx: Ctx, converted?: FunnelNode[]) => card(state, slotCtx, id, role, { padding: 0 }, converted ?? convertBlocks(state, slot, canGroup(slotCtx) ? "box" : slotCtx), 16);
  let nodes: FunnelNode[];
  if (visibleCount === 1) {
    nodes = convertBlocks(state, slots[0]!, ctx);
  } else if (ctx === "row") {
    // A grid cell is one node: a single converted element, or a stack of them.
    const cells = slots.slice(0, visibleCount).map((slot, index) => {
      const restore = checkpoint(state);
      const converted = convertBlocks(state, slot, "column");
      if (converted.length === 1) return converted[0]!;
      if (converted.every((item) => allowed(item.type, "box"))) return group(slot, `column-${index + 1}`, "column", converted)[0]!;
      restore();
      return group(slot, `column-${index + 1}`, "column")[0]!;
    });
    nodes = [node(visibleCount === 3 ? "columns_3" : "columns_2", owns ? state.ids.own(id) : state.ids.derive(id, "grid"), { gap: 24 }, {}, cells)];
  } else {
    report(state, block, "欄位放在其他欄位或巢狀區段內時無法並排，已改成上下排列。");
    nodes = slots.slice(0, visibleCount).flatMap((slot, index) => group(slot, `column-${index + 1}`, ctx));
  }
  // Slots the legacy page never showed (for example the third slot of a two-column layout).
  slots.slice(visibleCount).forEach((slot, offset) => {
    if (!slot.length) return;
    const index = visibleCount + offset;
    const hidden = group(slot, `hidden-column-${index + 1}`, ctx);
    hidden.forEach((item) => { item.visible = false; });
    nodes.push(...hidden);
    report(state, block, `第 ${index + 1} 欄的內容在舊版頁面原本不會顯示，已保留為隱藏內容（公開頁不顯示，可在編輯器中檢視）。`);
  });

  if (!owns) { reportUnsupportedStyle(state, block, unsupported); return nodes; }
  const gridNode = nodes.length === 1 && (nodes[0]!.type === "columns_2" || nodes[0]!.type === "columns_3") ? nodes[0]! : null;
  if (gridNode) {
    // A grid node carries the legacy container style itself.
    reportUnsupportedStyle(state, block, unsupported);
    gridNode.style = { ...gridNode.style, ...mapped.container };
    if (hasKeys(mapped.containerMobile)) setMobile(gridNode, { style: mapped.containerMobile });
    return hideOnMobile(nodes, mapped.hiddenOnMobile);
  }
  if (isStyled(mapped) && canGroup(ctx) && nodes.every((item) => allowed(item.type, "box"))) {
    reportUnsupportedStyle(state, block, unsupported);
    const wrapper = node("content_box", state.ids.derive(id, "box"), { gap: 16 }, { padding: 0, ...mapped.container }, nodes);
    if (hasKeys(mapped.containerMobile)) setMobile(wrapper, { style: mapped.containerMobile });
    return hideOnMobile([wrapper], mapped.hiddenOnMobile);
  }
  if (isStyled(mapped)) unsupported.push(LOST_CONTAINER_STYLE);
  reportUnsupportedStyle(state, block, unsupported);
  return hideOnMobile(nodes, mapped.hiddenOnMobile);
}

/* ------------------------------------------------------------------ */
/* Top level                                                           */
/* ------------------------------------------------------------------ */

function topLevelLook(block: LegacyBlock): Look | undefined {
  if (block.type === "Hero") return HERO_LOOK;
  if (block.type === "CTA") return CTA_LOOK;
  if (block.type === "Countdown") return COUNTDOWN_LOOK;
  if (block.type === "Video" && legacyVideoEmbedUrl(block.props.src)) return VIDEO_LINK_LOOK;
  return undefined;
}

/** Keeps only text-size keys; the caller already moved the container style to the row. */
function withoutContainerStyle(block: LegacyBlock): LegacyBlock {
  const style = block.props.style;
  if (!style) return block;
  const kept: LegacyStyle = {
    ...(style.fontSize ? { fontSize: style.fontSize } : {}),
    ...(style.fontWeight ? { fontWeight: style.fontWeight } : {}),
    ...(style.mobile?.fontSize ? { mobile: { fontSize: style.mobile.fontSize } } : {}),
  };
  return { ...block, props: { ...block.props, style: kept } } as LegacyBlock;
}

/** Every top-level legacy block becomes Section › Row; the row reproduces the legacy page column and the block's style. */
function topLevelSection(state: State, block: LegacyBlock): FunnelNode {
  const mapped = mapLegacyStyle(block.props.style);
  const look = topLevelLook(block);
  const anchor = block.type === "Section" ? claimAnchor(state, block) : undefined;
  const sectionId = state.ids.own(block.props.id);
  let children: FunnelNode[];
  if (block.type === "Section") {
    const unsupported = [...mapped.unsupported];
    if (hasTextSize(mapped)) unsupported.push("字級");
    reportUnsupportedStyle(state, block, unsupported);
    children = convertBlocks(state, block.props.children as LegacyBlock[], "row");
  } else {
    children = convertBlock(state, withoutContainerStyle(block), "row", false);
  }
  const margin = mapped.container.margin ?? 0;
  const rowStyle: FunnelNodeStyle = {
    ...(look?.style ?? {}), ...mapped.container,
    width: mapped.container.width ?? `min(100%, ${PAGE_CONTENT_WIDTH}px)`,
    margin: typeof margin === "number" ? `${margin}px auto` : margin,
  };
  const row = node("row", state.ids.derive(block.props.id, "row"), { gap: look?.gap ?? 20 }, rowStyle, children);
  if (look?.mobile || hasKeys(mapped.containerMobile)) setMobile(row, { style: { ...(look?.mobile ?? {}), ...mapped.containerMobile } });
  // Legacy pages spaced blocks 48–64px apart inside a 32px page padding.
  const section = node("section", sectionId, {}, { padding: "32px 24px" }, [row]);
  setMobile(section, { style: { padding: "24px 16px" }, ...(mapped.hiddenOnMobile ? { visible: false } : {}) });
  if (anchor) section.attributes = { id: anchor };
  return section;
}

function pageSettings(state: State, content: LandingPageContent, document: PageDocument): PageDocument["settings"] {
  const root = content.data.root.props;
  const settings = structuredClone(document.settings);
  if (root?.title) settings.seo.title = root.title;
  if (root?.description) settings.seo.description = root.description;
  if (root?.shareImage) settings.seo.socialImage = root.shareImage;
  const style = root?.style;
  if (style?.backgroundColor) settings.background.color = style.backgroundColor;
  if (style?.color) settings.typography.textColor = style.color;
  if (style?.textAlign) settings.typography.alignment = style.textAlign;
  const ignored = [
    style?.padding ? "頁面內距" : null, style?.margin ? "頁面外距" : null, style?.maxWidth ? "頁面最大寬度" : null,
    style?.borderRadius ? "頁面圓角" : null, style?.fontSize ? "頁面字級" : null, style?.fontWeight ? "頁面字重" : null, style?.mobile ? "頁面手機版設定" : null,
  ].filter((value): value is string => Boolean(value));
  if (ignored.length) state.issues.push({ blockId: "page", blockType: "Page", blockLabel: "頁面設定", message: `這些頁面樣式在新版編輯器沒有對應設定，已略過：${ignored.join("、")}。` });
  return settings;
}

/** Converts already-parsed legacy content (the editor receives it parsed from the server). */
export function convertParsedLegacyLandingPage(content: LandingPageContent, options: LegacyConversionOptions = {}): LegacyLandingPageConversion {
  const blocks = content.data.content;
  const state: State = {
    ids: new IdAllocator(collectLegacyIds(blocks)), htmlIds: new Set(), issues: [],
    forms: options.forms ?? [], ...(options.live ? { live: options.live } : {}),
  };
  const base = createEmptyPageDocument(options.id ?? "legacy-page", options.name ?? content.data.root.props?.title ?? "未命名頁面");
  let root: FunnelNode[];
  try { root = blocks.map((block) => topLevelSection(state, block)); } catch { return { ok: false, reason: "conversion_invalid" }; }
  const document = parsePageDocument({ ...base, root, settings: pageSettings(state, content, base) });
  return document ? { ok: true, document, issues: state.issues } : { ok: false, reason: "conversion_invalid" };
}

/** Validates an untrusted legacy value first; fails closed on anything that is not valid v1 content. */
export function convertLegacyLandingPage(value: unknown, options: LegacyConversionOptions = {}): LegacyLandingPageConversion {
  const content = parseLandingPageContent(value);
  if (!content) return { ok: false, reason: "invalid_legacy_content" };
  return convertParsedLegacyLandingPage(content, options);
}
