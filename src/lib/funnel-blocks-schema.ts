import { z } from "zod";

const identifier = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u);
const shortText = z.string().trim().min(1).max(160);
const longText = z.string().trim().max(2_000);
const safeHref = z.string().trim().max(2_048).refine(
  (value) => (value.startsWith("/") && !value.startsWith("//")) || /^#[A-Za-z][A-Za-z0-9_.:-]*$/u.test(value) || /^https:\/\//iu.test(value),
  "連結僅允許站內路徑、錨點或 HTTPS 網址",
);
const safeImageUrl = z.string().trim().max(2_048).refine(
  (value) => (value.startsWith("/") && !value.startsWith("//")) || /^https:\/\//iu.test(value),
  "圖片僅允許站內路徑或 HTTPS 網址",
);
const baseBlock = {
  id: identifier,
  sortOrder: z.number().int().min(0).max(10_000),
  isVisible: z.boolean(),
};

export const HeroBannerBlockSchema = z.object({
  ...baseBlock,
  type: z.literal("hero_banner"),
  settings: z.object({
    eyebrow: z.string().trim().max(80).optional(),
    headline: shortText,
    description: longText.optional(),
    imageUrl: safeImageUrl.optional(),
    imageAlt: z.string().trim().max(160).default(""),
    ctaLabel: z.string().trim().max(40).optional(),
    ctaHref: safeHref.optional(),
  }).strict(),
}).strict();

const CarouselSlideSchema = z.object({
  id: identifier,
  imageUrl: safeImageUrl,
  imageAlt: z.string().trim().max(160).default(""),
  title: z.string().trim().max(120).optional(),
  linkUrl: safeHref.optional(),
}).strict();

export const CarouselSliderBlockSchema = z.object({
  ...baseBlock,
  type: z.literal("carousel_slider"),
  settings: z.object({
    ariaLabel: z.string().trim().max(100).default("精選內容輪播"),
    slides: z.array(CarouselSlideSchema).min(1).max(20),
    autoPlay: z.boolean().default(true),
    intervalMs: z.union([z.literal(3000), z.literal(5000), z.literal(8000)]).default(5000),
    showDots: z.boolean().default(true),
    showArrows: z.boolean().default(true),
  }).strict(),
}).strict();

const PricingCardSchema = z.object({
  id: identifier,
  name: shortText,
  description: z.string().trim().max(300).optional(),
  originalPrice: z.number().nonnegative().max(100_000_000).optional(),
  salePrice: z.number().nonnegative().max(100_000_000),
  currency: z.string().trim().min(3).max(3).default("TWD"),
  features: z.array(z.string().trim().min(1).max(160)).max(30),
  isFeatured: z.boolean().default(false),
  badgeText: z.string().trim().max(30).default("熱門首選"),
  showBuyButton: z.boolean().default(true),
  buyButtonLabel: z.string().trim().min(1).max(40).default("立即購買"),
  checkoutUrl: safeHref.optional(),
  showMoreInfoButton: z.boolean().default(false),
  moreInfoButtonLabel: z.string().trim().min(1).max(40).default("了解更多"),
  moreInfoTarget: safeHref.optional(),
  moreInfoText: z.string().trim().max(1_000).optional(),
}).strict().refine((card) => card.originalPrice === undefined || card.originalPrice >= card.salePrice, {
  path: ["originalPrice"],
  message: "原價不可低於優惠價",
});

export const PricingTableBlockSchema = z.object({
  ...baseBlock,
  type: z.literal("pricing_table"),
  settings: z.object({
    title: shortText.optional(),
    layout: z.enum(["two_column", "three_column", "carousel"]),
    cards: z.array(PricingCardSchema).min(1).max(12),
  }).strict(),
}).strict().superRefine((block, context) => {
  const expected = block.settings.layout === "two_column" ? 2 : block.settings.layout === "three_column" ? 3 : null;
  if (expected !== null && block.settings.cards.length !== expected) {
    context.addIssue({ code: "custom", path: ["settings", "cards"], message: `${block.settings.layout} 必須包含 ${expected} 張價格卡` });
  }
  block.settings.cards.forEach((card, index) => {
    if (card.showBuyButton && !card.checkoutUrl) {
      context.addIssue({ code: "custom", path: ["settings", "cards", index, "checkoutUrl"], message: "顯示購買按鈕時必須提供結帳連結" });
    }
    if (card.showMoreInfoButton && !card.moreInfoTarget && !card.moreInfoText) {
      context.addIssue({ code: "custom", path: ["settings", "cards", index], message: "顯示了解更多時必須提供目標或說明" });
    }
  });
});

export const CountdownTimerBlockSchema = z.object({
  ...baseBlock,
  type: z.literal("countdown_timer"),
  settings: z.object({
    title: shortText.optional(),
    mode: z.enum(["fixed_date", "live_linked", "evergreen_minutes"]),
    theme: z.enum(["flip", "minimal"]),
    targetDate: z.string().datetime({ offset: true }).optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    liveStatus: z.enum(["scheduled", "live", "ended"]).optional(),
    evergreenMinutes: z.number().int().min(1).max(10_080).optional(),
    liveHref: safeHref.optional(),
    expiredMessage: z.string().trim().max(120).default("優惠已結束"),
  }).strict(),
}).strict().superRefine((block, context) => {
  const settings = block.settings;
  if (settings.mode === "fixed_date" && !settings.targetDate) context.addIssue({ code: "custom", path: ["settings", "targetDate"], message: "固定日期模式需要截止時間" });
  if (settings.mode === "live_linked" && !settings.scheduledAt) context.addIssue({ code: "custom", path: ["settings", "scheduledAt"], message: "直播連動模式需要開播時間" });
  if (settings.mode === "evergreen_minutes" && !settings.evergreenMinutes) context.addIssue({ code: "custom", path: ["settings", "evergreenMinutes"], message: "常青模式需要倒數分鐘" });
});

export const LeadFormBlockSchema = z.object({
  ...baseBlock,
  type: z.literal("lead_form"),
  settings: z.object({
    title: shortText.optional(),
    description: longText.optional(),
    variant: z.enum(["inline", "floating"]),
    fieldKeys: z.array(z.enum(["name", "email", "phone"])).min(1).max(3),
    submitLabel: z.string().trim().min(1).max(40).optional(),
  }).strict(),
}).strict().superRefine((block, context) => {
  const uniqueKeys = new Set(block.settings.fieldKeys);
  if (uniqueKeys.size !== block.settings.fieldKeys.length) context.addIssue({ code: "custom", path: ["settings", "fieldKeys"], message: "表單欄位不可重複" });
  for (const requiredKey of ["name", "email"] as const) {
    if (!uniqueKeys.has(requiredKey)) context.addIssue({ code: "custom", path: ["settings", "fieldKeys"], message: `名單表單必須包含 ${requiredKey}` });
  }
});

export const AccordionFaqBlockSchema = z.object({
  ...baseBlock,
  type: z.literal("accordion_faq"),
  settings: z.object({
    title: shortText.optional(),
    items: z.array(z.object({ id: identifier, question: shortText, answer: longText.min(1) }).strict()).min(1).max(30),
  }).strict(),
}).strict();

const ConsultationIntakeFieldSchema = z.object({
  id: identifier,
  label: shortText,
  type: z.enum(["text", "email", "tel", "textarea"]),
  required: z.boolean().default(false),
}).strict();

export const ConsultationBookingBlockSchema = z.object({
  ...baseBlock,
  type: z.literal("consultation_booking"),
  settings: z.object({
    title: shortText.default("預約諮詢"),
    description: longText.optional(),
    timezone: z.string().trim().min(1).max(80).default("Asia/Taipei"),
    durationMinutes: z.number().int().min(15).max(480).default(30),
    submitLabel: z.string().trim().min(1).max(40).default("送出預約"),
    successMessage: z.string().trim().min(1).max(300).default("預約已送出，我們會依照你留下的資料與你聯繫。"),
    intakeFields: z.array(ConsultationIntakeFieldSchema).max(12).default([]),
  }).strict().superRefine((settings, context) => {
    const ids = new Set<string>();
    settings.intakeFields.forEach((field, index) => {
      if (ids.has(field.id)) context.addIssue({ code: "custom", path: ["intakeFields", index, "id"], message: "預約欄位 id 不可重複" });
      ids.add(field.id);
    });
  }),
}).strict();

export const FunnelBlockSchema = z.discriminatedUnion("type", [
  HeroBannerBlockSchema,
  CarouselSliderBlockSchema,
  PricingTableBlockSchema,
  CountdownTimerBlockSchema,
  LeadFormBlockSchema,
  AccordionFaqBlockSchema,
  ConsultationBookingBlockSchema,
]);

export const FunnelPageBlocksSchema = z.array(FunnelBlockSchema).max(100).superRefine((blocks, context) => {
  const ids = new Set<string>();
  blocks.forEach((block, index) => {
    if (ids.has(block.id)) context.addIssue({ code: "custom", path: [index, "id"], message: "區塊 id 不可重複" });
    ids.add(block.id);
  });
});

export type FunnelBlock = z.infer<typeof FunnelBlockSchema>;
export type FunnelPageBlocks = z.infer<typeof FunnelPageBlocksSchema>;
export type PricingTableBlock = z.infer<typeof PricingTableBlockSchema>;
export type CarouselSliderBlock = z.infer<typeof CarouselSliderBlockSchema>;
export type CountdownTimerBlock = z.infer<typeof CountdownTimerBlockSchema>;
export type LeadFormBlock = z.infer<typeof LeadFormBlockSchema>;
export type ConsultationBookingBlock = z.infer<typeof ConsultationBookingBlockSchema>;

export function parseFunnelPageBlocks(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = FunnelPageBlocksSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
