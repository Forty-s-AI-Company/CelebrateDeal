import type { FunnelNode, FunnelNodeStyle, FunnelPageSettings } from "@/lib/funnel-page-document";
import type { FunnelTemplatePurpose, FunnelTemplateStyle } from "@/lib/funnel-template-catalog";
import { webinarTemplateKit } from "@/lib/funnel-templates/webinar/types";

/**
 * 名單頁（leads）與銷售頁（sales）範本的資料契約，結構比照 Webinar 範本
 * （docs/product/funnel-templates/IMPLEMENTING.md）。每個範本另外附一份感謝頁設計
 * （`thankYou`），由共用產生器做出同風格的名單感謝頁或訂單感謝頁，讓整條漏斗一致。
 */
export type ConversionTemplateKind = "leads" | "sales";

/** 感謝頁沿用主範本的色票與字型；所有顏色組合都要過 AA（共用檢查會算對比）。 */
export type ConversionThankYouTokens = {
  /** 頁面底色。 */
  background: string;
  /** 卡片底色（白卡或深色卡）。 */
  surface: string;
  /** 標題字色（對 background 與 surface 都要 ≥ 4.5:1）。 */
  ink: string;
  /** 內文字色（對 background 與 surface 都要 ≥ 4.5:1）。 */
  body: string;
  /** 強調色：eyebrow、編號、按鈕底色（對 background ≥ 4.5:1）。 */
  accent: string;
  /** 按鈕文字色（對 accent ≥ 4.5:1）。 */
  onAccent: string;
  /** 卡片框線。 */
  line: string;
  /** 頁尾底色與字色（深色收尾帶）。 */
  footerBackground: string;
  footerText: string;
  /** 按鈕圓角（px）。 */
  radius: number;
};

export type ConversionThankYouDesign = {
  /** 感謝頁在步驟選單的名稱，例如「Instagram 企劃表・名單感謝頁」。 */
  name: string;
  description: string;
  tokens: ConversionThankYouTokens;
  /** 首屏文案。名單感謝頁：交付資源；訂單感謝頁：說明付款確認與開通／出貨。 */
  eyebrow: string;
  title: string;
  intro: string;
  /** 首屏卡片：名單＝資源名稱＋下載按鈕；訂單＝購買內容摘要（不寫金額）。 */
  card: { title: string; text: string; buttonLabel?: string; buttonHref?: string };
  /** 接下來三步（編號清單）。 */
  steps: readonly [ThankYouStep, ThankYouStep, ThankYouStep];
  /** 選填：下一步推薦（名單頁導向付費方案、訂單頁導向社群或回購）。 */
  next?: { eyebrow: string; title: string; text: string; buttonLabel: string; buttonHref: string };
  /** 訂單感謝頁的常見問題（發票、退款、聯絡）；名單感謝頁可省略。 */
  faq?: ReadonlyArray<{ question: string; answer: string }>;
  /** 頁尾一句話（品牌或聯絡方式）。 */
  footer: string;
};
type ThankYouStep = { title: string; text: string; icon?: string };

export type ConversionTemplateDefinition = {
  /** `leads-<slug>` 或 `sales-<slug>`；發布後不可改名（已存頁面記錄這個 id）。感謝頁 id 是 `${id}-thanks`。 */
  id: `leads-${string}` | `sales-${string}`;
  kind: ConversionTemplateKind;
  /** spec 編號 1–8。 */
  number: number;
  name: string;
  description: string;
  category: string;
  purposes: readonly FunnelTemplatePurpose[];
  styles: readonly FunnelTemplateStyle[];
  preview: { eyebrow: string; headline: string; summary: string; palette: readonly [string, string, string]; sectionCount: number };
  theme: { typography: Partial<FunnelPageSettings["typography"]>; background: { color: string } };
  settings?: Partial<Pick<FunnelPageSettings, "scrollReveal" | "stickyCta">>;
  build: (prefix: string) => FunnelNode[];
  thankYou: ConversionThankYouDesign;
  hidden?: boolean;
};

/** 範本節點工廠：與 Webinar 範本相同（id 為 `${prefix}_<區塊>_<元素>`）。 */
export const conversionTemplateKit = webinarTemplateKit;

/** 評價、Logo、數據與價值的「範本示意」標記。 */
export const CONVERSION_TEMPLATE_SAMPLE_MARK = "範本示意";

/**
 * 銷售頁的報價卡：價格與結帳按鈕一律由「訂單表單」步驟綁定的商品提供
 * （`offer_price`、`payment_button` 讀伺服器商品，範本不寫售價）。
 * 卡片必須是淺色底：結帳元件的字色固定為深色。
 */
export function conversionOfferCard(prefix: string, id: string, options: { title: string; lines?: readonly string[]; note: string; style: FunnelNodeStyle; mobile?: { style: FunnelNodeStyle }; titleColor: string; noteColor: string; htmlId?: string }): FunnelNode {
  const { node, headline, text } = conversionTemplateKit(prefix);
  return node(id, "form", { variant: "checkout-summary", ariaLabel: options.title }, [
    headline(`${id}_title`, options.title, "h3", { color: options.titleColor }),
    ...(options.lines ?? []).map((line, index) => text(`${id}_line_${index + 1}`, line, undefined, { color: options.noteColor, fontSize: 16 })),
    node(`${id}_price`, "offer_price"),
    node(`${id}_pay`, "payment_button", { label: "前往安全結帳" }),
    text(`${id}_note`, options.note, "small", { color: options.noteColor }),
  ], { ...options.style, textAlign: "left" }, { htmlId: options.htmlId, ...(options.mobile ? { mobile: options.mobile } : {}) });
}
