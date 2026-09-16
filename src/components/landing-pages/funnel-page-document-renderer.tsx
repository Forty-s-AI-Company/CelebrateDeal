"use client";

/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, ReactNode } from "react";

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
  className?: string;
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

function NodeSurface({ node, resolved, viewport, mode, selectedNodeId, onSelectNode, children }: { node: FunnelNode; resolved: ResolvedNode; viewport: FunnelViewport; mode: FunnelRenderMode; selectedNodeId?: string; onSelectNode?: (nodeId: string) => void; children: ReactNode }) {
  const editor = mode === "editor";
  const attributes = safeAttributes(node.attributes);
  return <div {...attributes} data-funnel-node-id={node.id} data-funnel-node-type={node.type} data-funnel-selected={selectedNodeId === node.id ? "true" : "false"} className={`${editor ? "relative rounded-sm transition-shadow hover:ring-1 hover:ring-amber-300" : ""} ${selectedNodeId === node.id ? "ring-2 ring-amber-500 ring-offset-2" : ""}`} style={nodeStyle(resolved.style, viewport)} onClick={onSelectNode ? (event) => { event.stopPropagation(); onSelectNode(node.id); } : undefined}>{children}</div>;
}

// The switch is the explicit registry-to-markup boundary; keeping it together
// makes unsupported element behaviour auditable in one place.
// eslint-disable-next-line complexity
function NodeRenderer({ node, viewport, mode, selectedNodeId, onSelectNode }: { node: FunnelNode; viewport: FunnelViewport; mode: FunnelRenderMode; selectedNodeId?: string; onSelectNode?: (nodeId: string) => void }): ReactNode {
  const resolved = resolveNode(node, viewport);
  if (!resolved.visible) return null;
  const children = node.children ?? [];
  const renderChildren = () => children.map((child) => <NodeRenderer key={child.id} node={child} viewport={viewport} mode={mode} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />);
  const surface = (content: ReactNode) => <NodeSurface node={node} resolved={resolved} viewport={viewport} mode={mode} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode}>{content}</NodeSurface>;
  const props = resolved.props;
  switch (node.type) {
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
    case "button": {
      const source: unknown = node.actions[0] ?? props.action;
      const action = safeAction(source);
      const label = stringProp(props, ["label", "text", "title"], "立即行動");
      const sourceType = actionType(source);
      const unsupportedAction = sourceType !== null && sourceType !== "none" && (sourceType !== "open_url" && sourceType !== "download" || !action);
      return surface(action ? <a href={action.href} target={action.newTab ? "_blank" : undefined} rel={action.newTab ? "noreferrer" : undefined} download={action.download} className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950">{label}</a> : <button type="button" disabled={unsupportedAction} aria-disabled={unsupportedAction || undefined} className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">{label}</button>);
    }
    case "horizontal_line": return surface(<hr className="border-slate-200" />);
    default: return surface(<UnsupportedNode node={node} message={capabilityMessage(node)}>{node.type === "faq" || node.type === "carousel" ? renderChildren() : null}</UnsupportedNode>);
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
export function FunnelPageDocumentRenderer({ document, viewport = "desktop", mode = "preview", selectedNodeId, onSelectNode, className = "" }: FunnelPageDocumentRendererProps) {
  const parsed = parsePageDocument(document);
  if (!parsed) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">頁面內容不符合安全格式，暫時無法顯示。</div>;
  return <main data-funnel-renderer data-viewport={viewport} data-render-mode={mode} className={`min-h-full w-full ${className}`.trim()} style={pageStyle(parsed, viewport)}>{parsed.root.map((node) => <NodeRenderer key={node.id} node={node} viewport={viewport} mode={mode} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />)}</main>;
}

export const FunnelPageRenderer = FunnelPageDocumentRenderer;

export type { FunnelNodeAction };
