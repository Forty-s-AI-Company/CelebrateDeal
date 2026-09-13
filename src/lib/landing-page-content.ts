import { z } from "zod";

/** The persisted format revision for Puck-authored landing page content. */
export const LANDING_PAGE_SCHEMA_VERSION = 1 as const;
export const LANDING_PAGE_MAX_NODES = 120;
export const LANDING_PAGE_MAX_DEPTH = 6;

const identifier = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u, "識別碼只能包含英數、底線與連字號");
const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => text(max).min(1);
const hasUnsafeUrlCharacter = (value: string) => /[\\\u0000-\u001f\u007f]/u.test(value);
const isSafeHttpsUrl = (value: string) => {
  if (hasUnsafeUrlCharacter(value)) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};
const safeUrl = z.string().trim().max(2_048).refine((value) => !hasUnsafeUrlCharacter(value) && (value.startsWith("/") && !value.startsWith("//") || isSafeHttpsUrl(value)), "網址只允許同源站內路徑或 HTTPS");
const safeHttpsUrl = z.string().trim().max(2_048).refine(isSafeHttpsUrl, "外部網址只允許 HTTPS");
const anchorId = z.string().trim().max(100).regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/u, "錨點格式不正確");
const color = z.string().trim().max(32).regex(/^(#[0-9a-f]{3,8}|rgb\((?:[0-9]{1,3},\s*){2}[0-9]{1,3}\)|transparent|white|black)$/iu, "顏色格式不正確");

/** A deliberately small, value-only styling surface. No class names, CSS or HTML are persisted. */
export const LandingPageStyleSchema = z.object({
  backgroundColor: color.optional(),
  color: color.optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  maxWidth: z.enum(["sm", "md", "lg", "xl", "full"]).optional(),
  padding: z.enum(["none", "sm", "md", "lg", "xl"]).optional(),
  margin: z.enum(["none", "sm", "md", "lg", "xl"]).optional(),
  borderRadius: z.enum(["none", "sm", "md", "lg", "full"]).optional(),
  fontSize: z.enum(["sm", "base", "lg", "xl", "2xl", "4xl"]).optional(),
  fontWeight: z.enum(["normal", "medium", "bold", "black"]).optional(),
  mobile: z.object({
    hidden: z.boolean().optional(),
    padding: z.enum(["none", "sm", "md", "lg"]).optional(),
    fontSize: z.enum(["sm", "base", "lg", "xl", "2xl"]).optional(),
  }).strict().optional(),
}).strict();

export const LandingPageActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("registration"), formId: identifier }).strict(),
  z.object({ type: z.literal("external"), href: safeHttpsUrl }).strict(),
  z.object({ type: z.literal("anchor"), targetId: anchorId }).strict(),
]);
export type LandingPageAction = z.infer<typeof LandingPageActionSchema>;

const ctaFields = {
  ctaLabel: text(60).optional(),
  ctaAction: LandingPageActionSchema.optional(),
};

const PropsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Heading"), text: requiredText(180), level: z.enum(["h1", "h2", "h3"]).default("h2"), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Text"), text: requiredText(4_000), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Image"), src: safeUrl, alt: text(180).default(""), caption: text(300).optional(), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Video"), src: safeHttpsUrl, title: text(160).default("影片"), provider: z.enum(["auto", "youtube", "vimeo"]).default("auto"), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Button"), label: requiredText(60), action: LandingPageActionSchema, style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Section"), anchorId: anchorId.optional(), children: z.array(z.unknown()).max(24).default([]), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Columns"), first: z.array(z.unknown()).max(24).default([]), second: z.array(z.unknown()).max(24).default([]), third: z.array(z.unknown()).max(24).default([]), columns: z.enum(["one", "two", "three"]).default("two"), ratio: z.enum(["equal", "wideFirst", "wideLast"]).default("equal"), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Hero"), eyebrow: text(100).optional(), title: requiredText(180), description: text(1_000).optional(), imageUrl: safeUrl.optional(), ...ctaFields, style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Speaker"), name: requiredText(120), role: text(160).optional(), bio: text(2_000).optional(), imageUrl: safeUrl.optional(), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Benefits"), title: text(180).optional(), items: z.array(z.object({ title: requiredText(120), description: text(500).optional() }).strict()).min(1).max(12), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Agenda"), title: text(180).optional(), items: z.array(z.object({ time: text(80).optional(), title: requiredText(160), description: text(500).optional() }).strict()).min(1).max(20), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Carousel"), title: text(180).optional(), slides: z.array(z.object({ imageUrl: safeUrl, alt: text(180).default(""), title: text(160).optional(), description: text(500).optional() }).strict()).min(1).max(12), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Pricing"), title: text(180).optional(), plans: z.array(z.object({ name: requiredText(100), price: requiredText(80), description: text(400).optional(), features: z.array(requiredText(160)).max(20).default([]), label: text(60).optional(), action: LandingPageActionSchema.optional() }).strict()).min(1).max(6), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("Countdown"), title: text(180).optional(), mode: z.enum(["fixed_date", "live_linked"]).default("fixed_date"), targetAt: z.string().datetime({ offset: true }).optional(), ctaLabel: text(60).optional(), ctaAction: LandingPageActionSchema.optional(), expiredMessage: text(180).default("活動已結束"), expiredAction: z.enum(["show_message", "hide_cta", "redirect"]).default("show_message"), expiredRedirect: LandingPageActionSchema.optional(), style: LandingPageStyleSchema.optional() }).strict().superRefine((value, context) => {
    if (value.mode === "fixed_date" && !value.targetAt) context.addIssue({ code: "custom", path: ["targetAt"], message: "固定日期倒數需要截止時間" });
    if (value.expiredAction === "redirect" && !value.expiredRedirect) context.addIssue({ code: "custom", path: ["expiredRedirect"], message: "到期轉址需要指定目的地" });
  }),
  z.object({ type: z.literal("Testimonials"), title: text(180).optional(), items: z.array(z.object({ quote: requiredText(1_000), name: requiredText(120), role: text(160).optional(), imageUrl: safeUrl.optional() }).strict()).min(1).max(12), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("FAQ"), title: text(180).optional(), items: z.array(z.object({ question: requiredText(240), answer: requiredText(2_000) }).strict()).min(1).max(24), style: LandingPageStyleSchema.optional() }).strict(),
  z.object({ type: z.literal("CTA"), title: requiredText(180), description: text(1_000).optional(), ...ctaFields, style: LandingPageStyleSchema.optional() }).strict(),
]);

type RawProps = z.infer<typeof PropsSchema>;
export type LandingPageComponentType = RawProps["type"];
type WithoutType<T> = T extends { type: string } ? Omit<T, "type"> : never;
type LandingPageProps = WithoutType<RawProps>;

const allowedTypes = new Set<LandingPageComponentType>([
  "Heading", "Text", "Image", "Video", "Button", "Section", "Columns", "Hero", "Speaker", "Benefits", "Agenda", "Carousel", "Pricing", "Countdown", "Testimonials", "FAQ", "CTA",
]);
const childKeys = new Set(["children", "first", "second", "third"]);

type LandingPageComponentData = {
  [Props in RawProps as Props["type"]]: { type: Props["type"]; props: WithoutType<Props> & { id: string } }
}[LandingPageComponentType];

function parseComponent(value: unknown, depth: number, counter: { nodes: number; ids: Set<string> }): LandingPageComponentData | null {
  if (depth > LANDING_PAGE_MAX_DEPTH || counter.nodes >= LANDING_PAGE_MAX_NODES || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.type !== "string" || !allowedTypes.has(input.type as LandingPageComponentType) || !input.props || typeof input.props !== "object" || Array.isArray(input.props)) return null;
  const propsInput = input.props as Record<string, unknown>;
  const { id: rawId, ...rawProps } = propsInput;
  const parsedProps = PropsSchema.safeParse({ type: input.type, ...rawProps });
  const id = identifier.safeParse(rawId);
  if (!parsedProps.success || !id.success || counter.ids.has(id.data) || Object.keys(input).some((key) => key !== "type" && key !== "props" && key !== "readOnly")) return null;
  counter.ids.add(id.data);
  const { type: _type, ...parsedWithoutType } = parsedProps.data;
  void _type; // 元件類型由外層保存，不重複存入 props。
  const props = { ...parsedWithoutType, id: id.data } as LandingPageProps & { id: string };
  counter.nodes += 1;

  for (const key of childKeys) {
    if (!(key in props)) continue;
    const children = props[key as keyof typeof props];
    if (!Array.isArray(children)) return null;
    const parsedChildren: LandingPageComponentData[] = [];
    for (const child of children) {
      const parsedChild = parseComponent(child, depth + 1, counter);
      if (!parsedChild) return null;
      parsedChildren.push(parsedChild);
    }
    (props as Record<string, unknown>)[key] = parsedChildren;
  }
  return { type: input.type as LandingPageComponentType, props } as LandingPageComponentData;
}

function parseComponents(value: unknown, depth: number, counter: { nodes: number; ids: Set<string> }) {
  if (!Array.isArray(value) || value.length > 24) return null;
  const components: LandingPageComponentData[] = [];
  for (const item of value) {
    const component = parseComponent(item, depth, counter);
    if (!component) return null;
    components.push(component);
  }
  return components;
}

const RootSchema = z.object({ props: z.object({
  title: text(180).optional(),
  description: text(300).optional(),
  shareImage: safeHttpsUrl.optional(),
  style: LandingPageStyleSchema.optional(),
}).strict().optional(), readOnly: z.record(z.string(), z.boolean()).optional() }).strict();

export type LandingPagePuckData = {
  root: z.infer<typeof RootSchema>;
  content: LandingPageComponentData[];
};

export const LandingPageContentSchema = z.object({
  schemaVersion: z.literal(LANDING_PAGE_SCHEMA_VERSION),
  data: z.object({ root: RootSchema, content: z.array(z.unknown()).max(24), zones: z.object({}).strict().optional() }).strict(),
}).strict().superRefine((value, context) => {
  const counter = { nodes: 0, ids: new Set<string>() };
  const content = parseComponents(value.data.content, 1, counter);
  if (!content) context.addIssue({ code: "custom", path: ["data", "content"], message: "頁面區塊格式不正確，或超過巢狀、數量限制" });
});

export type LandingPageContent = {
  schemaVersion: typeof LANDING_PAGE_SCHEMA_VERSION;
  data: LandingPagePuckData;
};

export type LandingPageFormReference = { id: string; slug: string; name: string };
export type LandingPageLiveReference = { id: string; slug: string; title: string; status: "scheduled" | "live" | "ended"; formId?: string; scheduledAt?: string; timezone?: string };
export type LandingPageRenderContext = { pageId?: string; forms: LandingPageFormReference[]; live?: LandingPageLiveReference };

/** Safely normalizes an untrusted database/API value into the only accepted v1 shape. */
export function parseLandingPageContent(value: unknown): LandingPageContent | null {
  const parsed = LandingPageContentSchema.safeParse(value);
  if (!parsed.success) return null;
  const counter = { nodes: 0, ids: new Set<string>() };
  const content = parseComponents(parsed.data.data.content, 1, counter);
  return content ? { schemaVersion: LANDING_PAGE_SCHEMA_VERSION, data: { root: parsed.data.data.root.props ? { props: parsed.data.data.root.props } : {}, content } } : null;
}

export function createEmptyLandingPageContent(): LandingPageContent {
  return { schemaVersion: LANDING_PAGE_SCHEMA_VERSION, data: { root: {}, content: [] } };
}

/** Creates a safe starting payload for the editor; callers still validate form ownership server-side. */
export function createLandingPageContent(template: "blank" | "webinar", formId?: string): LandingPageContent {
  if (template === "blank") return createEmptyLandingPageContent();
  const registrationAction = formId && identifier.safeParse(formId).success
    ? { type: "registration" as const, formId }
    : { type: "anchor" as const, targetId: "register" };
  return {
    schemaVersion: LANDING_PAGE_SCHEMA_VERSION,
    data: {
      root: { props: { title: "線上講座報名頁", description: "線上講座報名頁" } },
      content: [
        {
          type: "Hero",
          props: {
            id: "hero", eyebrow: "免費線上講座", title: "用一場直播，讓對的人認識你的價值",
            description: "保留你的席次，活動開始前我們會提醒你。", ctaLabel: "立即保留席次", ctaAction: registrationAction,
          },
        },
        {
          type: "Benefits",
          props: {
            id: "benefits", title: "你會帶走什麼", items: [
              { title: "清楚的行動方向", description: "把複雜的下一步拆成今天就能開始的小事。" },
              { title: "可複製的方法", description: "用適合自己的節奏，穩穩做出成果。" },
            ],
          },
        },
        {
          type: "Speaker",
          props: {
            id: "speaker", name: "講者姓名", role: "講者職稱（請填寫）", bio: "在這裡補上講者的專業背景與本次分享重點。",
          },
        },
        {
          type: "Agenda",
          props: {
            id: "agenda", title: "活動流程", items: [
              { time: "00:00", title: "開場與主題介紹", description: "認識今天的分享內容與學習目標。" },
              { time: "00:15", title: "主題分享", description: "請填寫本場講座的重點段落。" },
              { time: "00:50", title: "問答與交流", description: "留下你的問題，和講者一起找到下一步。" },
            ],
          },
        },
        {
          type: "FAQ",
          props: {
            id: "faq", title: "常見問題", items: [
              { question: "活動會提供回放嗎？", answer: "請依實際活動安排補上回放說明。" },
              { question: "報名後如何參加？", answer: "完成報名後，活動連結與提醒將依你的報名資料寄送。" },
            ],
          },
        },
        {
          type: "CTA",
          props: { id: "register", title: "準備好了嗎？", description: "現在報名，保留你的線上席次。", ctaLabel: "立即報名", ctaAction: registrationAction },
        },
      ],
    },
  };
}
