"use client";

/* eslint-disable @next/next/no-img-element */

import { createContext, useContext, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { RegistrationFormFieldSpec } from "@/lib/registration-form-fields";
import type { FunnelCommerceBinding, FunnelCommerceView } from "@/lib/funnel-commerce";
import { FunnelCommerceElement } from "./funnel-commerce-element";
import { ConsultationBookingBlock } from "@/components/funnel-blocks/consultation-booking-block";
import { FunnelDocumentCarousel } from "./funnel-document-carousel";
import { FunnelSurvey } from "./funnel-survey";
import { SandboxedHtml } from "./sandboxed-html";

const CommerceRenderContext = createContext<{ binding?: FunnelCommerceBinding; commerce?: FunnelCommerceView }>({});

import {
  getFunnelNodeDefinition,
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type FunnelNodeStyle,
  type PageDocument,
} from "@/lib/funnel-page-document";

export type FunnelViewport = "desktop" | "mobile";
export type FunnelRenderMode = "editor" | "preview";

export type FunnelPageDocumentRendererProps = {
  document: PageDocument;
  viewport?: FunnelViewport;
  mode?: FunnelRenderMode;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  onMoveNode?: (sourceNodeId: string, targetNodeId: string) => void;
  className?: string;
  submission?: FunnelSubmissionContext;
  publicSurface?: boolean;
  commerce?: FunnelCommerceView;
  consultation?: { csrfToken: string; events: Array<{ id: string; title: string; description: string | null; timezone: string; durationMinutes: number; intakeFormFields: unknown }> };
};

export type FunnelSubmissionContext = {
  form: { id: string; fields: RegistrationFormFieldSpec[]; submitLabel: string; successMessage: string };
  landingPageId: string;
  /** A public route supplies this server-resolved step for trusted attribution. */
  funnelStepId?: string;
  liveId?: string;
  redirectTo?: string;
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
  raw_html: "原始 HTML",
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

function safeResourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const href = value.trim();
  if (/^[\u0000-\u0020]/u.test(href) || /[\u0000-\u001f\u007f]/u.test(href)) return null;
  if ((href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? href : null;
  } catch {
    return null;
  }
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

function nodeStyle(style: FunnelNodeStyle, viewport: FunnelViewport): CSSProperties {
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
  const imageWidth = percentageOrToken(style.imageWidth);
  const imageHeight = pxOrToken(style.imageHeight);
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
  if (viewport === "mobile" && imageWidth !== undefined) result.maxWidth = imageWidth;
  if (imageHeight !== undefined) result.objectFit = "cover";
  return result;
}

function resolveNode(node: FunnelNode, viewport: FunnelViewport): ResolvedNode {
  const override = node.overrides[viewport];
  return {
    props: { ...node.props, ...(override?.props ?? {}) },
    style: { ...node.style, ...(override?.style ?? {}) },
    visible: override?.visible ?? node.visible,
  };
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
  return safeResourceUrl(props.src ?? props.url ?? props.mediaUrl ?? props.videoUrl ?? props.audioUrl);
}

function CountdownDisplay({ target }: { target: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, new Date(target).getTime() - Date.now()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [target]);
  const value = remaining ?? 0;
  const days = remaining === null ? "--" : String(Math.floor(value / 86_400_000));
  const hours = remaining === null ? "--" : String(Math.floor((value % 86_400_000) / 3_600_000));
  const minutes = remaining === null ? "--" : String(Math.floor((value % 3_600_000) / 60_000));
  const seconds = remaining === null ? "--" : String(Math.floor((value % 60_000) / 1_000));
  return <div className="grid grid-cols-4 gap-2" aria-label="倒數時間"><span><strong className="block text-xl">{days}</strong><small>天</small></span><span><strong className="block text-xl">{hours}</strong><small>小時</small></span><span><strong className="block text-xl">{minutes}</strong><small>分鐘</small></span><span><strong className="block text-xl">{seconds}</strong><small>秒</small></span></div>;
}

function capabilityMessage(node: FunnelNode): string {
  const definition = getFunnelNodeDefinition(node.type);
  if (definition.capability.status !== "available") return `功能狀態：${definition.capability.status === "disabled" ? "已停用" : definition.capability.status === "limited" ? "有限支援" : "待驗證"}。${definition.capability.reason}`;
  return "此元件目前尚未接上安全渲染器，內容仍可在編輯器中保留。";
}

function HeadlineMarkup({ level, text }: { level: string; text: string }) {
  const className = "font-bold tracking-tight";
  switch (level) {
    case "h1": return <h1 className={className}>{text}</h1>;
    case "h3": return <h3 className={className}>{text}</h3>;
    case "h4": return <h4 className={className}>{text}</h4>;
    case "h5": return <h5 className={className}>{text}</h5>;
    case "h6": return <h6 className={className}>{text}</h6>;
    default: return <h2 className={className}>{text}</h2>;
  }
}

function PublicSubmissionForm({ submission, label, requireConsent }: { submission: FunnelSubmissionContext; label: string; requireConsent: boolean }) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting" || status === "success") return;
    setStatus("submitting"); setMessage("");
    const values = new FormData(event.currentTarget);
    const payload = Object.fromEntries(submission.form.fields.map((field) => [field.key, String(values.get(field.key) ?? "")]));
    try {
      const response = await fetch("/api/form-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CelebrateDeal-Client": "web" },
        body: JSON.stringify({ formId: submission.form.id, landingPageId: submission.landingPageId, funnelStepId: submission.funnelStepId, liveId: submission.liveId ?? null, payload }),
      });
      if (!response.ok) {
        setStatus("error"); setMessage(response.status === 429 ? "送出次數過多，請稍後再試。" : "資料未能送出，請檢查欄位後再試。");
        return;
      }
      setStatus("success"); setMessage(submission.form.successMessage);
      if (submission.redirectTo) window.location.assign(submission.redirectTo);
    } catch {
      setStatus("error"); setMessage("連線中斷，資料尚未送出，請稍後再試。");
    }
  }
  return <form aria-label={label} onSubmit={submit} className="space-y-4">
    {submission.form.fields.map((field) => <label key={field.key} className="block space-y-1"><span className="text-sm font-medium text-slate-700">{field.label}{field.required ? " *" : ""}</span><input name={field.key} type={field.type} required={field.required} disabled={status === "submitting" || status === "success"} autoComplete={field.key === "email" ? "email" : field.key === "name" ? "name" : undefined} className="w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100" /></label>)}
    {requireConsent ? <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" required disabled={status === "submitting" || status === "success"} className="mt-1" /><span>我同意依本頁說明提交並使用上述資料。</span></label> : null}
    <button type="submit" disabled={status === "submitting" || status === "success"} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-500 px-5 py-2 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">{status === "submitting" ? "送出中…" : status === "success" ? "已送出" : submission.form.submitLabel}</button>
    {message ? <p role={status === "error" ? "alert" : "status"} className={status === "error" ? "text-sm text-red-700" : "text-sm text-emerald-700"}>{message}</p> : null}
  </form>;
}

function NodeSurface({ node, resolved, viewport, mode, selectedNodeId, onSelectNode, onMoveNode, children }: { node: FunnelNode; resolved: ResolvedNode; viewport: FunnelViewport; mode: FunnelRenderMode; selectedNodeId?: string; onSelectNode?: (nodeId: string) => void; onMoveNode?: (sourceNodeId: string, targetNodeId: string) => void; children: ReactNode }) {
  const editor = mode === "editor";
  const attributes = safeAttributes(node.attributes);
  return <div {...attributes} draggable={editor && Boolean(onMoveNode)} onDragStart={onMoveNode ? (event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-celebratedeal-funnel-node", node.id); } : undefined} onDragOver={onMoveNode ? (event) => { if (event.dataTransfer.types.includes("application/x-celebratedeal-funnel-node")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; } } : undefined} onDrop={onMoveNode ? (event) => { const sourceId = event.dataTransfer.getData("application/x-celebratedeal-funnel-node"); if (sourceId && sourceId !== node.id) { event.preventDefault(); event.stopPropagation(); onMoveNode(sourceId, node.id); } } : undefined} data-funnel-node-id={node.id} data-funnel-node-type={node.type} data-funnel-selected={selectedNodeId === node.id ? "true" : "false"} className={`${editor ? "relative cursor-grab rounded-sm transition-shadow hover:ring-1 hover:ring-amber-300" : ""} ${selectedNodeId === node.id ? "ring-2 ring-amber-500 ring-offset-2" : ""}`} style={nodeStyle(resolved.style, viewport)} onClick={onSelectNode ? (event) => { event.stopPropagation(); onSelectNode(node.id); } : undefined}>{children}</div>;
}

// The switch is the explicit registry-to-markup boundary; keeping it together
// makes unsupported element behaviour auditable in one place.
// eslint-disable-next-line complexity
function NodeRenderer({ node, viewport, mode, flow, submission, consultation, publicSurface = false, selectedNodeId, onSelectNode, onMoveNode }: { node: FunnelNode; viewport: FunnelViewport; mode: FunnelRenderMode; flow?: PageDocument["flow"]; submission?: FunnelSubmissionContext; consultation?: FunnelPageDocumentRendererProps["consultation"]; publicSurface?: boolean; selectedNodeId?: string; onSelectNode?: (nodeId: string) => void; onMoveNode?: (sourceNodeId: string, targetNodeId: string) => void }): ReactNode {
  const commerceContext = useContext(CommerceRenderContext);
  const resolved = resolveNode(node, viewport);
  if (!resolved.visible) return null;
  const children = node.children ?? [];
  const renderChildren = () => children.map((child) => <NodeRenderer key={child.id} node={child} viewport={viewport} mode={mode} flow={flow} submission={submission} consultation={consultation} publicSurface={publicSurface} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} onMoveNode={onMoveNode} />);
  const surface = (content: ReactNode) => <NodeSurface node={node} resolved={resolved} viewport={viewport} mode={mode} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} onMoveNode={onMoveNode}>{content}</NodeSurface>;
  const props = resolved.props;
  switch (node.type) {
    case "offer_price": case "payment_button": case "payment_method": case "physical_product": case "customer_type": case "agreement": case "order_bump": case "coupon": case "two_step_order_form": case "shipping_fees":
      return surface(<><FunnelCommerceElement type={node.type} {...commerceContext} interactive={publicSurface && mode !== "editor"} />{renderChildren()}</>);
    case "section": return surface(<section>{renderChildren()}</section>);
    case "row": return surface(<div className="flex min-w-0 flex-col gap-4">{renderChildren()}</div>);
    case "columns_2": return surface(<div className={`grid min-w-0 gap-4 ${viewport === "mobile" ? "grid-cols-1" : "grid-cols-2"}`}>{renderChildren()}</div>);
    case "columns_3": return surface(<div className={`grid min-w-0 gap-4 ${viewport === "mobile" ? "grid-cols-1" : "grid-cols-3"}`}>{renderChildren()}</div>);
    case "columns_4": return surface(<div className={`grid min-w-0 gap-4 ${viewport === "mobile" ? "grid-cols-1" : "grid-cols-4"}`}>{renderChildren()}</div>);
    case "text": return surface(<p className="whitespace-pre-line">{stringProp(props, ["text", "content", "body"], "文字內容")}</p>);
    case "headline": {
      const level = stringProp(props, ["level"], "h2");
      return surface(<HeadlineMarkup level={level} text={stringProp(props, ["text", "content", "title"], "標題")} />);
    }
    case "bulleted_list": return surface(<ul className="list-disc space-y-1 pl-5">{(stringList(props.items).length ? stringList(props.items) : ["清單項目"]).map((item, index) => <li key={`${node.id}-item-${index}`}>{item}</li>)}</ul>);
    case "content_box": return surface(<div className="rounded-xl border border-slate-200 bg-white/70 p-4">{children.length ? renderChildren() : <p className="whitespace-pre-line">{stringProp(props, ["text", "content", "description", "title"], "內容區塊")}</p>}</div>);
    case "image": {
      const src = safeResourceUrl(props.src ?? props.imageUrl ?? props.url);
      return surface(src ? <figure><img src={src} alt={stringProp(props, ["alt", "altText"])} className="h-auto max-w-full object-cover" />{stringProp(props, ["caption"]) ? <figcaption className="mt-2 text-sm text-slate-500">{stringProp(props, ["caption"])}</figcaption> : null}</figure> : <UnsupportedNode node={node} message="圖片網址不安全或尚未設定。" />);
    }
    case "video": {
      const src = safeMediaSource(props);
      const poster = safeResourceUrl(props.poster);
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
      if (props.variant === "checkout-contact") return surface(<fieldset disabled>{renderChildren()}</fieldset>);
      if (children.some((child) => getFunnelNodeDefinition(child.type).category === "payment")) return surface(<div aria-label={label}>{renderChildren()}</div>);
      const requireConsent = children.some((child) => child.type === "checkbox" && child.props.required === true);
      if (mode === "preview" && submission) return surface(<PublicSubmissionForm submission={submission} label={label} requireConsent={requireConsent} />);
      if (publicSurface) return surface(<UnsupportedNode node={node} message="此 Funnel 尚未綁定可公開使用的報名表，表單已停用。" />);
      return surface(<form aria-label={label} onSubmit={(event) => event.preventDefault()}>{stringProp(props, ["title", "heading"]) ? <h3 className="mb-4 font-semibold">{stringProp(props, ["title", "heading"])}</h3> : null}{renderChildren()}</form>);
    }
    case "form_input": {
      const label = stringProp(props, ["label", "title", "placeholder"], "欄位");
      const inputId = `${node.id}-input`;
      return surface(<label className="block space-y-1" htmlFor={inputId}><span className="text-sm font-medium text-slate-700">{label}</span><input id={inputId} name={safeNodeName(node, props, node.id)} type={safeInputType(props.inputType ?? props.type)} placeholder={stringProp(props, ["placeholder"])} required={props.required === true} defaultValue={typeof props.defaultValue === "string" ? props.defaultValue : undefined} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>);
    }
    case "checkbox": {
      const label = stringProp(props, ["label", "text", "title"], "我同意上述內容");
      return surface(<label className="flex items-start gap-2"><input type="checkbox" name={safeNodeName(node, props, node.id)} required={props.required === true} defaultChecked={props.checked === true} className="mt-1" /><span>{label}</span></label>);
    }
    case "calendar": {
      const eventId = stringProp(props, ["eventId", "calendarId", "bookingEventId"]);
      const event = consultation?.events.find((candidate) => candidate.id === eventId);
      const executable = Boolean(event);
      if (!executable || !consultation) return surface(<UnsupportedNode node={node} message="尚未綁定行事曆事件，或事件不屬於此 Funnel 的公開專案；預約功能已停用。" />);
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
      const html = stringProp(props, ["html", "content"]);
      return surface(html ? <div><p className="sr-only">原始 HTML 已在 sandbox 隔離預覽</p><SandboxedHtml html={html} label={stringProp(props, ["title", "ariaLabel"], "隔離的自訂內容")} /></div> : <UnsupportedNode node={node} message="尚未提供可隔離顯示的 HTML。" />);
    }
    case "recaptcha": return surface(<UnsupportedNode node={node} message="CelebrateDeal 尚未具備已驗證的 server verification 與網域設定，因此 reCAPTCHA 不可用。" />);
    case "countdown": {
      const target = safeDateTime(props.targetDate ?? props.endAt ?? props.deadline);
      if (!target) return surface(<UnsupportedNode node={node} message="尚未設定有效的截止時間。" />);
      return surface(<div className="rounded-xl border border-slate-200 bg-white/70 p-4 text-center" data-countdown-target={target}><p className="mb-2 text-sm text-slate-500">倒數至 <time dateTime={target} className="font-semibold">{new Date(target).toLocaleString("zh-TW")}</time></p><CountdownDisplay target={target} /></div>);
    }
    case "menu": {
      const items = safeMenuItems(props.items ?? props.links);
      return surface(<nav aria-label={stringProp(props, ["ariaLabel", "title"], "頁面選單")}><ul className="flex flex-wrap gap-3">{(items.length ? items : [{ label: "尚未設定選單項目", href: null }]).map((item, index) => <li key={`${node.id}-menu-${index}`}>{item.href ? <a href={item.href} className="text-slate-700 underline-offset-2 hover:underline">{item.label}</a> : <span className="text-slate-500">{item.label}</span>}</li>)}</ul></nav>);
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
      const label = stringProp(props, ["label", "text", "title"], "立即行動");
      const sourceType = actionType(source);
      const popupId = sourceType === "show_popup" && source && typeof source === "object" && "popupId" in source && typeof source.popupId === "string" ? source.popupId : null;
      const nextStepId = sourceType === "next_step" && source && typeof source === "object" && "stepId" in source && typeof source.stepId === "string" ? source.stepId : null;
      const nextStep = nextStepId ? flow?.steps.find((step) => step.id === nextStepId) : undefined;
      const nextStepHref = flow && nextStep ? `/lp/${flow.domain}/${nextStep.path}` : null;
      const submit = sourceType === "submit_form";
      const supportedButton = sourceType === null || sourceType === "none" || submit || Boolean(popupId);
      return surface(action ? <a href={action.href} target={action.newTab ? "_blank" : undefined} rel={action.newTab ? "noreferrer" : undefined} download={action.download} className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950">{label}</a> : nextStepHref ? <a href={nextStepHref} className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950">{label}</a> : <button type={submit ? "submit" : "button"} disabled={!supportedButton} aria-disabled={!supportedButton || undefined} onClick={popupId ? () => window.dispatchEvent(new CustomEvent("celebratedeal:show-popup", { detail: { popupId } })) : undefined} className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">{label}</button>);
    }
    case "horizontal_line": return surface(<hr className="border-slate-200" />);
    default: return surface(<UnsupportedNode node={node} message={capabilityMessage(node)} />);
  }
}

function UnsupportedNode({ node, message, children }: { node: FunnelNode; message: string; children?: ReactNode }) {
  return <div data-funnel-capability={node.type} className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600"><p className="font-semibold text-slate-800">{LABELS[node.type]}：目前無法在此預覽</p><p className="mt-1">{message}</p>{children ? <div className="mt-3">{children}</div> : null}</div>;
}

function pageStyle(document: PageDocument, viewport: FunnelViewport): CSSProperties {
  const typography = document.settings.typography;
  const result: CSSProperties = { color: color(typography.textColor), fontSize: `${typography.bodySize}px`, lineHeight: typography.bodyLineHeight, textAlign: typography.alignment, backgroundColor: color(document.settings.background.color) };
  if (viewport === "mobile") result.fontSize = `${Math.min(typography.bodySize, 18)}px`;
  return result;
}

/** Shared renderer for the editor canvas and the safe public/preview surface. */
export function FunnelPageDocumentRenderer({ document, viewport = "desktop", mode = "preview", submission, consultation, commerce, publicSurface = false, selectedNodeId, onSelectNode, onMoveNode, className = "" }: FunnelPageDocumentRendererProps) {
  const parsed = parsePageDocument(document);
  if (!parsed) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">頁面內容不符合安全格式，暫時無法顯示。</div>;
  return <CommerceRenderContext.Provider value={{ binding: parsed.commerce, commerce }}><main data-funnel-renderer data-viewport={viewport} data-render-mode={mode} className={`min-h-full w-full ${className}`.trim()} style={pageStyle(parsed, viewport)}>{parsed.root.map((node) => <NodeRenderer key={node.id} node={node} viewport={viewport} mode={mode} flow={parsed.flow} submission={submission} consultation={consultation} publicSurface={publicSurface} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} onMoveNode={onMoveNode} />)}</main></CommerceRenderContext.Provider>;
}

export const FunnelPageRenderer = FunnelPageDocumentRenderer;

export type { FunnelNodeAction };
