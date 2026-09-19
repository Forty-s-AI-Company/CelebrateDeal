import { FunnelPageBlocksSchema, type FunnelPageBlocks } from "@/lib/funnel-blocks-schema";

export const FUNNEL_ARCHETYPES = ["high_ticket", "lead_magnet", "summit"] as const;
export const FUNNEL_TEMPLATE_CATEGORIES = ["business", "technology", "finance", "beauty", "general"] as const;

export type FunnelArchetype = (typeof FUNNEL_ARCHETYPES)[number];
export type FunnelTemplateCategory = (typeof FUNNEL_TEMPLATE_CATEGORIES)[number];

export type FunnelTemplate = {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  archetype: FunnelArchetype;
  category: FunnelTemplateCategory;
  estimatedCvr: string;
  headline: string;
  pageBlocks: FunnelPageBlocks;
};

function validateTemplate(template: FunnelTemplate): FunnelTemplate {
  return { ...template, pageBlocks: FunnelPageBlocksSchema.parse(template.pageBlocks) };
}

export const FUNNEL_TEMPLATES: readonly FunnelTemplate[] = [
  validateTemplate({
    id: "high-ticket-masterclass",
    name: "高客單銷講大師範本",
    description: "以名師信任感、核心內容與限時早鳥，導向審核預約名單。",
    thumbnailUrl: "/images/funnel-templates/high-ticket-masterclass.svg",
    archetype: "high_ticket",
    category: "business",
    estimatedCvr: "8–15%",
    headline: "把你的專業，變成高價值且可複製的事業",
    pageBlocks: [
      { id: "master-hero", type: "hero_banner", sortOrder: 0, isVisible: true, settings: { eyebrow: "名師限定線上講座", headline: "把你的專業，變成高價值且可複製的事業", description: "90 分鐘拆解高客單產品定位、成交與交付系統。", imageUrl: "/images/funnel-templates/high-ticket-masterclass.svg", imageAlt: "高客單銷講大師班", ctaLabel: "申請預約席位", ctaHref: "#registration" } },
      { id: "master-slides", type: "carousel_slider", sortOrder: 1, isVisible: true, settings: { ariaLabel: "大師班核心投影片", autoPlay: true, intervalMs: 3000, showDots: true, showArrows: true, slides: [
        { id: "master-slide-1", imageUrl: "/images/funnel-templates/high-ticket-masterclass.svg", imageAlt: "高價定位", title: "高價定位" },
        { id: "master-slide-2", imageUrl: "/images/funnel-templates/high-ticket-masterclass.svg", imageAlt: "成交提案", title: "成交提案" },
        { id: "master-slide-3", imageUrl: "/images/funnel-templates/high-ticket-masterclass.svg", imageAlt: "交付系統", title: "交付系統" },
      ] } },
      { id: "master-deadline", type: "countdown_timer", sortOrder: 2, isVisible: true, settings: { title: "早鳥申請即將截止", mode: "fixed_date", theme: "flip", targetDate: "2030-12-31T23:59:59+08:00", expiredMessage: "本梯次早鳥已截止" } },
      { id: "master-pricing", type: "pricing_table", sortOrder: 3, isVisible: true, settings: { title: "選擇適合你的成長方案", layout: "three_column", cards: [
        { id: "master-foundation", name: "基礎實戰班", originalPrice: 39_800, salePrice: 29_800, currency: "TWD", features: ["完整線上課程", "作業回饋"], isFeatured: false, badgeText: "穩健起步", showBuyButton: true, buyButtonLabel: "申請方案", checkoutUrl: "#registration", showMoreInfoButton: false, moreInfoButtonLabel: "方案詳情" },
        { id: "master-growth", name: "成長陪跑班", originalPrice: 79_800, salePrice: 59_800, currency: "TWD", features: ["完整線上課程", "小組陪跑", "成交腳本健檢"], isFeatured: true, badgeText: "熱門首選", showBuyButton: true, buyButtonLabel: "申請方案", checkoutUrl: "#registration", showMoreInfoButton: false, moreInfoButtonLabel: "方案詳情" },
        { id: "master-private", name: "一對一顧問班", originalPrice: 168_000, salePrice: 128_000, currency: "TWD", features: ["完整線上課程", "一對一策略會議", "90 天執行陪跑"], isFeatured: false, badgeText: "限量席次", showBuyButton: true, buyButtonLabel: "申請方案", checkoutUrl: "#registration", showMoreInfoButton: false, moreInfoButtonLabel: "方案詳情" },
      ] } },
      { id: "master-registration", type: "lead_form", sortOrder: 4, isVisible: true, settings: { title: "申請審核預約名單", description: "留下資料，我們會與你確認目前階段與適合方案。", variant: "inline", fieldKeys: ["name", "email", "phone"], submitLabel: "申請預約" } },
      { id: "master-faq", type: "accordion_faq", sortOrder: 5, isVisible: true, settings: { title: "報名前常見問題", items: [
        { id: "master-faq-1", question: "這場講座適合誰？", answer: "適合已有專業服務、希望建立高客單產品與穩定成交流程的講師或顧問。" },
        { id: "master-faq-2", question: "填表就代表錄取嗎？", answer: "不是，團隊會先確認需求與適配度，再提供合適的參與方式。" },
      ] } },
    ],
  }),
  validateTemplate({
    id: "low-barrier-lead-magnet",
    name: "爆款低價引流範本",
    description: "痛點開場、贈品堆疊與 15 分鐘常青倒數，快速取得新名單。",
    thumbnailUrl: "/images/funnel-templates/low-barrier-lead-magnet.svg",
    archetype: "lead_magnet",
    category: "technology",
    estimatedCvr: "20–35%",
    headline: "別再讓 AI 工具越買越多，工作卻沒有變快",
    pageBlocks: [
      { id: "lead-hero", type: "hero_banner", sortOrder: 0, isVisible: true, settings: { eyebrow: "免費效率工具包", headline: "別再讓 AI 工具越買越多，工作卻沒有變快", description: "一次領取提示詞、工作流檢查表與實戰模板。", imageUrl: "/images/funnel-templates/low-barrier-lead-magnet.svg", imageAlt: "AI 效率工具包", ctaLabel: "立即免費領取", ctaHref: "#registration" } },
      { id: "lead-gifts", type: "accordion_faq", sortOrder: 1, isVisible: true, settings: { title: "這次會拿到的贈品禮包", items: [
        { id: "lead-gift-1", question: "50 組可直接複製的 AI 提示詞", answer: "涵蓋企劃、文案、研究與日常營運情境。" },
        { id: "lead-gift-2", question: "一頁式自動化工作流", answer: "把重複工作整理成團隊能交接的固定步驟。" },
        { id: "lead-gift-3", question: "導入檢查清單", answer: "避免工具很多、流程卻互相打架的常見坑。" },
      ] } },
      { id: "lead-timer", type: "countdown_timer", sortOrder: 2, isVisible: true, settings: { title: "本次加碼保留時間", mode: "evergreen_minutes", theme: "minimal", evergreenMinutes: 15, expiredMessage: "加碼已結束，仍可領取基本工具包" } },
      { id: "lead-pricing", type: "pricing_table", sortOrder: 3, isVisible: true, settings: { title: "選擇適合你的開始方式", layout: "two_column", cards: [
        { id: "lead-free", name: "免費領取", description: "先取得工具包", salePrice: 0, currency: "TWD", features: ["提示詞工具包", "工作流檢查表"], isFeatured: false, badgeText: "零門檻", showBuyButton: true, buyButtonLabel: "免費領取", checkoutUrl: "#registration", showMoreInfoButton: false, moreInfoButtonLabel: "方案詳情" },
        { id: "lead-trial", name: "AI 實戰體驗課", description: "跟著講師完成第一條工作流", originalPrice: 990, salePrice: 299, currency: "TWD", features: ["完整工具包", "90 分鐘直播實作", "課後回放"], isFeatured: true, badgeText: "最多人選", showBuyButton: true, buyButtonLabel: "預約體驗課", checkoutUrl: "#registration", showMoreInfoButton: true, moreInfoButtonLabel: "方案詳情", moreInfoText: "適合希望有人帶著完成、快速看到成果的學員。" },
      ] } },
      { id: "lead-registration", type: "lead_form", sortOrder: 4, isVisible: true, settings: { title: "一鍵報名領取", variant: "inline", fieldKeys: ["name", "email"], submitLabel: "立即領取" } },
    ],
  }),
  validateTemplate({
    id: "multi-tier-virtual-summit",
    name: "多方案旗艦大會範本",
    description: "精華輪播、開播倒數與三層票價，承接不同預算與參與深度。",
    thumbnailUrl: "/images/funnel-templates/multi-tier-virtual-summit.svg",
    archetype: "summit",
    category: "general",
    estimatedCvr: "10–22%",
    headline: "年度成長峰會：把趨勢變成下一季的行動",
    pageBlocks: [
      { id: "summit-highlights", type: "carousel_slider", sortOrder: 0, isVisible: true, settings: { ariaLabel: "峰會精華輪播", autoPlay: true, intervalMs: 5000, showDots: true, showArrows: true, slides: [
        { id: "summit-slide-1", imageUrl: "/images/funnel-templates/multi-tier-virtual-summit.svg", imageAlt: "峰會主舞台", title: "跨界趨勢主題演講" },
        { id: "summit-slide-2", imageUrl: "/images/funnel-templates/multi-tier-virtual-summit.svg", imageAlt: "產業對談", title: "實戰領袖圓桌對談" },
      ] } },
      { id: "summit-live", type: "countdown_timer", sortOrder: 1, isVisible: true, settings: { title: "距離線上開播還有", mode: "live_linked", theme: "flip", scheduledAt: "2030-10-18T09:00:00+08:00", liveStatus: "scheduled", liveHref: "/lives", expiredMessage: "峰會已開播，立即進場" } },
      { id: "summit-pricing", type: "pricing_table", sortOrder: 2, isVisible: true, settings: { title: "選擇你的峰會體驗", layout: "three_column", cards: [
        { id: "summit-general", name: "一般票", salePrice: 0, currency: "TWD", features: ["主舞台直播", "電子講義"], isFeatured: false, badgeText: "免費入場", showBuyButton: true, buyButtonLabel: "立即搶購", checkoutUrl: "#registration", showMoreInfoButton: true, moreInfoButtonLabel: "方案詳情", moreInfoText: "適合想掌握年度趨勢與重點觀點的參與者。" },
        { id: "summit-vip", name: "VIP 尊榮票", originalPrice: 3990, salePrice: 2490, currency: "TWD", features: ["主舞台直播", "全場回放", "VIP 小組交流"], isFeatured: true, badgeText: "熱門首選", showBuyButton: true, buyButtonLabel: "立即搶購", checkoutUrl: "#registration", showMoreInfoButton: true, moreInfoButtonLabel: "方案詳情", moreInfoText: "包含 90 天回放與限定交流場。" },
        { id: "summit-one-on-one", name: "1對1早鳥票", originalPrice: 12900, salePrice: 8900, currency: "TWD", features: ["VIP 全部權益", "講者 1 對 1 諮詢", "行動計畫診斷"], isFeatured: false, badgeText: "限量早鳥", showBuyButton: true, buyButtonLabel: "立即搶購", checkoutUrl: "#registration", showMoreInfoButton: true, moreInfoButtonLabel: "方案詳情", moreInfoText: "限量提供會後 45 分鐘策略諮詢。" },
      ] } },
      { id: "summit-faq", type: "accordion_faq", sortOrder: 3, isVisible: true, settings: { title: "常見問題", items: [
        { id: "summit-faq-1", question: "峰會有回放嗎？", answer: "一般票不含回放；VIP 與 1對1早鳥票可觀看 90 天。" },
        { id: "summit-faq-2", question: "如何收到入場連結？", answer: "完成報名後，系統會透過 Email 寄送入場資訊。" },
      ] } },
    ],
  }),
] as const;

export function getFunnelTemplate(id: string) {
  return FUNNEL_TEMPLATES.find((template) => template.id === id) ?? null;
}
