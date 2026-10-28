import { getFunnelNodeDefinition, type FunnelNode, type FunnelNodeAction, type FunnelNodeStyle, type FunnelNodeType, type FunnelPageSettings } from "@/lib/funnel-page-document";
import type { FunnelTemplatePurpose, FunnelTemplateStyle } from "@/lib/funnel-template-catalog";

/**
 * Webinar 報名頁範本的資料契約。每個範本是 `NN-<slug>.ts` 裡的一個
 * `WebinarTemplateDefinition`，由 `index.ts` 統一登記；範本檔只描述資料，
 * 不改渲染器。寫法見 docs/product/webinar-templates/IMPLEMENTING.md。
 */
export type WebinarTemplateDefinition = {
  /** `webinar-<slug>`，與 spec 的「範本 id」相同；發布後不可改名（已存頁面記錄這個 id）。 */
  id: `webinar-${string}`;
  /** spec 編號 1–20（00 是開發用範例）。 */
  number: number;
  name: string;
  /** 範本庫卡片的一句話說明。 */
  description: string;
  /** 範本庫卡片的分類，例如「AI 工具講座」。 */
  category: string;
  /** 範本庫的用途／風格標籤（篩選用），依 spec 的「範本庫標籤」。 */
  purposes: readonly FunnelTemplatePurpose[];
  styles: readonly FunnelTemplateStyle[];
  /** 範本卡片縮圖的文字與三色色票。 */
  preview: { eyebrow: string; headline: string; summary: string; palette: readonly [string, string, string]; sectionCount: number };
  /** 頁面字型、文字顏色與背景。字型只能用 `FUNNEL_FONT_OPTIONS` 的 value（例如 sans-tc、serif-tc、wenkai-tc、display-latin）。 */
  theme: { typography: Partial<FunnelPageSettings["typography"]>; background: { color: string } };
  /** 頁面層級設定：活動名稱、捲動進場動畫、固定報名列。 */
  settings?: Partial<Pick<FunnelPageSettings, "eventTitle" | "scrollReveal" | "stickyCta">>;
  /** 回傳節點樹；所有節點 id 以 `${prefix}_` 開頭（見 `webinarTemplateKit`）。 */
  build: (prefix: string) => FunnelNode[];
  /** 開發用範例：不出現在範本庫，只在 harness 與測試中使用。 */
  hidden?: boolean;
};

type Overrides = { style?: FunnelNodeStyle; props?: Record<string, unknown>; visible?: boolean };
export type WebinarNodeOptions = {
  actions?: FunnelNodeAction[];
  /** HTML id（錨點），例如 `register`；同一頁不可重複。 */
  htmlId?: string;
  desktop?: Overrides;
  tablet?: Overrides;
  mobile?: Overrides;
};

export type WebinarSectionOptions = {
  background: string;
  color: string;
  /** 桌機上下留白（px），預設 96；平板 72；手機預設 56。 */
  paddingY?: number;
  paddingYTablet?: number;
  paddingYMobile?: number;
  /** 內容最大寬（px），預設 1120。 */
  maxWidth?: number;
  gap?: number;
  align?: "left" | "center";
  htmlId?: string;
  /** section props（例如背景圖 backgroundImage、overlayColor、overlayOpacity）。 */
  props?: Record<string, unknown>;
};

export type WebinarFormField = { name: string; label: string; type?: "text" | "email" | "tel"; placeholder?: string; required?: boolean; helpText?: string; half?: boolean };

/**
 * 範本節點工廠。節點 id 一律是 `${prefix}_<區塊>_<元素>`，固定且可預測
 * （已存文件與分析會參照節點 id），請不要在 build 裡用亂數或時間。
 */
export function webinarTemplateKit(prefix: string) {
  const overridesOf = (options: WebinarNodeOptions): FunnelNode["overrides"] => ({
    ...(options.desktop ? { desktop: options.desktop } : {}),
    ...(options.tablet ? { tablet: options.tablet } : {}),
    ...(options.mobile ? { mobile: options.mobile } : {}),
  });
  /** 任一節點。`props` 依節點類型而定（見 IMPLEMENTING.md 的元件表）。 */
  const node = (id: string, type: FunnelNodeType, props: Record<string, unknown> = {}, children?: FunnelNode[], style: FunnelNodeStyle = {}, options: WebinarNodeOptions = {}): FunnelNode => ({
    schemaVersion: 1,
    id: `${prefix}_${id}`,
    type,
    props,
    style,
    overrides: overridesOf(options),
    visible: true,
    actions: options.actions ?? [],
    attributes: options.htmlId ? { id: options.htmlId } : {},
    // Container types (faq, webinar_state…) always carry a children array, even when empty.
    ...(children ? { children } : getFunnelNodeDefinition(type).children ? { children: [] } : {}),
  });
  /** 全寬區塊：section > row（置中、最大寬）。 */
  const section = (id: string, children: FunnelNode[], options: WebinarSectionOptions) => {
    const { background, color, paddingY = 96, paddingYTablet = 72, paddingYMobile = 56, maxWidth = 1120, gap = 32, align, htmlId, props = {} } = options;
    return node(id, "section", props, [node(`${id}_row`, "row", { maxWidth, gap }, children)],
      { padding: `${paddingY}px 32px`, backgroundColor: background, color, ...(align ? { textAlign: align } : {}) },
      { htmlId, tablet: { style: { padding: `${paddingYTablet}px 28px` } }, mobile: { style: { padding: `${paddingYMobile}px 20px` } } });
  };
  /** 兩欄：ratio 例如 "7:5"；stackOn "tablet" 讓平板也上下堆疊；mobileOrder "reverse" 讓手機先顯示第二欄。 */
  const columns2 = (id: string, left: FunnelNode[], right: FunnelNode[], options: { ratio?: string; stackOn?: "mobile" | "tablet"; mobileOrder?: "default" | "reverse"; gap?: number; align?: FunnelNodeStyle["align"] } = {}) =>
    node(id, "columns_2", { ...(options.ratio ? { ratio: options.ratio } : {}), ...(options.stackOn ? { stackOn: options.stackOn } : {}), ...(options.mobileOrder ? { mobileOrder: options.mobileOrder } : {}), ...(options.gap !== undefined ? { gap: options.gap } : {}) },
      [stack(`${id}_left`, left), stack(`${id}_right`, right)], options.align ? { align: options.align } : {});
  /** 無外框的垂直堆疊（content_box，padding 0）。 */
  const stack = (id: string, children: FunnelNode[], gap = 20, style: FunnelNodeStyle = {}, options: WebinarNodeOptions = {}) => node(id, "content_box", { gap }, children, { padding: 0, ...style }, options);
  const headline = (id: string, text: string, level: "h1" | "h2" | "h3" | "h4" = "h2", style: FunnelNodeStyle = {}, options: WebinarNodeOptions = {}) => node(id, "headline", { text, level }, undefined, style, options);
  const text = (id: string, value: string, textStyle?: "lead" | "small" | "eyebrow", style: FunnelNodeStyle = {}, options: WebinarNodeOptions = {}) => node(id, "text", textStyle ? { text: value, textStyle } : { text: value }, undefined, style, options);
  /** 按鈕；`href` 為 `#register` 這類錨點或 HTTPS 網址。 */
  const button = (id: string, label: string, href: string, style: FunnelNodeStyle = {}, options: WebinarNodeOptions = {}) => node(id, "button", { label }, undefined, style, { ...options, actions: [{ type: "open_url", href, newTab: false }] });
  /**
   * 報名表單。欄位的 `name` 對應報名表設定的 key（name、email、phone…）；公開頁的
   * 實際欄位、類型與必填以伺服器報名表為準，這裡提供標籤、提示文字與樣式。
   */
  const form = (id: string, options: { fields: WebinarFormField[]; submitLabel: string; submitStyle?: FunnelNodeStyle; title?: string; consent?: string; note?: string; style?: FunnelNodeStyle; htmlId?: string; tablet?: Overrides; mobile?: Overrides }) => node(id, "form", { ariaLabel: options.title ?? "報名表單" }, [
    ...(options.title ? [headline(`${id}_title`, options.title, "h3")] : []),
    ...options.fields.map((field) => node(`${id}_${field.name}`, "form_input", { name: field.name, label: field.label, inputType: field.type ?? "text", required: field.required ?? false, ...(field.placeholder ? { placeholder: field.placeholder } : {}), ...(field.helpText ? { helpText: field.helpText } : {}), ...(field.half ? { width: "half" } : {}) })),
    ...(options.consent ? [node(`${id}_consent`, "checkbox", { label: options.consent, required: true })] : []),
    node(`${id}_submit`, "button", { label: options.submitLabel }, undefined, { width: 100, ...options.submitStyle }, { actions: [{ type: "submit_form" }] }),
    ...(options.note ? [text(`${id}_note`, options.note, "small")] : []),
  ], options.style ?? {}, { htmlId: options.htmlId, tablet: options.tablet, mobile: options.mobile });
  return { node, section, columns2, stack, headline, text, button, form };
}

/** 評價、Logo 與數據的「範本示意」標記（qa-standards §5.3）。 */
export const WEBINAR_TEMPLATE_SAMPLE_MARK = "範本示意";
