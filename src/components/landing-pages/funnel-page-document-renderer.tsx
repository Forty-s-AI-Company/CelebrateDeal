"use client";
import { useRegistrationRetry } from "@/components/registration-retry-context";
import { flushSync } from "react-dom";

/* eslint-disable @next/next/no-img-element */

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { RegistrationSubmissionFeedback } from "@/components/registration-submission-feedback";
import { LandingPageLink } from "@/components/landing-page-link";
import { useFunnelRegistrationLinks } from "./funnel-registration-links";
import { funnelRegistrationHref } from "@/lib/funnel-registration-action";
import { formSubmissionErrorMessage, FORM_SUBMISSION_VERIFICATION_MESSAGE, postRegistrationSubmission } from "@/lib/registration-submission-client";
import type { RegistrationFormFieldSpec } from "@/lib/registration-form-fields";
import type { FunnelCommerceBinding, FunnelCommerceView } from "@/lib/funnel-commerce";
import { FunnelCommerceElement } from "./funnel-commerce-element";
import { ConsultationBookingBlock } from "@/components/funnel-blocks/consultation-booking-block";
import { FunnelDocumentCarousel } from "./funnel-document-carousel";
import { FunnelSurvey } from "./funnel-survey";
import { SandboxedCustomCode } from "./sandboxed-html";
import { funnelCustomCodeOf, hasFunnelCustomScript } from "@/lib/funnel-custom-code";
import { compileFunnelCustomCss } from "@/lib/funnel-custom-css";
import { InlineEditableText } from "./funnel-inline-editable";
import { safeContentAssetUrl, safeContentHref } from "@/lib/safe-url";
import { ContentCardsElement, FUNNEL_SHOWCASE_ACCENT, IconListElement, ImageCardsElement, LogoStripElement, NavBarElement, SectionTitleElement, ShapeDividerElement, StatsElement, TestimonialWallElement, VideoGalleryElement, type ShowcaseElementProps } from "./funnel-showcase-elements";
import { showcaseChoice, showcaseColor, showcaseNumber } from "@/lib/funnel-showcase";
import { CountdownElement, WEBINAR_ELEMENTS, type WebinarElementProps } from "./funnel-webinar-elements";
import { FunnelEventContext, useFunnelEvent, useFunnelNow } from "./funnel-event-context";
import { FunnelStickyCtaBar, FunnelStickyCtaSpacer, funnelStickyCtaVisibleOn, useFunnelScrollReveal } from "./funnel-page-chrome";
import { FUNNEL_FONT_VARIABLES } from "./funnel-fonts";
import { funnelEventPhase, funnelEventSchedule, resolveFunnelEventFields, FUNNEL_EVENT_PHASE_LABELS } from "@/lib/funnel-event-time";
import { WEBINAR_STATE_LABELS, webinarStateKey, type WebinarStateKey } from "@/lib/funnel-webinar-elements";

import {
  createEmptyPageDocument,
  getFunnelNodeDefinition,
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type FunnelNodeStyle,
  type PageDocument,
} from "@/lib/funnel-page-document";
import {
  funnelButtonDefaults,
  funnelHeadingLevel,
  funnelLayoutTokens,
  funnelPageTypographyStyle,
  funnelTypographyDefaults,
  funnelTypographyKind,
  parseFunnelColor,
  resolveFunnelTypography,
  type FunnelTypographyTokens,
} from "@/lib/funnel-typography";

const CommerceRenderContext = createContext<{ binding?: FunnelCommerceBinding; commerce?: FunnelCommerceView }>({});
/** Page typography for this render; every surface reads the same tokens (editor, preview, public). */
const TypographyContext = createContext<FunnelTypographyTokens>(resolveFunnelTypography(createEmptyPageDocument().settings, "desktop"));

/** I-1: <= 639px mobile, 640-1079px tablet, >= 1080px desktop (`funnelViewportForWidth`). */
export type FunnelViewport = "desktop" | "tablet" | "mobile";
export type FunnelRenderMode = "editor" | "preview";

/** Where a canvas click landed: the list entry (if any) and the pointer, for inline editing. */
export type FunnelNodeSelectDetail = { itemIndex?: number; point?: { x: number; y: number } };

/**
 * Inline text editing of one node on the editor canvas. Honoured only in
 * `mode="editor"`; preview and public renders never become editable.
 */
export type FunnelInlineEditingBinding = {
  nodeId: string;
  itemIndex?: number;
  caret?: { x: number; y: number };
  onCommit: (value: string, context: { previous: string; items?: string[] }) => void;
  onCancel: () => void;
};

export type FunnelPageDocumentRendererProps = {
  document: PageDocument;
  viewport?: FunnelViewport;
  mode?: FunnelRenderMode;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string, detail?: FunnelNodeSelectDetail) => void;
  inlineEditing?: FunnelInlineEditingBinding;
  className?: string;
  submission?: FunnelSubmissionContext;
  publicSurface?: boolean;
  commerce?: FunnelCommerceView;
  consultation?: { csrfToken: string; events: Array<{ id: string; title: string; description: string | null; timezone: string; durationMinutes: number; intakeFormFields: unknown }> };
  /** Render the page root as `<main>` (default). Thumbnails and nested previews pass false to avoid extra landmarks. */
  landmark?: boolean;
  /**
   * Server-provided event data (I-5): the funnel registration deadline and the
   * server render time, so time-dependent elements hydrate without drift.
   */
  event?: FunnelRenderEvent;
};

export type FunnelRenderEvent = { registrationClosesAt?: string | null; renderedAt?: number };

export type FunnelSubmissionContext = {
  form: { id: string; fields: RegistrationFormFieldSpec[]; submitLabel: string; successMessage: string };
  landingPageId: string;
  /** A public route supplies this server-resolved step for trusted attribution. */
  funnelStepId?: string;
  liveId?: string;
  redirectTo?: string;
  /** Shown under a designed form's submit button before submission (webinar: email confirmation notice). */
  notice?: string;
  /**
   * Submit with the browser's native POST (the server redirects with its own
   * feedback query), exactly like the webinar fallback form. Fields stay
   * enabled while the browser serialises them.
   */
  nativeSubmit?: boolean;
};

type ResolvedNode = {
  props: Record<string, unknown>;
  style: FunnelNodeStyle;
  visible: boolean;
};

const LABELS: Record<FunnelNode["type"], string> = {
  text: "文字",
  headline: "標題",
  bulleted_list: "項目清單",
  content_box: "內容盒",
  image: "圖片",
  video: "影片",
  audio: "音訊",
  carousel: "輪播",
  columns_4: "四欄",
  columns_3: "三欄",
  columns_2: "兩欄",
  row: "列",
  section: "區段",
  form: "表單",
  form_input: "表單欄位",
  button: "按鈕",
  checkbox: "核取方塊",
  calendar: "行事曆",
  x_share_button: "X 分享按鈕",
  survey: "問卷",
  countdown: "倒數計時",
  menu: "選單",
  horizontal_line: "水平線",
  raw_html: "自訂程式碼",
  faq: "常見問題",
  recaptcha: "reCAPTCHA",
  payment_button: "付款按鈕",
  payment_method: "付款方式",
  customer_type: "客戶類型",
  physical_product: "實體商品",
  offer_price: "優惠價格",
  agreement: "同意條款",
  order_bump: "加購方案",
  coupon: "優惠碼",
  two_step_order_form: "兩步驟訂單表單",
  shipping_fees: "運費",
  paid_calendar: "付費行事曆",
  nav_bar: "導覽列",
  logo_strip: "Logo 列",
  stats: "數據統計",
  icon_list: "圖示重點",
  shape_divider: "分隔形狀",
  section_title: "區塊標題組",
  image_cards: "圖片卡片",
  testimonial_wall: "評價牆",
  content_cards: "文章卡片",
  video_gallery: "影片牆",
  event_facts: "活動資訊列",
  speaker_profiles: "講者卡",
  agenda_timeline: "議程時間軸",
  callout: "提示框",
  fit_compare: "適合／不適合",
  add_to_calendar: "加入行事曆",
  announcement_bar: "頂部公告條",
  value_stack: "價值清單",
  session_schedule: "場次表",
  deadline_notice: "報名截止提示",
  webinar_state: "依活動狀態切換",
  media_frame: "裝置框",
  image_gallery: "作品集圖庫",
  code_snippet: "程式碼片段",
};

function stringProp(props: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    if (typeof props[key] === "string" && props[key].trim()) return props[key].trim();
  }
  return fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const text = stringProp(record, ["text", "label", "title", "item"]);
      return text ? [text] : [];
    }
    return [];
  });
}

/** Link targets from page content (path, `#anchor` or HTTPS); media sources use safeContentAssetUrl. Rules live in `@/lib/safe-url`. */
function safeResourceUrl(value: unknown): string | null {
  return safeContentHref(value);
}

function safeAttributeName(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_:-]{0,63}$/u.test(value) && !value.toLowerCase().startsWith("on");
}

function safeAttributes(attributes: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!safeAttributeName(key) || /[<>]/u.test(value) || /^javascript:/iu.test(value)) continue;
    if (["style", "src", "href", "children", "dangerouslysetinnerhtml"].includes(key.toLowerCase())) continue;
    result[key === "class" ? "className" : key] = value;
  }
  return result;
}

function cssToken(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim() || /[{};<>]/u.test(value) || /\b(?:javascript|data|vbscript|expression|url)\s*:/iu.test(value)) return undefined;
  return value.trim();
}

function color(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^(#[0-9a-f]{3,8}|rgb\([0-9, .]+\)|rgba\([0-9, .]+\)|transparent|white|black)$/iu.test(value.trim())) return undefined;
  return value.trim();
}

function pxOrToken(value: unknown): string | number | undefined {
  const safe = cssToken(value);
  if (typeof safe === "number") return `${safe}px`;
  return safe;
}

function percentageOrToken(value: unknown): string | number | undefined {
  const safe = cssToken(value);
  if (typeof safe === "number") return `${safe}%`;
  return safe;
}

function nodeStyle(style: FunnelNodeStyle): CSSProperties {
  const result: CSSProperties = {};
  const fontSize = pxOrToken(style.fontSize);
  const lineHeight = cssToken(style.lineHeight);
  const letterSpacing = pxOrToken(style.letterSpacing);
  const width = percentageOrToken(style.width);
  const height = pxOrToken(style.height);
  const padding = pxOrToken(style.padding);
  const margin = pxOrToken(style.margin);
  const borderWidth = pxOrToken(style.borderWidth);
  const borderRadius = pxOrToken(style.borderRadius);
  if (fontSize !== undefined) result.fontSize = fontSize;
  if (lineHeight !== undefined) result.lineHeight = lineHeight;
  if (letterSpacing !== undefined) result.letterSpacing = letterSpacing;
  if (width !== undefined) result.width = width;
  if (height !== undefined) result.height = height;
  if (padding !== undefined) result.padding = padding;
  if (margin !== undefined) result.margin = margin;
  if (style.textAlign) result.textAlign = style.textAlign;
  if (style.align) result.alignItems = style.align;
  if (style.direction) {
    result.display = "flex";
    result.flexDirection = style.direction;
  }
  if (style.backgroundColor) result.backgroundColor = color(style.backgroundColor);
  if (style.color) result.color = color(style.color);
  if (style.borderColor) result.borderColor = color(style.borderColor);
  if (borderWidth !== undefined) result.borderWidth = borderWidth;
  if (borderRadius !== undefined) result.borderRadius = borderRadius;
  if (style.borderColor || borderWidth !== undefined) result.borderStyle = "solid";
  if (style.shadow && style.shadow !== "none") result.boxShadow = style.shadow === "soft" ? "0 1px 3px rgba(15, 23, 42, 0.12)" : style.shadow === "medium" ? "0 8px 24px rgba(15, 23, 42, 0.16)" : "0 16px 40px rgba(15, 23, 42, 0.2)";
  return result;
}

/** Image sizing belongs on the `<img>` itself, not its wrapper. */
function imageStyle(style: FunnelNodeStyle): CSSProperties {
  // Inline-level so the inherited text alignment positions narrower images (avatars, logos).
  const result: CSSProperties = { display: "inline-block", verticalAlign: "top", maxWidth: "100%", height: "auto" };
  const width = percentageOrToken(style.imageWidth);
  const height = pxOrToken(style.imageHeight);
  const borderRadius = pxOrToken(style.borderRadius);
  if (width !== undefined) result.width = width;
  if (height !== undefined) { result.height = height; result.objectFit = "cover"; }
  if (borderRadius !== undefined) result.borderRadius = borderRadius;
  return result;
}

const BUTTON_WRAPPER_KEYS = new Set<string>(["width", "margin", "textAlign", "align", "direction"]);

/** A button's visual style (colour, border, padding, type) styles the control; layout keys stay on the wrapper. */
function splitButtonStyle(style: FunnelNodeStyle): { wrapper: FunnelNodeStyle; control: FunnelNodeStyle } {
  const wrapper: Record<string, unknown> = {};
  const control: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) (BUTTON_WRAPPER_KEYS.has(key) ? wrapper : control)[key] = value;
  return { wrapper: wrapper as FunnelNodeStyle, control: control as FunnelNodeStyle };
}

function buttonControlStyle(style: FunnelNodeStyle, tokens: FunnelTypographyTokens): CSSProperties {
  const { control, wrapper } = splitButtonStyle(style);
  return { ...funnelTypographyDefaults("button", tokens), ...funnelButtonDefaults(tokens), ...nodeStyle(control), ...(wrapper.width !== undefined ? { width: "100%" } : {}) };
}

/** Bounded numeric layout prop (row max width, gaps) or the fallback. */
function layoutNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

const GRID_ALIGN: Record<NonNullable<FunnelNodeStyle["align"]>, CSSProperties["alignItems"]> = { start: "start", center: "center", end: "end", stretch: "stretch" };

/** Base, then the viewport override. Tablet applies `desktop` (it meant "640px and up" before I-1) and then `tablet`. */
export function resolveFunnelNode(node: Pick<FunnelNode, "props" | "style" | "visible" | "overrides">, viewport: FunnelViewport): ResolvedNode {
  const layers = viewport === "tablet" ? [node.overrides.desktop, node.overrides.tablet] : [node.overrides[viewport]];
  let resolved: ResolvedNode = { props: { ...node.props }, style: { ...node.style }, visible: node.visible };
  for (const override of layers) {
    if (!override) continue;
    resolved = { props: { ...resolved.props, ...(override.props ?? {}) }, style: { ...resolved.style, ...(override.style ?? {}) }, visible: override.visible ?? resolved.visible };
  }
  return resolved;
}
const resolveNode = resolveFunnelNode;

const COLUMN_RATIOS: Readonly<Record<string, readonly [number, number]>> = { "1:1": [1, 1], "7:5": [7, 5], "5:7": [5, 7], "3:2": [3, 2], "2:3": [2, 3], "2:1": [2, 1], "1:2": [1, 2] };

/**
 * Column layout (I-1, C-05). Mobile stacks; tablet stacks when `stackOn` is
 * "tablet", otherwise 3-4 columns become 2. `ratio` sizes a 2-column row on
 * desktop/tablet. When stacked, `mobileOrder: "reverse"` reverses the DOM
 * order, so reading and focus order follow what visitors see.
 */
export function funnelColumnsLayout(type: "columns_2" | "columns_3" | "columns_4", props: Record<string, unknown>, viewport: FunnelViewport): { template: string; stacked: boolean; reversed: boolean } {
  const count = type === "columns_2" ? 2 : type === "columns_3" ? 3 : 4;
  const stacked = viewport === "mobile" || (viewport === "tablet" && props.stackOn === "tablet");
  if (stacked) return { template: "minmax(0, 1fr)", stacked, reversed: props.mobileOrder === "reverse" };
  const ratio = count === 2 && typeof props.ratio === "string" ? COLUMN_RATIOS[props.ratio] : undefined;
  if (ratio) return { template: `minmax(0, ${ratio[0]}fr) minmax(0, ${ratio[1]}fr)`, stacked, reversed: false };
  const columns = viewport === "tablet" ? Math.min(count, 2) : count;
  return { template: `repeat(${columns}, minmax(0, 1fr))`, stacked, reversed: false };
}

function safeAction(action: unknown): { href: string; newTab: boolean; download?: string } | null {
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  const record = action as Record<string, unknown>;
  if (record.type !== "open_url" && record.type !== "download") return null;
  const href = safeResourceUrl(record.href);
  if (!href) return null;
  const result: { href: string; newTab: boolean; download?: string } = { href, newTab: record.newTab === true };
  if (record.type === "download" && typeof record.fileName === "string" && /^[^\u0000-\u001f<>]{1,240}$/u.test(record.fileName)) result.download = record.fileName.trim();
  return result;
}

function actionType(action: unknown): string | null {
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  const type = (action as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

function safeInputType(value: unknown): "text" | "email" | "tel" | "number" | "date" | "url" | "password" {
  return value === "email" || value === "tel" || value === "number" || value === "date" || value === "url" || value === "password" ? value : "text";
}

function safeNodeName(node: FunnelNode, props: Record<string, unknown>, fallback: string): string {
  const value = stringProp(props, ["name", "fieldName", "id"], node.id || fallback);
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(value) ? value : fallback;
}

function safeDateTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeMenuItems(value: unknown): Array<{ label: string; href: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ label: item.trim(), href: null }];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const label = stringProp(record, ["label", "text", "title"], "");
    if (!label) return [];
    return [{ label, href: safeResourceUrl(record.href ?? record.url ?? record.target) }];
  });
}

function safeMediaSource(props: Record<string, unknown>): string | null {
  return safeContentAssetUrl(props.src ?? props.url ?? props.mediaUrl ?? props.videoUrl ?? props.audioUrl);
}

function capabilityMessage(node: FunnelNode): string {
  const definition = getFunnelNodeDefinition(node.type);
  if (definition.capability.status !== "available") return `功能狀態：${definition.capability.status === "disabled" ? "已停用" : definition.capability.status === "limited" ? "有限支援" : "待驗證"}。${definition.capability.reason}`;
  return "此元件目前尚未接上安全渲染器，內容仍可在編輯器中保留。";
}

/** Size, weight and colour are inherited from the surface's typography defaults (Tailwind preflight resets headings to `inherit`). */
function HeadlineMarkup({ level, text }: { level: string; text: string }) {
  const className = "whitespace-pre-line";
  switch (level) {
    case "h1": return <h1 className={className}>{text}</h1>;
    case "h3": return <h3 className={className}>{text}</h3>;
    case "h4": return <h4 className={className}>{text}</h4>;
    case "h5": return <h5 className={className}>{text}</h5>;
    case "h6": return <h6 className={className}>{text}</h6>;
    default: return <h2 className={className}>{text}</h2>;
  }
}

/** Validated server attribution (draft or page query), sent only when present. */
function referralFields(attribution: { referralCode?: string; shareCode?: string } | undefined) {
  return {
    ...(attribution?.referralCode ? { referralCode: attribution.referralCode } : {}),
    ...(attribution?.shareCode ? { shareCode: attribution.shareCode } : {}),
  };
}

/**
 * C-19（最小集合）：公開報名表沿用頁面上表單節點的設計。欄位的 key、標籤、類型、
 * 必填與送出文字一律來自伺服器的報名表設定（與既有公開表單相同；資料只送進平台
 * 自己的報名紀錄）；頁面上的 `form_input` 依欄位 key（或 Email／電話類型）提供
 * 提示文字、說明與半寬，`button` 提供送出按鈕樣式；必填的 `checkbox` 只決定是否
 * 需要同意（文字沿用平台用語），其他節點（標題、小字）依原本順序顯示在欄位前後。
 */
export type FunnelFormDesign = {
  fields: Record<string, { placeholder?: string; helpText?: string; half?: boolean }>;
  submitStyle?: CSSProperties;
  submitClassName?: string;
  before: ReactNode;
  after: ReactNode;
  gap: number;
  mobile: boolean;
};

const FIELD_INVALID_MESSAGES: Readonly<Record<string, string>> = {
  valueMissing: "這個欄位必填。",
  typeMismatchEmail: "請輸入正確的 Email，例如 name@example.com。",
  typeMismatch: "格式不正確，請再確認一次。",
  patternMismatch: "格式不正確，請再確認一次。",
  tooLong: "內容太長了，請縮短。",
};

/** Native validation bubbles in Traditional Chinese; they float, so they never push the layout sideways (L-11). */
function invalidMessage(input: HTMLInputElement): string {
  const validity = input.validity;
  if (validity.valueMissing) return input.type === "checkbox" ? "請先勾選同意，才能送出。" : FIELD_INVALID_MESSAGES.valueMissing!;
  if (validity.typeMismatch) return input.type === "email" ? FIELD_INVALID_MESSAGES.typeMismatchEmail! : FIELD_INVALID_MESSAGES.typeMismatch!;
  if (validity.patternMismatch) return FIELD_INVALID_MESSAGES.patternMismatch!;
  if (validity.tooLong) return FIELD_INVALID_MESSAGES.tooLong!;
  return "";
}
const localizedValidation = {
  onInvalid: (event: FormEvent<HTMLInputElement>) => event.currentTarget.setCustomValidity(invalidMessage(event.currentTarget)),
  onInput: (event: FormEvent<HTMLInputElement>) => event.currentTarget.setCustomValidity(""),
};

function PublicSubmissionForm({ submission, label, requireConsent, design }: { submission: FunnelSubmissionContext; label: string; requireConsent: boolean; design?: FunnelFormDesign }) {
  const retry = useRegistrationRetry(submission.form.id);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(retry?.submitted ? "success" : retry?.message ? "error" : "idle");
  const [message, setMessage] = useState(retry?.submitted ? `${submission.form.successMessage} ${FORM_SUBMISSION_VERIFICATION_MESSAGE}` : retry?.message ?? "");
  const submissionInFlight = useRef(false);
  const [nativePending, setNativePending] = useState(false);
  const referral = referralFields(retry?.attribution);
  useEffect(() => {
    if (!submission.nativeSubmit) return;
    // Back/forward cache: allow submitting again after returning to the page.
    const reset = () => { submissionInFlight.current = false; setNativePending(false); };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, [submission.nativeSubmit]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    if (submission.nativeSubmit) {
      if (submissionInFlight.current) { event.preventDefault(); return; }
      submissionInFlight.current = true;
      // Paint the waiting state before the native navigation starts; fields are not disabled.
      flushSync(() => setNativePending(true));
      return;
    }
    event.preventDefault();
    // Lock synchronously: disabled is only applied after the next React render.
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setStatus("submitting"); setMessage("");
    try {
      const values = new FormData(event.currentTarget);
      const payload = Object.fromEntries(submission.form.fields.map((field) => [field.key, String(values.get(field.key) ?? "")]));
      const response = await postRegistrationSubmission({ formId: submission.form.id, landingPageId: submission.landingPageId, funnelStepId: submission.funnelStepId, liveId: submission.liveId ?? null, payload, ...referral });
      if (!response.ok) {
        submissionInFlight.current = false;
        setStatus("error"); setMessage(formSubmissionErrorMessage(response.status));
        return;
      }
      setStatus("success"); setMessage(`${submission.form.successMessage} ${FORM_SUBMISSION_VERIFICATION_MESSAGE}`);
      if (submission.redirectTo) window.location.assign(submission.redirectTo);
    } catch {
      submissionInFlight.current = false;
      setStatus("error"); setMessage(formSubmissionErrorMessage());
    }
  }
  return <form method="post" action="/api/form-submissions" aria-label={label} aria-busy={status === "submitting" || nativePending} onSubmit={submit} className="space-y-4">
    <input type="hidden" name="formId" value={submission.form.id} />
    <input type="hidden" name="landingPageId" value={submission.landingPageId ?? ""} />
    <input type="hidden" name="funnelStepId" value={submission.funnelStepId ?? ""} />
    <input type="hidden" name="liveId" value={submission.liveId ?? ""} />
    {/* Validated server attribution (draft or page query), as LeadForm sends it. */}
    <input type="hidden" name="referralCode" value={referral.referralCode ?? ""} />
    <input type="hidden" name="shareCode" value={referral.shareCode ?? ""} />
    <input type="hidden" name="redirectTo" value={submission.redirectTo ?? retry?.sourcePath ?? ""} />
    {retry ? <input type="hidden" name="__registrationReturnPath" value={retry.sourcePath} /> : null}
    {design
      ? <DesignedSubmissionFields submission={submission} design={design} requireConsent={requireConsent} locked={status === "submitting" || status === "success"} draft={retry?.draft?.answers} submitText={submitText(nativePending ? "submitting" : status, submission.form.submitLabel)} />
      : <PlainSubmissionFields submission={submission} requireConsent={requireConsent} locked={status === "submitting" || status === "success"} draft={retry?.draft?.answers} submitText={submitText(status, submission.form.submitLabel)} />}
    <RegistrationSubmissionFeedback pending={status === "submitting"} errorMessage={status === "error" ? message : ""} successMessage={status === "success" ? message : ""} />
  </form>;
}

const submitText = (status: "idle" | "submitting" | "success" | "error", label: string) => status === "submitting" ? "送出中…" : status === "success" ? "已送出" : label;

/** Form markup for pages without a designed form (kept exactly as before C-19). */
function PlainSubmissionFields({ submission, requireConsent, locked, draft, submitText: text }: { submission: FunnelSubmissionContext; requireConsent: boolean; locked: boolean; draft?: Record<string, string>; submitText: string }) {
  return <>
    {submission.form.fields.map((field) => <label key={field.key} className="block space-y-1"><span className="text-sm font-medium text-slate-700">{field.label}{field.required ? " *" : ""}</span><input name={field.key} defaultValue={draft?.[field.key] ?? ""} type={field.type} required={field.required} disabled={locked} autoComplete={field.key === "email" ? "email" : field.key === "name" ? "name" : undefined} className="w-full rounded-lg border border-slate-500 px-3 py-2 disabled:bg-slate-100" /></label>)}
    {requireConsent ? <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" required disabled={locked} className="mt-1" /><span>我同意依本頁說明提交並使用上述資料。</span></label> : null}
    <button type="submit" disabled={locked} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-500 px-5 py-2 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">{text}</button>
  </>;
}

const FIELD_AUTOCOMPLETE: Readonly<Record<string, string>> = { email: "email", name: "name", phone: "tel", tel: "tel", mobile: "tel", company: "organization" };

function DesignedSubmissionFields({ submission, design, requireConsent, locked, draft, submitText }: { submission: FunnelSubmissionContext; design: FunnelFormDesign; requireConsent: boolean; locked: boolean; draft?: Record<string, string>; submitText: string }) {
  return <div className="grid" style={{ gap: design.gap }}>
    {design.before}
    <div className="grid" style={{ gap: design.gap, gridTemplateColumns: design.mobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))" }}>
      {submission.form.fields.map((field) => {
        const look = design.fields[field.key] ?? {};
        const inputId = `funnel-field-${submission.form.id}-${field.key}`;
        const helpId = look.helpText ? `${inputId}-help` : undefined;
        return <div key={field.key} className="grid min-w-0 content-start" style={{ gap: 6, gridColumn: design.mobile || !look.half ? "1 / -1" : undefined }}>
          <label htmlFor={inputId} className="block text-[0.9375em] font-semibold">{field.label}{field.required ? " *" : <span aria-hidden className="font-normal opacity-80">（選填）</span>}</label>
          <input id={inputId} name={field.key} defaultValue={draft?.[field.key] ?? ""} type={field.type} required={field.required} disabled={locked} placeholder={look.placeholder} aria-describedby={helpId}
            autoComplete={FIELD_AUTOCOMPLETE[field.key] ?? (field.type === "email" ? "email" : field.type === "tel" ? "tel" : undefined)} inputMode={field.type === "tel" ? "tel" : undefined} {...localizedValidation}
            className="min-h-12 w-full rounded-lg border border-slate-500 bg-white px-3.5 py-2.5 text-[16px] text-slate-900 placeholder:text-slate-500 disabled:bg-slate-100" />
          {look.helpText ? <p id={helpId} className="m-0 text-[0.875em]" style={{ opacity: 0.85, overflowWrap: "anywhere" }}>{look.helpText}</p> : null}
        </div>;
      })}
    </div>
    {/* Platform consent wording, identical to the plain form (a template's checkbox text is not used for consent). */}
    {requireConsent ? <label className="flex items-start gap-2.5 text-[0.9375em]"><input type="checkbox" required disabled={locked} className="mt-1 h-5 w-5 shrink-0" {...localizedValidation} /><span>我同意依本頁說明提交並使用上述資料。</span></label> : null}
    <button type="submit" disabled={locked} className={`${design.submitClassName ?? ""} w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`} style={design.submitStyle}>{submitText}</button>
    {submission.notice ? <p className="m-0 text-[0.875em]" style={{ opacity: 0.85 }}>{submission.notice}</p> : null}
    {design.after}
  </div>;
}

const HIDDEN_STRIPES = "repeating-linear-gradient(135deg, rgba(71, 85, 105, 0.16) 0 6px, transparent 6px 12px)";

function selectDetail(event: MouseEvent<HTMLElement>): FunnelNodeSelectDetail {
  const target = event.target as Element | null;
  const item = typeof target?.closest === "function" ? target.closest("[data-funnel-list-item]") : null;
  const itemIndex = item && event.currentTarget.contains(item) ? Number(item.getAttribute("data-funnel-list-item")) : Number.NaN;
  return { ...(Number.isInteger(itemIndex) ? { itemIndex } : {}), point: { x: event.clientX, y: event.clientY } };
}

/** Default (theme) style of a node's wrapper; the node's own style is merged on top and always wins. */
function surfaceDefaults(node: FunnelNode, resolved: ResolvedNode, tokens: FunnelTypographyTokens, mode: FunnelRenderMode): CSSProperties {
  if (node.type === "section") return { padding: `0 ${funnelLayoutTokens(tokens.viewport).sectionGutter}px`, ...(sectionBackgroundImage(resolved.props) ? { position: "relative", isolation: "isolate", overflow: "hidden" } : {}) };
  // The navigation bar sticks to the top of the page on preview/public surfaces only (the editor canvas stays static).
  if (node.type === "nav_bar") return { backgroundColor: "#0b0b0c", color: "#f5f1e8", lineHeight: 1.5, ...(mode === "preview" && resolved.props.sticky !== false ? { position: "sticky", top: 0, zIndex: 40 } : { position: "relative", zIndex: 30 }) };
  if (node.type === "shape_divider") return { color: "#0b0b0c", lineHeight: 0 };
  if (node.type === "content_box" && contentBoxDecoration(resolved.props)) return { position: "relative" };
  if (node.type === "button") return {};
  const kind = funnelTypographyKind(node, resolved.props);
  return kind ? funnelTypographyDefaults(kind, tokens) : {};
}

function NodeSurface({ node, resolved, viewport, mode, selectedNodeId, onSelectNode, children }: { node: FunnelNode; resolved: ResolvedNode; viewport: FunnelViewport; mode: FunnelRenderMode; selectedNodeId?: string; onSelectNode?: (nodeId: string, detail?: FunnelNodeSelectDetail) => void; children: ReactNode }) {
  const tokens = useContext(TypographyContext);
  // A button's visuals belong to its control; a row's direction arranges its children, not its wrapper.
  const ownStyle = node.type === "button" ? splitButtonStyle(resolved.style).wrapper : node.type === "row" ? { ...resolved.style, direction: undefined } : resolved.style;
  const style = { ...surfaceDefaults(node, resolved, tokens, mode), ...nodeStyle(ownStyle) };
  const editor = mode === "editor";
  const attributes = safeAttributes(node.attributes);
  // EDT-RESP-001: a node hidden on this device stays selectable in the editor, dimmed and striped.
  const hidden = editor && !resolved.visible;
  const horizontal = editor && ((viewport !== "mobile" && (node.type === "columns_2" || node.type === "columns_3" || node.type === "columns_4") && !funnelColumnsLayout(node.type, resolved.props, viewport).stacked) || (node.type === "row" && resolved.style.direction === "row"));
  return <div {...attributes} data-funnel-node-id={node.id} data-funnel-node-type={node.type} data-funnel-selected={selectedNodeId === node.id ? "true" : "false"}
    data-funnel-axis={horizontal ? "horizontal" : undefined} data-funnel-hidden={hidden ? viewport : undefined}
    className={editor ? `relative${hidden ? " opacity-60" : ""}` : ""} style={style}
    onClick={onSelectNode ? (event) => { event.stopPropagation(); onSelectNode(node.id, selectDetail(event)); } : undefined}>
    {children}
    {hidden ? <>
      <span aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HIDDEN_STRIPES }} />
      <span className="pointer-events-none absolute top-1 left-1 rounded bg-slate-700 px-1.5 py-0.5 text-[11px] leading-4 font-semibold text-white">{viewport === "mobile" ? "手機版隱藏" : viewport === "tablet" ? "平板版隱藏" : "桌機版隱藏"}</span>
    </> : null}
  </div>;
}

// The switch is the explicit registry-to-markup boundary; keeping it together
// makes unsupported element behaviour auditable in one place.
// eslint-disable-next-line complexity
function NodeRenderer({ node, viewport, mode, flow, submission, consultation, publicSurface = false, selectedNodeId, onSelectNode, inlineEditing }: { node: FunnelNode; viewport: FunnelViewport; mode: FunnelRenderMode; flow?: PageDocument["flow"]; submission?: FunnelSubmissionContext; consultation?: FunnelPageDocumentRendererProps["consultation"]; publicSurface?: boolean; selectedNodeId?: string; onSelectNode?: (nodeId: string, detail?: FunnelNodeSelectDetail) => void; inlineEditing?: FunnelInlineEditingBinding }): ReactNode {
  const commerceContext = useContext(CommerceRenderContext);
  const tokens = useContext(TypographyContext);
  const eventContext = useFunnelEvent();
  const layout = funnelLayoutTokens(viewport);
  const resolved = resolveNode(node, viewport);
  if (!resolved.visible && mode !== "editor") return null;
  const editing = mode === "editor" && inlineEditing?.nodeId === node.id ? inlineEditing : undefined;
  const children = node.children ?? [];
  const renderChildren = () => children.map((child) => <NodeRenderer key={child.id} node={child} viewport={viewport} mode={mode} flow={flow} submission={submission} consultation={consultation} publicSurface={publicSurface} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} inlineEditing={inlineEditing} />);
  const surface = (content: ReactNode) => <NodeSurface node={node} resolved={resolved} viewport={viewport} mode={mode} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode}>{content}</NodeSurface>;
  const props = resolved.props;
  const eventSchedule = eventContext.schedule;
  switch (node.type) {
    case "offer_price": case "payment_button": case "payment_method": case "physical_product": case "customer_type": case "agreement": case "order_bump": case "coupon": case "two_step_order_form": case "shipping_fees":
      return surface(<><FunnelCommerceElement type={node.type} {...commerceContext} interactive={publicSurface && mode !== "editor"} />{renderChildren()}</>);
    case "section": return surface(<><SectionBackground props={props} /><section>{renderChildren()}</section></>);
    // Row: props.maxWidth centres the content column; props.gap spaces its children;
    // style.direction "row" lays children side by side (wrapping on narrow screens).
    case "row": {
      const maxWidth = layoutNumber(props.maxWidth, 240, 1600, 0);
      const horizontal = resolved.style.direction === "row";
      const rowStyle: CSSProperties = { gap: layoutNumber(props.gap, 0, 160, layout.rowGap), ...(maxWidth ? { maxWidth, marginInline: "auto" } : {}), ...(horizontal ? { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" } : {}) };
      return surface(<div className="flex w-full min-w-0 flex-col" style={rowStyle}>{renderChildren()}</div>);
    }
    case "columns_2": case "columns_3": case "columns_4": {
      const columns = funnelColumnsLayout(node.type, props, viewport);
      const gridStyle: CSSProperties = { gap: layoutNumber(props.gap, 0, 160, layout.columnGap), gridTemplateColumns: columns.template };
      if (resolved.style.align) gridStyle.alignItems = GRID_ALIGN[resolved.style.align];
      const ordered = columns.reversed ? [...children].reverse() : children;
      return surface(<div className="grid min-w-0" data-funnel-columns={columns.stacked ? "stacked" : "split"} style={gridStyle}>{ordered.map((child) => <NodeRenderer key={child.id} node={child} viewport={viewport} mode={mode} flow={flow} submission={submission} consultation={consultation} publicSurface={publicSurface} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} inlineEditing={inlineEditing} />)}</div>);
    }
    case "text": {
      const text = stringProp(props, ["text", "content", "body"], "文字內容");
      return surface(editing ? <InlineEditableText as="p" initial={text} multiline label="編輯文字" caret={editing.caret} onCommit={(value) => editing.onCommit(value, { previous: text })} onCancel={editing.onCancel} /> : <p className="whitespace-pre-line">{resolveFunnelEventFields(text, eventSchedule)}</p>);
    }
    case "headline": {
      const level = funnelHeadingLevel(props.level);
      const text = stringProp(props, ["text", "content", "title"], "標題");
      return surface(editing ? <InlineEditableText as={level} initial={text} multiline={false} label="編輯標題" caret={editing.caret} onCommit={(value) => editing.onCommit(value, { previous: text })} onCancel={editing.onCancel} /> : <HeadlineMarkup level={level} text={resolveFunnelEventFields(text, eventSchedule)} />);
    }
    case "bulleted_list": {
      const items = stringList(props.items).length ? stringList(props.items) : ["清單項目"];
      return surface(<ul className="list-disc pl-[1.25em]" style={{ display: "grid", gap: "0.5em" }}>{items.map((item, index) => editing?.itemIndex === index
        ? <InlineEditableText key={`${node.id}-item-${index}-editing`} as="li" initial={item} multiline={false} label={`編輯清單第 ${index + 1} 項`} caret={editing.caret} onCommit={(value) => editing.onCommit(value, { previous: item, items })} onCancel={editing.onCancel} />
        : <li key={`${node.id}-item-${index}`} data-funnel-list-item={mode === "editor" ? index : undefined}>{resolveFunnelEventFields(item, eventSchedule)}</li>)}</ul>);
    }
    case "content_box": {
      // A box styled by its own node style (templates, blocks) draws nothing extra; an unstyled box keeps the default card.
      const style = resolved.style;
      const custom = style.padding !== undefined || style.backgroundColor !== undefined || style.borderWidth !== undefined || style.borderColor !== undefined || (style.shadow !== undefined && style.shadow !== "none");
      const decoration = contentBoxDecoration(props);
      return surface(<>{decoration ? <ContentBoxDecoration kind={decoration} props={props} /> : null}<div className={`flex min-w-0 flex-col${custom ? "" : " rounded-xl border border-slate-200 bg-white/70 p-4"}${decoration ? " relative" : ""}`} style={{ gap: layoutNumber(props.gap, 0, 120, layout.boxGap) }}>{children.length ? renderChildren() : <p className="whitespace-pre-line">{stringProp(props, ["text", "content", "description", "title"], "內容區塊")}</p>}</div></>);
    }
    case "image": {
      const src = safeContentAssetUrl(props.src ?? props.imageUrl ?? props.url);
      return surface(src ? <figure><img src={src} alt={stringProp(props, ["alt", "altText"])} style={imageStyle(resolved.style)} />{stringProp(props, ["caption"]) ? <figcaption className="mt-2 text-sm text-slate-600">{stringProp(props, ["caption"])}</figcaption> : null}</figure> : <UnsupportedNode node={node} message="圖片網址不安全或尚未設定。" />);
    }
    case "video": {
      const src = safeMediaSource(props);
      const poster = safeContentAssetUrl(props.poster);
      return surface(src ? <video autoPlay={props.autoplay === true} controls={props.controls !== false} poster={poster ?? undefined} preload="metadata" className="max-w-full" src={src}>{stringProp(props, ["fallback", "alt"], "您的瀏覽器不支援影片播放。")} </video> : <UnsupportedNode node={node} message="影片網址不安全或尚未設定。" />);
    }
    case "audio": {
      const src = safeMediaSource(props);
      return surface(src ? <audio controls={props.controls !== false} preload="metadata" className="w-full" src={src}>{stringProp(props, ["fallback", "alt"], "您的瀏覽器不支援音訊播放。")} </audio> : <UnsupportedNode node={node} message="音訊網址不安全或尚未設定。" />);
    }
    case "carousel": {
      const label = stringProp(props, ["ariaLabel", "title"], "圖片輪播");
      return surface(mode === "preview" ? <FunnelDocumentCarousel id={node.id} label={label}>{children.map((child) => <NodeRenderer key={child.id} node={child} viewport={viewport} mode={mode} flow={flow} submission={submission} consultation={consultation} publicSurface={publicSurface} />)}</FunnelDocumentCarousel> : <div aria-label={label} className="space-y-3" data-funnel-carousel="true" role="region">{children.length ? renderChildren() : <p className="text-sm text-slate-500">輪播目前沒有內容。</p>}</div>);
    }
    case "form": {
      const label = stringProp(props, ["ariaLabel", "title"], "表單");
      // Checkout layout forms are not lead forms: keep their editable children
      // visible, but collect buyer information only in the trusted checkout.
      const stack = { display: "flex", flexDirection: "column", gap: layout.formGap } satisfies CSSProperties;
      if (props.variant === "checkout-contact") return surface(<fieldset disabled style={stack}>{renderChildren()}</fieldset>);
      if (children.some((child) => getFunnelNodeDefinition(child.type).category === "payment")) return surface(<div aria-label={label} style={stack}>{renderChildren()}</div>);
      const requireConsent = children.some((child) => child.type === "checkbox" && child.props.required === true);
      if (mode === "preview" && submission) return surface(<PublicSubmissionForm submission={submission} label={label} requireConsent={requireConsent} design={children.length ? formDesign(children, viewport, tokens, (child) => <NodeRenderer key={child.id} node={child} viewport={viewport} mode={mode} flow={flow} submission={submission} consultation={consultation} publicSurface={publicSurface} />, layout.formGap) : undefined} />);
      if (publicSurface) return surface(<UnsupportedNode node={node} message="此一頁式網站尚未綁定可公開使用的報名表，表單已停用。" />);
      return surface(<form aria-label={label} onSubmit={(event) => event.preventDefault()} style={stack}>{stringProp(props, ["title", "heading"]) ? <h3 style={funnelTypographyDefaults("h3", tokens)}>{stringProp(props, ["title", "heading"])}</h3> : null}{renderChildren()}</form>);
    }
    case "form_input": {
      const label = stringProp(props, ["label", "title", "placeholder"], "欄位");
      const inputId = `${node.id}-input`;
      const helpText = stringProp(props, ["helpText"]);
      return surface(<label className="block space-y-1.5" htmlFor={inputId} style={props.width === "half" && viewport !== "mobile" ? { maxWidth: "calc(50% - 8px)" } : undefined}><span className="block text-[0.875em] font-semibold">{label}{props.required === true ? <span aria-hidden> *</span> : null}</span><input id={inputId} name={safeNodeName(node, props, node.id)} type={safeInputType(props.inputType ?? props.type)} placeholder={stringProp(props, ["placeholder"])} required={props.required === true} defaultValue={typeof props.defaultValue === "string" ? props.defaultValue : undefined} aria-describedby={helpText ? `${inputId}-help` : undefined} className="min-h-12 w-full rounded-lg border border-slate-500 bg-white px-3.5 py-2.5 text-[16px] text-slate-900 placeholder:text-slate-500" />{helpText ? <span id={`${inputId}-help`} className="block text-[0.875em]" style={{ opacity: 0.85 }}>{helpText}</span> : null}</label>);
    }
    case "checkbox": {
      const label = stringProp(props, ["label", "text", "title"], "我同意上述內容");
      return surface(<label className="flex items-start gap-2"><input type="checkbox" name={safeNodeName(node, props, node.id)} required={props.required === true} defaultChecked={props.checked === true} className="mt-1" /><span>{label}</span></label>);
    }
    case "calendar": {
      const eventId = stringProp(props, ["eventId", "calendarId", "bookingEventId"]);
      const event = consultation?.events.find((candidate) => candidate.id === eventId);
      const executable = Boolean(event);
      if (!executable || !consultation) return surface(<UnsupportedNode node={node} message="尚未綁定行事曆事件，或事件不屬於此一頁式網站的公開專案；預約功能已停用。" />);
      return surface(<ConsultationBookingBlock eventId={eventId} csrfToken={consultation.csrfToken} settings={{ title: event!.title, description: event!.description ?? undefined, timezone: event!.timezone, durationMinutes: event!.durationMinutes, submitLabel: stringProp(props, ["submitLabel"], "送出預約"), successMessage: stringProp(props, ["successMessage"], "預約已送出。"), intakeFields: Array.isArray(event!.intakeFormFields) ? event!.intakeFormFields as never[] : [] }} />);
    }
    case "x_share_button": {
      const shareTarget = safeResourceUrl(props.url ?? props.targetUrl ?? props.href);
      const href = shareTarget ? `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareTarget)}` : null;
      return surface(href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 font-semibold">分享到 X</a> : <UnsupportedNode node={node} message="尚未設定安全的分享網址。" />);
    }
    case "survey": {
      const question = stringProp(props, ["question", "title", "label"], "請選擇一個答案");
      const options = stringList(props.options ?? props.choices);
      const surveyOptions = options.length ? options : ["選項一", "選項二"];
      return surface(publicSurface && mode === "preview" ? <FunnelSurvey nodeId={node.id} question={question} options={surveyOptions} multiple={props.multiple === true} required={props.required === true} fieldKey={safeNodeName(node, props, node.id)} submission={submission} /> : <fieldset className="space-y-2"><legend className="font-medium">{question}</legend>{surveyOptions.map((option, index) => <label key={`${node.id}-option-${index}`} className="flex items-center gap-2"><input type={props.multiple === true ? "checkbox" : "radio"} name={safeNodeName(node, props, node.id)} value={option} /><span>{option}</span></label>)}</fieldset>);
    }
    case "raw_html": {
      // Code fields come from the base props only: custom code has no desktop/mobile overrides.
      const code = funnelCustomCodeOf(node.props);
      if (!code.html.trim() && !code.css.trim() && !code.js.trim()) return surface(<UnsupportedNode node={node} message="尚未輸入自訂程式碼。" />);
      const scripted = hasFunnelCustomScript(code);
      // The editor canvas never runs merchant JS; preview and public pages run it in the opaque-origin sandbox.
      const codeMode = scripted && mode !== "editor" ? "script" : "static";
      const height = typeof node.props.height === "number" ? node.props.height : undefined;
      return surface(<div data-funnel-custom-code-node>
        <p className="sr-only">自訂程式碼在隔離的沙箱中顯示</p>
        {scripted && codeMode === "static" ? <p className="mb-1 text-xs text-slate-500">JS 只在預覽與公開頁面的隔離沙箱中執行。</p> : null}
        <SandboxedCustomCode code={code} mode={codeMode} height={height} label={stringProp(props, ["title", "ariaLabel"], "自訂程式碼")} />
      </div>);
    }
    case "recaptcha": return surface(<UnsupportedNode node={node} message="CelebrateDeal 尚未具備已驗證的 server verification 與網域設定，因此 reCAPTCHA 不可用。" />);
    case "countdown": {
      // C-06. Documents saved before C-06 have no `variant`/`source`: they keep a fixed deadline and get the block look.
      const fixed = (props.source ?? "fixed") === "fixed";
      const target = safeDateTime(props.targetDate ?? props.endAt ?? props.deadline);
      if (fixed && !target) return surface(<UnsupportedNode node={node} message="尚未設定有效的截止時間。" />);
      return surface(<div data-countdown-target={fixed ? target ?? undefined : undefined}><CountdownElement {...webinarElementProps(props, resolved, tokens, viewport, mode)} /></div>);
    }
    case "menu": {
      const items = safeMenuItems(props.items ?? props.links);
      // Links use the page link colour unless the menu node sets its own text colour.
      const linkStyle: CSSProperties = { color: resolved.style.color ? "inherit" : tokens.linkColor, fontWeight: 600 };
      const justify = resolved.style.textAlign === "center" ? "center" : resolved.style.textAlign === "right" ? "flex-end" : undefined;
      return surface(<nav aria-label={stringProp(props, ["ariaLabel", "title"], "頁面選單")}><ul className="flex flex-wrap gap-x-6 gap-y-2" style={justify ? { justifyContent: justify } : undefined}>{(items.length ? items : [{ label: "尚未設定選單項目", href: null }]).map((item, index) => <li key={`${node.id}-menu-${index}`}>{item.href ? <a href={item.href} style={linkStyle} className="underline-offset-4 hover:underline">{item.label}</a> : <span className="opacity-80">{item.label}</span>}</li>)}</ul></nav>);
    }
    case "faq": {
      const question = stringProp(props, ["question", "title", "label"], "常見問題");
      const items = Array.isArray(props.items) ? props.items.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const itemQuestion = stringProp(record, ["question", "title", "label"], "");
        const answer = stringProp(record, ["answer", "content", "body"], "尚未設定答案。");
        return itemQuestion ? [{ question: itemQuestion, answer }] : [];
      }) : [];
      return surface(items.length ? <div className="space-y-2">{items.map((item, index) => <details key={`${node.id}-faq-${index}`} className="rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer font-medium">{item.question}</summary><p className="mt-3 text-sm text-slate-600 whitespace-pre-line">{item.answer}</p></details>)}</div> : <details className="rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer font-medium">{question}</summary><div className="mt-3">{children.length ? renderChildren() : <p className="text-sm text-slate-600">尚未設定答案。</p>}</div></details>);
    }
    case "button": {
      const source: unknown = node.actions[0] ?? props.action;
      const action = safeAction(source);
      const rawLabel = stringProp(props, ["label", "text", "title"], "立即行動");
      const label = editing ? rawLabel : resolveFunnelEventFields(rawLabel, eventSchedule);
      // A span, not the <button>/<a>: native buttons swallow Space/Enter and some browsers block editing inside them.
      const controlStyle = buttonControlStyle(resolved.style, tokens);
      if (editing) return surface(<InlineEditableText as="span" style={controlStyle} initial={label} multiline={false} label="編輯按鈕文字" caret={editing.caret} onCommit={(value) => editing.onCommit(value, { previous: label })} onCancel={editing.onCancel} />);
      const sourceType = actionType(source);
      const popupId = sourceType === "show_popup" && source && typeof source === "object" && "popupId" in source && typeof source.popupId === "string" ? source.popupId : null;
      const nextStepId = sourceType === "next_step" && source && typeof source === "object" && "stepId" in source && typeof source.stepId === "string" ? source.stepId : null;
      const nextStep = nextStepId ? flow?.steps.find((step) => step.id === nextStepId) : undefined;
      const nextStepHref = flow && nextStep ? `/lp/${flow.domain}/${nextStep.path}` : null;
      const submit = sourceType === "submit_form";
      const supportedButton = sourceType === null || sourceType === "none" || submit || Boolean(popupId);
      const controlClass = "transition-[filter] hover:brightness-95 focus-visible:outline-offset-2";
      if (sourceType === "registration") return surface(<RegistrationButton action={source as Extract<FunnelNodeAction, { type: "registration" }>} label={label} className={controlClass} style={controlStyle} />);
      return surface(action ? <a href={action.href} target={action.newTab ? "_blank" : undefined} rel={action.newTab ? "noreferrer" : undefined} download={action.download} className={controlClass} style={controlStyle}>{label}</a> : nextStepHref ? <a href={nextStepHref} className={controlClass} style={controlStyle}>{label}</a> : <button type={submit ? "submit" : "button"} disabled={!supportedButton} aria-disabled={!supportedButton || undefined} onClick={popupId ? () => window.dispatchEvent(new CustomEvent("celebratedeal:show-popup", { detail: { popupId } })) : undefined} className={`${controlClass} disabled:cursor-not-allowed disabled:opacity-60`} style={controlStyle}>{label}</button>);
    }
    case "horizontal_line": return surface(<hr className="border-slate-200" />);
    case "nav_bar": case "logo_strip": case "stats": case "icon_list": case "shape_divider": case "section_title": case "image_cards": case "testimonial_wall": case "content_cards": case "video_gallery": {
      const showcase: ShowcaseElementProps = { props, tokens, viewport, interactive: mode === "preview", inheritColor: resolved.style.color !== undefined, align: resolved.style.textAlign ?? tokens.alignment };
      const Element = SHOWCASE_ELEMENTS[node.type];
      return surface(<Element {...showcase} />);
    }
    case "event_facts": case "speaker_profiles": case "agenda_timeline": case "callout": case "fit_compare": case "add_to_calendar": case "announcement_bar":
    case "value_stack": case "session_schedule": case "deadline_notice": case "media_frame": case "image_gallery": case "code_snippet": {
      const Element = WEBINAR_ELEMENTS[node.type];
      return surface(<Element {...webinarElementProps(props, resolved, tokens, viewport, mode)} />);
    }
    case "webinar_state": {
      // C-15: each child content box declares `webinarState`; boxes without one always show.
      if (mode === "editor") return surface(<div className="grid gap-3">{children.map((child) => {
        const key = webinarStateKey(child.props.webinarState);
        return <div key={child.id} className="grid gap-1"><span className="w-fit rounded bg-slate-700 px-2 py-0.5 text-xs font-semibold text-white">{key ? WEBINAR_STATE_LABELS[key] : "所有狀態"}</span><NodeRenderer node={child} viewport={viewport} mode={mode} flow={flow} submission={submission} consultation={consultation} publicSurface={publicSurface} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} inlineEditing={inlineEditing} /></div>;
      })}</div>);
      return surface(<WebinarStateSwitch>{(state) => children.filter((child) => { const key = webinarStateKey(child.props.webinarState); return !key || key === state; }).map((child) => <NodeRenderer key={child.id} node={child} viewport={viewport} mode={mode} flow={flow} submission={submission} consultation={consultation} publicSurface={publicSurface} />)}</WebinarStateSwitch>);
    }
    default: return surface(<UnsupportedNode node={node} message={capabilityMessage(node)} />);
  }
}

/** Reads the page's form design (see `FunnelFormDesign`); field inputs and the submit button come from the server form. */
function formDesign(children: FunnelNode[], viewport: FunnelViewport, tokens: FunnelTypographyTokens, render: (child: FunnelNode) => ReactNode, gap: number): FunnelFormDesign {
  const fields: FunnelFormDesign["fields"] = {};
  const before: ReactNode[] = [];
  const after: ReactNode[] = [];
  let reachedFields = false;
  let submitStyle: CSSProperties | undefined;
  for (const child of children) {
    const resolved = resolveNode(child, viewport);
    if (!resolved.visible) continue;
    if (child.type === "form_input") {
      reachedFields = true;
      const props = resolved.props;
      const type = safeInputType(props.inputType ?? props.type);
      const key = safeNodeName(child, props, child.id);
      const look = { placeholder: stringProp(props, ["placeholder"]) || undefined, helpText: stringProp(props, ["helpText"]) || undefined, half: props.width === "half" };
      fields[key] ??= look;
      if (type === "email") fields.email ??= look;
      if (type === "tel") { fields.phone ??= look; fields.tel ??= look; fields.mobile ??= look; }
      continue;
    }
    if (child.type === "button" && !submitStyle) {
      reachedFields = true;
      submitStyle = buttonControlStyle(resolved.style, tokens);
      continue;
    }
    if (child.type === "checkbox" && resolved.props.required === true) continue;
    (reachedFields ? after : before).push(render(child));
  }
  return { fields, submitStyle: submitStyle ?? buttonControlStyle({}, tokens), submitClassName: "transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2", before, after, gap, mobile: viewport === "mobile" };
}

function webinarElementProps(props: Record<string, unknown>, resolved: ResolvedNode, tokens: FunnelTypographyTokens, viewport: FunnelViewport, mode: FunnelRenderMode): WebinarElementProps {
  return { props, tokens, viewport, interactive: mode === "preview", inheritColor: resolved.style.color !== undefined, align: resolved.style.textAlign ?? tokens.alignment };
}

/** Current event state (C-15); unscheduled events count as "upcoming". Re-evaluated every 30 seconds. */
function WebinarStateSwitch({ children }: { children: (state: WebinarStateKey) => ReactNode }) {
  const { schedule } = useFunnelEvent();
  const now = useFunnelNow(30_000);
  const phase = now === null ? "upcoming" : funnelEventPhase(schedule, now);
  const state: WebinarStateKey = phase === "unscheduled" ? "upcoming" : phase;
  return <div data-webinar-state={state} aria-label={FUNNEL_EVENT_PHASE_LABELS[phase]}>{children(state)}</div>;
}

const SHOWCASE_ELEMENTS = {
  nav_bar: NavBarElement, logo_strip: LogoStripElement, stats: StatsElement, icon_list: IconListElement, shape_divider: ShapeDividerElement,
  section_title: SectionTitleElement, image_cards: ImageCardsElement, testimonial_wall: TestimonialWallElement, content_cards: ContentCardsElement, video_gallery: VideoGalleryElement,
} as const;

function sectionBackgroundImage(props: Record<string, unknown>): string | undefined {
  return funnelBackgroundImageValue(props.backgroundImage);
}

const OVERLAY_DIRECTIONS = { left: "to left", right: "to right", bottom: "to bottom", top: "to top" } as const;

/** `rgba()` for an overlay colour at the given 0–100 opacity; null for colours that cannot be parsed. */
function overlayRgba(value: unknown, opacity: number): string | null {
  const rgb = parseFunnelColor(showcaseColor(value) ?? "#000000");
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(opacity) / 100})` : null;
}

/**
 * Section background photo with an optional colour overlay. `overlayFade`
 * fades the overlay out towards one side (dark text side → photo side). Only
 * URLs accepted by `funnelBackgroundImageValue` reach the CSS.
 */
function SectionBackground({ props }: { props: Record<string, unknown> }) {
  const image = sectionBackgroundImage(props);
  if (!image) return null;
  const opacity = showcaseNumber(props.overlayOpacity, 0, 100, 0);
  const solid = overlayRgba(props.overlayColor, opacity);
  const fade = showcaseChoice(props.overlayFade, ["none", "left", "right", "bottom", "top"] as const, "none");
  const overlay = !solid || opacity === 0 ? undefined : fade === "none" ? solid : `linear-gradient(${OVERLAY_DIRECTIONS[fade]}, ${solid} 0%, ${solid} 35%, ${overlayRgba(props.overlayColor, opacity * 0.25)} 100%)`;
  const position = showcaseChoice(props.backgroundPosition, ["center", "left", "right", "top", "bottom"] as const, "center");
  return <div aria-hidden data-funnel-section-background className="pointer-events-none absolute inset-0 -z-10">
    <div className="absolute inset-0 bg-cover" style={{ backgroundImage: image, backgroundPosition: position }} />
    {overlay ? <div className="absolute inset-0" style={{ background: overlay }} /> : null}
  </div>;
}

function contentBoxDecoration(props: Record<string, unknown>): "frame" | "corners" | null {
  return props.decoration === "frame" || props.decoration === "corners" ? props.decoration : null;
}

/** Gold inset frame or corner brackets drawn over a content box's padding (CTA boxes). */
function ContentBoxDecoration({ kind, props }: { kind: "frame" | "corners"; props: Record<string, unknown> }) {
  const accent = showcaseColor(props.decorationColor) ?? FUNNEL_SHOWCASE_ACCENT;
  if (kind === "frame") return <span aria-hidden className="pointer-events-none absolute" style={{ inset: 10, border: `1px solid ${accent}`, opacity: 0.7, borderRadius: "inherit" }} />;
  const corner = (position: CSSProperties, borders: CSSProperties) => <span aria-hidden className="pointer-events-none absolute" style={{ width: 28, height: 28, ...position, ...borders }} />;
  const line = `2px solid ${accent}`;
  return <>
    {corner({ top: 10, left: 10 }, { borderTop: line, borderLeft: line })}
    {corner({ top: 10, right: 10 }, { borderTop: line, borderRight: line })}
    {corner({ bottom: 10, left: 10 }, { borderBottom: line, borderLeft: line })}
    {corner({ bottom: 10, right: 10 }, { borderBottom: line, borderRight: line })}
  </>;
}

/**
 * A `registration` action stores only the form id; the slug and bound live come
 * from the server-provided render context. Like legacy landing pages, the link
 * carries the visitor's UTM / referral parameters and the page id (`lp`).
 */
function RegistrationButton({ action, label, className, style }: { action: Extract<FunnelNodeAction, { type: "registration" }>; label: string; className: string; style: CSSProperties }) {
  const links = useFunnelRegistrationLinks();
  const href = funnelRegistrationHref(action, links);
  if (!href) return <button type="button" disabled aria-disabled title="這個報名表已停用或不屬於此專案" className={`${className} disabled:cursor-not-allowed disabled:opacity-60`} style={style}>{label}</button>;
  return <LandingPageLink href={href} pageId={links.pageId} className={className} style={style}>{label}</LandingPageLink>;
}

function UnsupportedNode({ node, message, children }: { node: FunnelNode; message: string; children?: ReactNode }) {
  return <div data-funnel-capability={node.type} className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600"><p className="font-semibold text-slate-800">{LABELS[node.type]}：目前無法在此預覽</p><p className="mt-1">{message}</p>{children ? <div className="mt-3">{children}</div> : null}</div>;
}

/**
 * Only same-origin paths and plain HTTPS URLs without characters that could
 * leave a CSS `url("…")` string are accepted for the page background.
 */
export function funnelBackgroundImageValue(value: unknown): string | undefined {
  const href = safeResourceUrl(value);
  if (!href || href.startsWith("#") || /["'()\\\s<>]/u.test(href)) return undefined;
  return `url("${href}")`;
}

function pageStyle(document: PageDocument, tokens: FunnelTypographyTokens): CSSProperties {
  // qa-standards 3.2: no closing punctuation at the start of a line in Traditional Chinese.
  return { ...funnelPageTypographyStyle(tokens), backgroundColor: color(document.settings.background.color), lineBreak: "strict" };
}

/** Shared renderer for the editor canvas and the safe public/preview surface. */
export function FunnelPageDocumentRenderer({ document, viewport = "desktop", mode = "preview", submission, consultation, commerce, publicSurface = false, selectedNodeId, onSelectNode, inlineEditing, className = "", landmark = true, event }: FunnelPageDocumentRendererProps) {
  const parsed = parsePageDocument(document);
  const rootRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [initialNow] = useState(() => event?.renderedAt ?? null);
  useFunnelScrollReveal(rootRef, mode === "preview" && parsed?.settings.scrollReveal && parsed.settings.scrollReveal !== "none" ? parsed.settings.scrollReveal : null);
  if (!parsed) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">頁面內容不符合安全格式，暫時無法顯示。</div>;
  const editing = mode === "editor" ? inlineEditing : undefined;
  const tokens = resolveFunnelTypography(parsed.settings, viewport);
  const backgroundImage = funnelBackgroundImageValue(parsed.settings.background.imageUrl);
  const blur = Math.min(Math.max(parsed.settings.background.blur, 0), 40);
  const Root = landmark ? "main" : "div";
  const scopedCss = funnelScopedCustomCss(parsed.settings.customCss);
  const sticky = parsed.settings.stickyCta && funnelStickyCtaVisibleOn(parsed.settings.stickyCta, viewport) ? parsed.settings.stickyCta : null;
  // The bar is a fixed overlay, so it only appears on public pages and the harness that renders them, never on the editor canvas or its preview pane.
  const liveSticky = sticky && publicSurface && mode === "preview" ? sticky : null;
  const schedule = funnelEventSchedule({ webinar: parsed.flow?.webinar, registrationClosesAt: event?.registrationClosesAt, title: parsed.settings.eventTitle });
  const root = <Root ref={rootRef as never} data-funnel-renderer data-funnel-content data-viewport={viewport} data-render-mode={mode} className={`min-h-full w-full${backgroundImage ? " relative isolate" : ""} ${FUNNEL_FONT_VARIABLES} ${className}`.trim()} style={pageStyle(parsed, tokens)}>
      {backgroundImage ? <div aria-hidden data-funnel-background className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"><div className="absolute bg-cover bg-center" style={{ backgroundImage, inset: blur ? `-${blur * 2}px` : 0, filter: blur ? `blur(${blur}px)` : undefined }} /></div> : null}
      {parsed.root.map((node) => <NodeRenderer key={node.id} node={node} viewport={viewport} mode={mode} flow={parsed.flow} submission={submission} consultation={consultation} publicSurface={publicSurface} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} inlineEditing={editing} />)}
      {sticky && mode === "editor" ? <p data-funnel-sticky-preview className="m-0 border-t border-dashed border-slate-400 bg-slate-50 px-4 py-3 text-center text-sm text-slate-700">行動版固定報名列：「{sticky.label}」會在訪客捲過首屏後固定在畫面底部。</p> : null}
      <div ref={endRef} aria-hidden data-funnel-content-end />
    </Root>;
  return <CommerceRenderContext.Provider value={{ binding: parsed.commerce, commerce }}><TypographyContext.Provider value={tokens}><FunnelEventContext.Provider value={{ schedule, initialNow }}>
    {scopedCss ? <div data-funnel-content-shell style={FUNNEL_CONTENT_SHELL_STYLE}><style data-funnel-custom-css dangerouslySetInnerHTML={{ __html: scopedCss }} />{root}</div> : root}
    {liveSticky ? <><FunnelStickyCtaSpacer /><FunnelStickyCtaBar settings={liveSticky} contentRef={rootRef} endRef={endRef} linkColor={tokens.linkColor} /></> : null}
  </FunnelEventContext.Provider></TypographyContext.Provider></CommerceRenderContext.Provider>;
}

/**
 * 頁面自訂 CSS 的外框。商家選擇器一律以 `[data-funnel-content]` 開頭，選不到這個
 * 外框；外框的 paint／layout containment 讓 position:fixed 只能相對外框定位且被
 * 裁切在外框內，isolation 讓 z-index 無法蓋過外框之外的平台揭露與政策連結。
 *
 * 容器「內」由平台產生的介面（報名表單、商品元件、能力提示文字）刻意讓商家
 * 自訂 CSS 調整外觀，因此可能被隱藏；必須讓訪客看到的平台說明（腳本揭露、
 * 政策連結）一律放在容器外。真正的結帳同意在獨立的結帳頁，不在這個容器內。
 */
export const FUNNEL_CONTENT_SHELL_STYLE: CSSProperties = { contain: "layout paint", isolation: "isolate", position: "relative", zIndex: 0 };

/** 渲染時重新編譯；不合格（或空白）的 CSS 一律不輸出。 */
export function funnelScopedCustomCss(source: string | undefined): string {
  if (!source?.trim()) return "";
  const compiled = compileFunnelCustomCss(source);
  return compiled.ok ? compiled.css : "";
}

export const FunnelPageRenderer = FunnelPageDocumentRenderer;

export type { FunnelNodeAction };

