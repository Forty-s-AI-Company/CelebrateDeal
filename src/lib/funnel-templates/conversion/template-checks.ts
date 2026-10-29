import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { findFunnelContrastIssues } from "@/lib/funnel-design-contrast";
import { createEmptyPageDocument, explainPageDocumentIssue, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { getFunnelTemplateGalleryItem, previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import { FUNNEL_FONT_OPTIONS } from "@/lib/funnel-typography";
import { buildConversionThankYou } from "./thank-you";
import { CONVERSION_TEMPLATE_SAMPLE_MARK, type ConversionTemplateDefinition } from "./types";

/**
 * 名單頁／銷售頁範本的共用檢查（docs/product/funnel-templates/IMPLEMENTING.md §4）。
 * Node-only（讀 public/），只給範本測試使用。回傳空陣列代表通過。
 */
const flatten = (nodes: FunnelNode[]): FunnelNode[] => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
const HARDCODED_DATE = /20\d\d\s*[年/-]/u;
/** 寫死的售價（NT$、元）只能出現在標示「範本示意」的價值清單或文字裡；實際售價來自綁定商品。 */
const PRICE = /NT\$\s?\d|\d[\d,]*\s*元/u;
/** 假急迫感：寫死的剩餘名額、庫存或人數。 */
const FAKE_SCARCITY = /(僅剩|只剩|剩下|最後)\s*\d+\s*(位|名|個|組|份|席|件)/u;
const IMAGE_KEYS = new Set(["src", "imageUrl", "url", "photo", "avatar", "thumbnail", "logoSrc", "backgroundImage", "poster"]);
const FONT_VALUES = new Set<string>(FUNNEL_FONT_OPTIONS.map((option) => option.value));
const SAMPLE_TYPES = new Set(["testimonial_wall", "logo_strip", "stats"]);

function strings(value: unknown, key = ""): Array<{ key: string; text: string }> {
  if (typeof value === "string") return [{ key, text: value }];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).flatMap(([childKey, item]) => strings(item, childKey));
  return [];
}

/** Node ids and types in render order (main page, then its thank-you page): pin this in a snapshot. */
export function conversionTemplateNodeSignature(template: ConversionTemplateDefinition): { page: string[]; thankYou: string[] } {
  return {
    page: flatten(template.build("snapshot")).map((node) => `${node.id}:${node.type}`),
    thankYou: flatten(buildConversionThankYou(template, "snapshot")).map((node) => `${node.id}:${node.type}`),
  };
}

function nodeIssues(node: FunnelNode, prefix: string, kind: ConversionTemplateDefinition["kind"]): string[] {
  const issues: string[] = [];
  if (!node.id.startsWith(prefix)) issues.push(`節點 id 沒有使用範本前綴：${node.id}`);
  if (node.type === "raw_html") issues.push("範本不得使用 raw_html（自訂程式碼）");
  for (const entry of strings(node.props).filter((item) => IMAGE_KEYS.has(item.key) && item.text.startsWith("/"))) {
    const src = entry.text;
    if (src !== "/placeholder.svg" && !src.startsWith(`/funnel-illustrations/${kind}/`)) issues.push(`圖片必須放在 public/funnel-illustrations/${kind}/** 或使用佔位圖：${node.id} → ${src}`);
    else if (!existsSync(path.join(process.cwd(), "public", src))) issues.push(`圖片檔案不存在：${src}`);
    else if (src.endsWith(".svg") && statSync(path.join(process.cwd(), "public", src)).size > 60_000) issues.push(`SVG 超過 60KB：${src}`);
  }
  const texts = strings(node.props);
  for (const entry of texts) {
    if (HARDCODED_DATE.test(entry.text)) issues.push(`文字寫死了日期：${node.id}（${entry.text.slice(0, 30)}）`);
    if (FAKE_SCARCITY.test(entry.text)) issues.push(`不得寫死剩餘名額或庫存：${node.id}（${entry.text.slice(0, 30)}）`);
  }
  const marked = texts.some((entry) => entry.text.includes(CONVERSION_TEMPLATE_SAMPLE_MARK));
  if (SAMPLE_TYPES.has(node.type) && !marked) issues.push(`評價、Logo 與數據必須標示「${CONVERSION_TEMPLATE_SAMPLE_MARK}」：${node.id}`);
  if (texts.some((entry) => PRICE.test(entry.text)) && !marked) issues.push(`寫死的金額必須標示「${CONVERSION_TEMPLATE_SAMPLE_MARK}」（實際售價來自綁定商品）：${node.id}`);
  if (node.type === "countdown" && (node.props.source ?? "fixed") !== "registration_close") issues.push(`倒數只能綁營運設定的截止時間（source: "registration_close"）：${node.id}`);
  return issues;
}

function documentIssues(template: ConversionTemplateDefinition, galleryId: string, label: string): { issues: string[]; document?: PageDocument; nodes: FunnelNode[] } {
  if (!getFunnelTemplateGalleryItem(galleryId)) return { issues: [`${galleryId} 沒有登記在範本庫（index.ts 的位置是否還是 null？）`], nodes: [] };
  let document: PageDocument;
  try { document = previewFunnelTemplate(galleryId); } catch (error) {
    const empty = createEmptyPageDocument("template_check_page", template.name);
    const item = getFunnelTemplateGalleryItem(galleryId)!;
    const reason = explainPageDocumentIssue({ ...empty, settings: { ...empty.settings, ...item.pageSettings, typography: { ...empty.settings.typography, ...item.theme?.typography } }, root: item.build(`gallery_${galleryId}_preview`) });
    return { issues: [`${label}無法建立 PageDocument：${(error as Error).message}${reason ? `（${reason}）` : ""}`], nodes: [] };
  }
  const nodes = flatten(document.root);
  const issues = nodes.flatMap((node) => nodeIssues(node, `gallery_${galleryId}_preview_`, template.kind)).map((issue) => `${label}${issue}`);
  for (const issue of findFunnelContrastIssues(document, 4.5)) issues.push(`${label}對比不足 ${issue.ratio}:1（${issue.role}）：${issue.nodeId} ${issue.foreground} on ${issue.background}`);
  for (const section of document.root.filter((node) => node.type === "section")) if (!section.overrides.mobile?.style?.padding) issues.push(`${label}區段缺少手機版內距：${section.id}`);
  return { issues, document, nodes };
}

export function conversionTemplateIssues(template: ConversionTemplateDefinition): string[] {
  const issues: string[] = [];
  if (!new RegExp(`^${template.kind}-[a-z0-9-]+$`, "u").test(template.id)) issues.push(`id 必須是 ${template.kind}-<小寫英數與連字號>`);
  const typography = template.theme.typography;
  for (const font of [typography.bodyFont, typography.headingFont]) if (font && !FONT_VALUES.has(font)) issues.push(`字型必須是 FUNNEL_FONT_OPTIONS 的 value：${font}`);
  if (!template.purposes.includes(template.kind)) issues.push(`用途標籤必須包含 ${template.kind}`);
  if (!template.styles.length) issues.push("必須有風格標籤");
  if (!template.settings?.stickyCta?.enabled) issues.push("必須開啟手機固定行動列（settings.stickyCta）");

  const main = documentIssues(template, template.id, "");
  issues.push(...main.issues);
  if (main.document) {
    const types = new Set(main.nodes.map((node) => node.type));
    if (template.kind === "leads") {
      if (!types.has("form")) issues.push("名單頁必須有名單表單（form）");
      if ([...types].some((type) => ["offer_price", "payment_button", "payment_method"].includes(type))) issues.push("名單頁不得放付款元件");
    } else {
      if (!types.has("payment_button") || !types.has("offer_price")) issues.push("銷售頁必須有報價卡（conversionOfferCard：offer_price＋payment_button）");
      if (!types.has("faq")) issues.push("銷售頁必須有常見問題（faq）");
    }
  }
  issues.push(...documentIssues(template, `${template.id}-thanks`, "感謝頁：").issues);
  return issues;
}
