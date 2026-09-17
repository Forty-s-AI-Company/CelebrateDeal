import {
  FUNNEL_CAPABILITIES,
  parsePageDocument,
  type FunnelBlockCategory,
  type FunnelNode,
  type FunnelNodeAction,
  type FunnelNodeType,
} from "@/lib/funnel-page-document";

export { FUNNEL_BLOCK_CATEGORIES } from "@/lib/funnel-page-document";
export type { FunnelBlockCategory } from "@/lib/funnel-page-document";

/**
 * A reusable block is a factory instead of a persisted HTML snippet.  Each
 * invocation creates a fresh, editable node tree that can be merged into a
 * PageDocument root without sharing object references with another block.
 */
export interface FunnelBlockTemplate {
  id: string;
  category: FunnelBlockCategory;
  label: string;
  description: string;
  /** Number of visual variants observed in the reference inventory. */
  variantCount: number;
  capability?: typeof FUNNEL_CAPABILITIES.payment;
  factory: (instanceId: string) => FunnelNode;
}

export interface FunnelBlockCategoryMetadata {
  id: FunnelBlockCategory;
  label: string;
  description: string;
  variantCount: number;
}

const node = (
  type: FunnelNodeType,
  id: string,
  props: Record<string, unknown> = {},
  children?: FunnelNode[],
  style: FunnelNode["style"] = {},
  actions: FunnelNodeAction[] = [],
): FunnelNode => ({
  schemaVersion: 1,
  id,
  type,
  props,
  style,
  overrides: {},
  visible: true,
  actions,
  attributes: {},
  ...(children ? { children } : {}),
});

const text = (id: string, content: string, style: FunnelNode["style"] = {}) =>
  node("text", id, { text: content }, undefined, style);

const headline = (id: string, content: string, level: "h1" | "h2" | "h3" = "h2") =>
  node("headline", id, { text: content, level });

const image = (id: string, alt: string, src = "/placeholder.svg") =>
  node("image", id, { src, alt, objectFit: "cover" }, undefined, { imageWidth: 100, borderRadius: 12 });

const button = (
  id: string,
  label: string,
  action: FunnelNodeAction = { type: "open_url", href: "#signup", newTab: false },
) => node("button", id, { label, variant: "primary" }, undefined, {}, [action]);

const column = (id: string, children: FunnelNode[], type: "columns_2" | "columns_3" | "columns_4" = "columns_2") =>
  node(type, id, { gap: 24 }, children, { align: "stretch" });

const section = (id: string, children: FunnelNode[]) =>
  node("section", id, { fullWidth: true }, [node("row", `${id}-row`, { maxWidth: 1120 }, children, { align: "stretch" })], { padding: 56 });

/**
 * Each category ships a small, opinionated starter set.  Variants share the
 * same editable node contract while changing composition cues for different
 * campaign jobs (launch, education, conversion).
 */
export const FUNNEL_BLOCK_CATEGORY_METADATA: Readonly<Record<FunnelBlockCategory, FunnelBlockCategoryMetadata>> = {
  order_forms: { id: "order_forms", label: "訂單表單", description: "兩步驟訂單表單與方案摘要", variantCount: 3 },
  opt_in_forms: { id: "opt_in_forms", label: "名單表單", description: "收集聯絡資料的註冊表單", variantCount: 3 },
  features: { id: "features", label: "功能特色", description: "多欄特色與重點說明", variantCount: 3 },
  page_footers: { id: "page_footers", label: "頁尾", description: "品牌資訊、導覽與社群連結", variantCount: 3 },
  team_presentation: { id: "team_presentation", label: "團隊介紹", description: "團隊成員照片、職稱與介紹", variantCount: 3 },
  welcome: { id: "welcome", label: "歡迎區塊", description: "Hero 歡迎訊息與行動按鈕", variantCount: 3 },
  price_plans: { id: "price_plans", label: "價格方案", description: "方案比較、推薦方案與行動按鈕", variantCount: 3 },
  page_headers: { id: "page_headers", label: "頁首", description: "品牌名稱與導覽選單", variantCount: 3 },
  testimonials: { id: "testimonials", label: "客戶見證", description: "照片、引言與客戶資訊", variantCount: 3 },
};

type BlockFactory = (instanceId: string) => FunnelNode;

const variantFactory = (base: BlockFactory, variant: string, accent: string): BlockFactory => (instanceId) => {
  const root = base(instanceId);
  root.props = { ...root.props, visualVariant: variant, accent };
  root.style = { ...root.style, backgroundColor: accent, shadow: "soft" };
  return root;
};

const orderForm: BlockFactory = (instanceId) => {
  const left = node("content_box", `${instanceId}-summary`, { variant: "product-summary" }, [
    image(`${instanceId}-product-image`, "方案示意圖片"),
    headline(`${instanceId}-summary-title`, "完成你的方案訂購"),
    text(`${instanceId}-summary-copy`, "這是可編輯的方案摘要。正式付款前，請先在方案設定中連結商品與付款方式。"),
    node("bulleted_list", `${instanceId}-summary-list`, { items: ["立即取得完整內容", "享有會員專屬支援", "付款資料由既有安全流程處理"] }),
  ]);
  const formId = `${instanceId}-form`;
  const limitedPaymentProps = {
    capabilityStatus: FUNNEL_CAPABILITIES.payment.status,
    capabilityReason: FUNNEL_CAPABILITIES.payment.reason,
    disabled: true,
  };
  const right = node("form", formId, { variant: "two-step-order", ...limitedPaymentProps }, [
    text(`${instanceId}-form-title`, "訂購資料", { fontSize: 24, lineHeight: 1.25 }),
    node("form_input", `${instanceId}-first-name`, { inputType: "text", label: "名字", placeholder: "請輸入名字" }),
    node("form_input", `${instanceId}-email`, { inputType: "email", label: "電子信箱", placeholder: "name@example.com" }),
    node("offer_price", `${instanceId}-offer-price`, limitedPaymentProps),
    node("payment_method", `${instanceId}-payment-method`, limitedPaymentProps),
    node("payment_button", `${instanceId}-payment-button`, { label: "前往安全付款", ...limitedPaymentProps }),
  ]);
  return section(instanceId, [column(`${instanceId}-columns`, [left, right])]);
};

const optInForm: BlockFactory = (instanceId) => {
  const formId = `${instanceId}-form`;
  const form = node("form", formId, { variant: "opt-in" }, [
    text(`${instanceId}-form-title`, "免費取得實用指南", { fontSize: 24, lineHeight: 1.25 }),
    text(`${instanceId}-form-copy`, "留下資料，我們會把內容寄到你的信箱。"),
    node("form_input", `${instanceId}-name`, { inputType: "text", label: "姓名", placeholder: "你的姓名" }),
    node("form_input", `${instanceId}-email`, { inputType: "email", label: "電子信箱", placeholder: "name@example.com" }),
    node("checkbox", `${instanceId}-consent`, { label: "我同意接收 CelebrateDeal 最新消息", optional: false }),
    button(`${instanceId}-submit`, "免費下載", { type: "submit_form", formId }),
  ]);
  return section(instanceId, [column(`${instanceId}-columns`, [
    node("content_box", `${instanceId}-intro`, { variant: "image-copy" }, [
      image(`${instanceId}-image`, "下載指南封面"),
      headline(`${instanceId}-headline`, "把好點子變成下一步行動"),
      text(`${instanceId}-text`, "用一份簡單清楚的指南，陪你整理目標、內容與轉換流程。"),
    ]),
    form,
  ])]);
};

const features: BlockFactory = (instanceId) => {
  const cards = [
    ["快速上手", "清楚的流程讓團隊今天就能開始。"],
    ["彈性編輯", "文字、圖片與按鈕都可以獨立調整。"],
    ["持續優化", "保留桌機與手機設定，方便持續迭代。"],
  ] as const;
  return section(instanceId, [column(`${instanceId}-columns`, cards.map(([title, copy], index) =>
    node("content_box", `${instanceId}-feature-${index + 1}`, { variant: "feature-card" }, [
      headline(`${instanceId}-feature-${index + 1}-title`, title, "h3"),
      text(`${instanceId}-feature-${index + 1}-copy`, copy),
      button(`${instanceId}-feature-${index + 1}-button`, "了解更多"),
    ]),
  ), "columns_3")]);
};

const pageFooter: BlockFactory = (instanceId) => section(instanceId, [column(`${instanceId}-columns`, [
  node("content_box", `${instanceId}-brand`, { variant: "brand" }, [
    headline(`${instanceId}-brand-title`, "CelebrateDeal", "h3"),
    text(`${instanceId}-brand-copy`, "讓每一次分享，都更靠近值得慶祝的成果。"),
  ]),
  node("menu", `${instanceId}-menu`, { items: [{ label: "首頁", href: "#top" }, { label: "關於我們", href: "#about" }, { label: "聯絡我們", href: "#contact" }] }),
  node("content_box", `${instanceId}-social`, { variant: "social" }, [
    headline(`${instanceId}-social-title`, "一起保持聯絡", "h3"),
    text(`${instanceId}-social-copy`, "追蹤最新活動與實用內容。"),
    node("x_share_button", `${instanceId}-share`, { label: "分享這個頁面" }),
  ]),
], "columns_3")]);

const teamPresentation: BlockFactory = (instanceId) => {
  const members = [
    ["林怡安", "內容策略顧問", "陪你把品牌故事說得清楚又有溫度。"],
    ["陳柏宇", "產品設計師", "把複雜流程整理成好用的體驗。"],
    ["王思妤", "客戶成功經理", "一起追蹤成果，讓每一步都更踏實。"],
  ] as const;
  return section(instanceId, [column(`${instanceId}-columns`, members.map(([name, role, copy], index) =>
    node("content_box", `${instanceId}-member-${index + 1}`, { variant: "team-card" }, [
      image(`${instanceId}-member-${index + 1}-image`, `${name} 的照片`),
      headline(`${instanceId}-member-${index + 1}-name`, name, "h3"),
      text(`${instanceId}-member-${index + 1}-role`, role),
      text(`${instanceId}-member-${index + 1}-copy`, copy),
    ]),
  ), "columns_3")]);
};

const welcome: BlockFactory = (instanceId) => section(instanceId, [column(`${instanceId}-columns`, [
  node("content_box", `${instanceId}-copy`, { variant: "hero-copy" }, [
    headline(`${instanceId}-headline`, "歡迎來到 CelebrateDeal", "h1"),
    text(`${instanceId}-body`, "從第一個想法開始，打造讓人願意採取行動的頁面。"),
    button(`${instanceId}-cta`, "開始探索"),
  ]),
  image(`${instanceId}-hero-image`, "品牌歡迎圖片"),
])]);

const pricePlans: BlockFactory = (instanceId) => {
  const plans = [
    ["入門方案", "適合剛開始整理流程的團隊", "NT$0"],
    ["成長方案", "適合需要持續優化的品牌", "NT$990"],
    ["專業方案", "適合正在放大成果的團隊", "NT$2,490"],
  ] as const;
  return section(instanceId, [column(`${instanceId}-columns`, plans.map(([name, copy, price], index) =>
    node("content_box", `${instanceId}-plan-${index + 1}`, { variant: index === 1 ? "recommended" : "standard", highlighted: index === 1 }, [
      headline(`${instanceId}-plan-${index + 1}-name`, name, "h3"),
      text(`${instanceId}-plan-${index + 1}-copy`, copy),
      headline(`${instanceId}-plan-${index + 1}-price`, price, "h2"),
      node("bulleted_list", `${instanceId}-plan-${index + 1}-features`, { items: ["可編輯頁面", "桌機／手機設定", "基本支援"] }),
      button(`${instanceId}-plan-${index + 1}-button`, "選擇方案"),
    ]),
  ), "columns_3")]);
};

const pageHeader: BlockFactory = (instanceId) => section(instanceId, [column(`${instanceId}-columns`, [
  headline(`${instanceId}-brand`, "CelebrateDeal", "h2"),
  node("menu", `${instanceId}-menu`, { items: [{ label: "首頁", href: "#top" }, { label: "功能", href: "#features" }, { label: "聯絡", href: "#contact" }] }),
])]);

const testimonials: BlockFactory = (instanceId) => {
  const quotes = [
    ["黃詩涵", "行銷顧問", "現在每個段落都能獨立調整，團隊溝通順很多。"],
    ["張凱文", "創業者", "從想法到上線，流程終於不再卡在最後一步。"],
    ["許雅婷", "品牌經理", "手機版也能清楚呈現，客戶回饋變得更好。"],
  ] as const;
  return section(instanceId, [column(`${instanceId}-columns`, quotes.map(([name, role, quote], index) =>
    node("content_box", `${instanceId}-quote-${index + 1}`, { variant: "testimonial-card" }, [
      image(`${instanceId}-quote-${index + 1}-image`, `${name} 的照片`),
      text(`${instanceId}-quote-${index + 1}-quote`, `「${quote}」`),
      headline(`${instanceId}-quote-${index + 1}-name`, name, "h3"),
      text(`${instanceId}-quote-${index + 1}-role`, role),
    ]),
  ), "columns_3")]);
};

const definitions: Record<string, FunnelBlockTemplate> = {};
const registerVariants = (id: string, category: FunnelBlockCategory, label: string, description: string, base: BlockFactory, capability?: typeof FUNNEL_CAPABILITIES.payment) => {
  (["editorial", "spotlight", "compact"] as const).forEach((variant, index) => {
    const templateId = `${id}-${variant}`;
    definitions[templateId] = { id: templateId, category, label: `${label}・${["編輯版", "聚焦版", "精簡版"][index]}`, description, variantCount: 3, ...(capability ? { capability } : {}), factory: variantFactory(base, variant, ["#f8fafc", "#fff7ed", "#f0fdf4"][index]) };
  });
};
registerVariants("order-form", "order_forms", "訂單表單", "方案摘要搭配受限制的付款欄位。", orderForm, FUNNEL_CAPABILITIES.payment);
registerVariants("opt-in-form", "opt_in_forms", "名單表單", "圖片與可編輯註冊表單。", optInForm);
registerVariants("features", "features", "功能特色", "三張可獨立編輯的特色卡片。", features);
registerVariants("page-footer", "page_footers", "品牌導覽頁尾", "品牌資訊、導覽選單與社群分享。", pageFooter);
registerVariants("team", "team_presentation", "團隊介紹", "團隊照片、職稱與介紹。", teamPresentation);
registerVariants("welcome", "welcome", "歡迎 Hero", "品牌歡迎訊息與主要行動按鈕。", welcome);
registerVariants("price-plans", "price_plans", "價格方案", "含推薦方案標示的價格比較。", pricePlans);
registerVariants("page-header", "page_headers", "品牌導覽頁首", "品牌名稱與頁內導覽。", pageHeader);
registerVariants("testimonials", "testimonials", "客戶見證", "照片、引言、姓名與職稱均可獨立編輯。", testimonials);

export const FUNNEL_BLOCK_REGISTRY: Readonly<Record<string, FunnelBlockTemplate>> = definitions;

let blockSequence = 0;

function nextInstanceId(templateId: string): string {
  blockSequence += 1;
  return `${templateId}-${Date.now().toString(36)}-${blockSequence}`;
}

/** Instantiate a fresh block. Unknown IDs fail explicitly so the picker cannot silently insert an empty block. */
export function instantiateBlock(templateId: string): FunnelNode {
  const template = FUNNEL_BLOCK_REGISTRY[templateId];
  if (!template) throw new Error(`找不到 Funnel block：${templateId}`);
  const result = template.factory(nextInstanceId(templateId));
  const valid = parsePageDocument({ schemaVersion: 1, id: "block-preview", name: template.label, root: [result], popups: [], settings: {} });
  if (!valid) throw new Error(`Funnel block 無法通過 PageDocument 驗證：${templateId}`);
  return result;
}

export function getFunnelBlocksByCategory(category: FunnelBlockCategory): FunnelBlockTemplate[] {
  return Object.values(FUNNEL_BLOCK_REGISTRY).filter((template) => template.category === category);
}
